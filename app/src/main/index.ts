import {
  app,
  BrowserWindow,
  ipcMain,
  globalShortcut,
  Tray,
  Menu,
  clipboard,
  nativeImage,
  dialog,
  screen,
  desktopCapturer,
  shell,
  systemPreferences
} from 'electron'
import { execFile, execFileSync } from 'child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { promisify } from 'util'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import trayIconAsset from '../../resources/tray.png?asset'
import {
  loadSettings,
  saveSettings,
  isValidCaptureShortcut,
  normalizeAccelerator,
  type AppSettings,
  type Language,
  DEFAULT_CAPTURE_SHORTCUT
} from './settings'

const execFileAsync = promisify(execFile)

app.setName('LiteSnap')

let tray: Tray | null = null
let overlayWindow: BrowserWindow | null = null
let shortcutWindow: BrowserWindow | null = null
let scrollControlWindow: BrowserWindow | null = null
let pinWindow: BrowserWindow | null = null
let cachedFullScreenshot: Buffer | null = null
let appSettings: AppSettings = { language: 'en', captureShortcut: DEFAULT_CAPTURE_SHORTCUT }
let registeredShortcut: string | null = null
let captureShortcutSuspended = false
let scrollCaptureRect: Rect | null = null
let scrollPollTimer: ReturnType<typeof setInterval> | null = null
let lastScrollPollPNG: Buffer | null = null
let scrollPollInFlight = false
let captureDisplay: Electron.Display | null = null
let captureBounds: Rect | null = null

type CaptureResult = { png: Buffer; bounds: Rect; display: Electron.Display }

type Rect = { x: number; y: number; width: number; height: number }

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function bufferFromIpcData(data: Uint8Array | Buffer | ArrayBuffer): Buffer {
  if (Buffer.isBuffer(data)) return data
  if (data instanceof ArrayBuffer) return Buffer.from(data)
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength)
}

function getActiveDisplay(): Electron.Display {
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
}

function isPngBuffer(png: Buffer): boolean {
  return (
    png.length > 8 &&
    png[0] === 0x89 &&
    png[1] === 0x50 &&
    png[2] === 0x4e &&
    png[3] === 0x47
  )
}

function pngToBase64(png: Buffer): string {
  if (!isPngBuffer(png)) {
    throw new Error('Captured data is not a valid PNG')
  }
  if (isBlankImage(png)) {
    throw new Error('Screen capture returned a blank image (permission denied?)')
  }
  return png.toString('base64')
}

function isBlankImage(png: Buffer): boolean {
  try {
    const image = nativeImage.createFromBuffer(png)
    const { width, height } = image.getSize()
    if (width < 2 || height < 2) return true
    const bitmap = image.toBitmap()
    if (bitmap.length < 12) return true

    let nonUniform = 0
    const step = Math.max(16, Math.floor(bitmap.length / 1200) * 4)
    const r0 = bitmap[0]
    const g0 = bitmap[1]
    const b0 = bitmap[2]
    for (let i = 0; i + 2 < bitmap.length; i += step) {
      const dr = Math.abs(bitmap[i] - r0)
      const dg = Math.abs(bitmap[i + 1] - g0)
      const db = Math.abs(bitmap[i + 2] - b0)
      if (dr + dg + db > 36) {
        nonUniform++
        if (nonUniform > 6) return false
      }
    }
    return true
  } catch {
    return true
  }
}

function normalizeCaptureToBounds(png: Buffer, bounds: Rect): Buffer {
  const image = nativeImage.createFromBuffer(png)
  const { width, height } = image.getSize()
  if (bounds.width <= 0 || bounds.height <= 0 || width < 2 || height < 2) return png

  const scale = width / bounds.width
  const targetW = Math.round(bounds.width * scale)
  const targetH = Math.round(bounds.height * scale)
  if (width === targetW && height === targetH) return png

  let working = image
  if (width > targetW || height > targetH) {
    working = working.crop({
      x: 0,
      y: 0,
      width: Math.min(width, targetW),
      height: Math.min(height, targetH)
    })
  }

  const cropped = working.getSize()
  if (cropped.width !== targetW || cropped.height !== targetH) {
    working = working.resize({ width: targetW, height: targetH, quality: 'best' })
  }
  return working.toPNG()
}

function finalizeCaptureResult(png: Buffer, bounds: Rect, display: Electron.Display): CaptureResult {
  const normalized = normalizeCaptureToBounds(png, bounds)
  return { png: normalized, bounds, display }
}

function openScreenRecordingSettings(): void {
  // Screen Recording permission is a macOS concept only; Windows/Linux never
  // gate capture behind it, so there is nothing to open there.
  if (process.platform !== 'darwin') return
  void shell.openExternal(
    'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
  )
}

function screencaptureArgs(rect?: Rect): string[] {
  const base = captureBounds ?? getActiveDisplay().bounds
  const args = ['-x']
  if (rect) {
    const absX = Math.round(base.x + rect.x)
    const absY = Math.round(base.y + rect.y)
    args.push(
      `-R${absX},${absY},${Math.max(1, Math.round(rect.width))},${Math.max(1, Math.round(rect.height))}`
    )
  } else {
    args.push(`-R${base.x},${base.y},${base.width},${base.height}`)
  }
  return args
}

function captureWithScreencaptureSync(rect?: Rect): Buffer {
  const dir = mkdtempSync(join(tmpdir(), 'litesnap-'))
  const file = join(dir, 'shot.png')
  try {
    execFileSync('screencapture', [...screencaptureArgs(rect), file], { timeout: 8000 })
    if (!existsSync(file)) throw new Error('screencapture produced no file')
    const png = readFileSync(file)
    if (png.length < 200 || isBlankImage(png)) {
      throw new Error('Screen capture returned a blank image')
    }
    return png
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

async function captureWithScreencapture(rect?: Rect): Promise<Buffer> {
  const dir = mkdtempSync(join(tmpdir(), 'litesnap-'))
  const file = join(dir, 'shot.png')
  try {
    await execFileAsync('screencapture', [...screencaptureArgs(rect), file], { timeout: 8000 })
    if (!existsSync(file)) throw new Error('screencapture produced no file')
    const png = readFileSync(file)
    if (png.length < 200 || isBlankImage(png)) {
      throw new Error('Screen capture returned a blank image')
    }
    return png
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function captureThumbnailSize(display: Electron.Display): { width: number; height: number } {
  // Windows desktopCapturer thumbnails default to logical pixels (DIP). On
  // high-DPI displays (125%/150%/200%), that downscales the capture and the
  // renderer later stretches it back, which looks blurry. Request physical
  // pixel dimensions to keep screenshots crisp.
  const scale = Math.max(1, display.scaleFactor || 1)
  const width = Math.max(1, Math.round(display.bounds.width * scale))
  const height = Math.max(1, Math.round(display.bounds.height * scale))
  return { width, height }
}

// On Windows (and occasionally elsewhere), desktopCapturer sources can report
// a `display_id` that never matches `screen.getAllDisplays()`'s id (empty
// string, or a different device handle). When that lookup silently failed we
// used to fall back to `sources[0]`, which is an arbitrary pick — this is the
// root cause of screenshots landing on the wrong monitor in multi-display
// setups. This resolves each display to its best-matching source: exact
// `display_id` match first, then geometric matching (aspect ratio + how close
// the thumbnail's pixel size is to the display's own physical resolution) for
// whatever is left over.
function matchScreenSourceToDisplay(
  sources: Electron.DesktopCapturerSource[],
  displays: Electron.Display[]
): Map<number, Electron.DesktopCapturerSource> {
  const matched = new Map<number, Electron.DesktopCapturerSource>()
  const remainingSources = [...sources]
  const remainingDisplays = [...displays]

  for (const display of [...remainingDisplays]) {
    const idx = remainingSources.findIndex(
      (item) => item.display_id && item.display_id === String(display.id)
    )
    if (idx === -1) continue
    matched.set(display.id, remainingSources[idx])
    remainingSources.splice(idx, 1)
    remainingDisplays.splice(remainingDisplays.indexOf(display), 1)
  }

  for (const display of [...remainingDisplays]) {
    if (remainingSources.length === 0) break
    const physicalW = display.bounds.width * (display.scaleFactor || 1)
    const physicalH = display.bounds.height * (display.scaleFactor || 1)
    const targetAspect = physicalW / Math.max(1, physicalH)

    let bestIdx = 0
    let bestScore = Infinity
    remainingSources.forEach((source, idx) => {
      const { width, height } = source.thumbnail.getSize()
      if (width < 2 || height < 2) return
      const aspectScore = Math.abs(width / Math.max(1, height) - targetAspect)
      const sizeScore =
        Math.abs(width - physicalW) / physicalW + Math.abs(height - physicalH) / physicalH
      const score = aspectScore * 4 + sizeScore
      if (score < bestScore) {
        bestScore = score
        bestIdx = idx
      }
    })

    matched.set(display.id, remainingSources[bestIdx])
    remainingSources.splice(bestIdx, 1)
    remainingDisplays.splice(remainingDisplays.indexOf(display), 1)
  }

  return matched
}

async function captureWithDesktopCapturer(rect?: Rect): Promise<Buffer> {
  const display = getActiveDisplay()
  const thumbnailSize = captureThumbnailSize(display)
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize
  })
  const matchedByDisplay = matchScreenSourceToDisplay(sources, screen.getAllDisplays())
  const source = matchedByDisplay.get(display.id) ?? sources[0]
  if (!source) throw new Error('No screen source available')

  let image = source.thumbnail
  if (image.isEmpty() || isBlankImage(image.toPNG())) {
    throw new Error('desktopCapturer returned a blank image')
  }

  if (rect) {
    const { width: imgW, height: imgH } = image.getSize()
    const scaleX = imgW / display.bounds.width
    const scaleY = imgH / display.bounds.height
    const crop = {
      x: Math.max(0, Math.round(rect.x * scaleX)),
      y: Math.max(0, Math.round(rect.y * scaleY)),
      width: Math.max(1, Math.round(rect.width * scaleX)),
      height: Math.max(1, Math.round(rect.height * scaleY))
    }
    crop.width = Math.min(crop.width, imgW - crop.x)
    crop.height = Math.min(crop.height, imgH - crop.y)
    image = image.crop(crop)
  }
  return image.toPNG()
}

function getFrontmostWindowInfo(): Rect & { id: number } | null {
  if (process.platform !== 'darwin') return null
  const dir = mkdtempSync(join(tmpdir(), 'litesnap-swift-'))
  const swiftFile = join(dir, 'getwindow.swift')
  try {
    writeFileSync(
      swiftFile,
      `import CoreGraphics
import Foundation
let opts = CGWindowListOption(arrayLiteral: .optionOnScreenOnly, .excludeDesktopElements)
guard let list = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] else { exit(1) }
let skip: Set<String> = ["Dock", "Window Server", "SystemUIServer", "Control Center", "Notification Center", "Wallpaper"]
var bestId = 0
var bestX = 0
var bestY = 0
var bestW = 0
var bestH = 0
var bestArea = 0
for w in list {
  guard let layer = w[kCGWindowLayer as String] as? Int, layer == 0 else { continue }
  guard let owner = w[kCGWindowOwnerName as String] as? String else { continue }
  if skip.contains(owner) { continue }
  if owner.contains("LiteSnap") || owner.contains("Electron") { continue }
  guard let bounds = w[kCGWindowBounds as String] as? [String: Any] else { continue }
  let width = bounds["Width"] as? CGFloat ?? 0
  let height = bounds["Height"] as? CGFloat ?? 0
  if width < 200 || height < 200 { continue }
  let area = Int(width * height)
  if area > bestArea,
     let wid = w[kCGWindowNumber as String] as? Int,
     let x = bounds["X"] as? CGFloat,
     let y = bounds["Y"] as? CGFloat {
    bestArea = area
    bestId = wid
    bestX = Int(x)
    bestY = Int(y)
    bestW = Int(width)
    bestH = Int(height)
  }
}
if bestId > 0 {
  print("\\(bestId)|\\(bestX)|\\(bestY)|\\(bestW)|\\(bestH)")
  exit(0)
}
exit(1)
`
    )
    const out = execFileSync('swift', [swiftFile], { timeout: 20000, encoding: 'utf-8' }).trim()
    const [id, x, y, width, height] = out.split('|').map(Number)
    if (!id || !width || !height) return null
    return { id, x, y, width, height }
  } catch {
    return null
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function captureWithScreencaptureWindow(windowId: number): Buffer {
  const dir = mkdtempSync(join(tmpdir(), 'litesnap-'))
  const file = join(dir, 'shot.png')
  try {
    execFileSync('screencapture', ['-x', `-l${windowId}`, file], { timeout: 8000 })
    if (!existsSync(file)) throw new Error('screencapture produced no file')
    const png = readFileSync(file)
    if (png.length < 200 || isBlankImage(png)) {
      throw new Error('Window capture returned a blank image')
    }
    return png
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

async function captureWithDesktopCapturerWindow(): Promise<{ png: Buffer; bounds: Rect }> {
  const display = getActiveDisplay()
  const winInfo = getFrontmostWindowInfo()
  const thumbnailSize = captureThumbnailSize(display)
  const sources = await desktopCapturer.getSources({
    types: ['window'],
    fetchWindowIcons: false,
    thumbnailSize
  })

  const skipName = (name: string): boolean =>
    name.includes('LiteSnap') ||
    name.includes('Electron') ||
    name.toLowerCase().includes('litesnap')

  const candidates = sources
    .filter((source) => source.thumbnail && !source.thumbnail.isEmpty() && !skipName(source.name))
    .map((source) => {
      const { width, height } = source.thumbnail.getSize()
      return { source, area: width * height }
    })
    .sort((a, b) => b.area - a.area)

  const best = candidates[0]?.source
  if (!best) throw new Error('No window source available')

  const png = best.thumbnail.toPNG()
  if (isBlankImage(png)) throw new Error('desktopCapturer window returned a blank image')

  const bounds: Rect = winInfo
    ? { x: winInfo.x, y: winInfo.y, width: winInfo.width, height: winInfo.height }
    : {
        x: display.bounds.x,
        y: display.bounds.y,
        width: display.bounds.width,
        height: display.bounds.height
      }

  return { png, bounds }
}

async function captureScreenBest(): Promise<CaptureResult> {
  const display = getActiveDisplay()
  const errors: string[] = []

  try {
    const png = await captureWithDesktopCapturer()
    return finalizeCaptureResult(png, { ...display.bounds }, display)
  } catch (error) {
    errors.push(`desktopCapturer-screen: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (process.platform === 'darwin') {
    const winInfo = getFrontmostWindowInfo()
    if (winInfo) {
      try {
        const png = captureWithScreencaptureWindow(winInfo.id)
        const bounds = { x: winInfo.x, y: winInfo.y, width: winInfo.width, height: winInfo.height }
        return finalizeCaptureResult(png, bounds, display)
      } catch (error) {
        errors.push(
          `screencapture-window: ${error instanceof Error ? error.message : String(error)}`
        )
      }
    }

    try {
      const png = captureWithScreencaptureSync()
      return finalizeCaptureResult(png, { ...display.bounds }, display)
    } catch (error) {
      errors.push(`screencapture: ${error instanceof Error ? error.message : String(error)}`)
    }

    try {
      const png = await captureWithScreencapture()
      return finalizeCaptureResult(png, { ...display.bounds }, display)
    } catch (error) {
      errors.push(`screencapture-async: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  try {
    const { png, bounds } = await captureWithDesktopCapturerWindow()
    return finalizeCaptureResult(png, bounds, display)
  } catch (error) {
    errors.push(`desktopCapturer-window: ${error instanceof Error ? error.message : String(error)}`)
  }

  throw new Error(errors.join('\n') || 'Screen capture failed')
}

async function captureScreen(rect?: Rect): Promise<Buffer> {
  const result = await captureScreenBest()
  captureBounds = result.bounds
  captureDisplay = result.display
  cachedFullScreenshot = result.png
  if (!rect) return result.png

  const { width: imgW, height: imgH } = nativeImage.createFromBuffer(result.png).getSize()
  const scaleX = imgW / result.bounds.width
  const scaleY = imgH / result.bounds.height
  const crop = {
    x: Math.max(0, Math.floor(rect.x * scaleX)),
    y: Math.max(0, Math.floor(rect.y * scaleY)),
    width: Math.max(1, Math.ceil((rect.x + rect.width) * scaleX) - Math.floor(rect.x * scaleX)),
    height: Math.max(1, Math.ceil((rect.y + rect.height) * scaleY) - Math.floor(rect.y * scaleY))
  }
  crop.width = Math.min(crop.width, imgW - crop.x)
  crop.height = Math.min(crop.height, imgH - crop.y)
  return nativeImage.createFromBuffer(result.png).crop(crop).toPNG()
}

interface TrayMessages {
  capture: (shortcut: string) => string
  changeShortcut: string
  language: string
  languageEnglish: string
  languageZh: string
  languageZhTW: string
  openScreenPermission: string
  quit: string
}

const TRAY_MESSAGES: Record<Language, TrayMessages> = {
  en: {
    capture: (shortcut) => `Capture (${shortcut})`,
    changeShortcut: 'Change Shortcut…',
    language: 'Language',
    languageEnglish: 'English',
    languageZh: '中文（简体）',
    languageZhTW: '中文（繁體）',
    openScreenPermission: 'Open Screen Permission…',
    quit: 'Quit'
  },
  zh: {
    capture: (shortcut) => `截图 (${shortcut})`,
    changeShortcut: '更改快捷键…',
    language: '语言',
    languageEnglish: 'English',
    languageZh: '中文（简体）',
    languageZhTW: '中文（繁體）',
    openScreenPermission: '打开屏幕录制权限…',
    quit: '退出'
  },
  'zh-TW': {
    capture: (shortcut) => `截圖 (${shortcut})`,
    changeShortcut: '變更快捷鍵…',
    language: '語言',
    languageEnglish: 'English',
    languageZh: '中文（简体）',
    languageZhTW: '中文（繁體）',
    openScreenPermission: '開啟螢幕錄製權限…',
    quit: '結束'
  }
}

function formatShortcutForMenu(accelerator: string): string {
  if (process.platform === 'darwin') {
    return accelerator
      .replace(/CommandOrControl/g, '⌘')
      .replace(/Command/g, '⌘')
      .replace(/Control/g, '⌃')
      .replace(/Alt/g, '⌥')
      .replace(/Shift/g, '⇧')
      .replace(/\+/g, '')
  }
  return accelerator.replace(/CommandOrControl/g, 'Ctrl')
}

function unregisterCaptureShortcut(): void {
  if (registeredShortcut) {
    globalShortcut.unregister(registeredShortcut)
    registeredShortcut = null
  }
}

function resumeCaptureShortcutIfIdle(): void {
  const shortcutOpen = shortcutWindow && !shortcutWindow.isDestroyed()
  if (shortcutOpen) return
  captureShortcutSuspended = false
  registerCaptureShortcut(appSettings.captureShortcut)
}

function suspendCaptureShortcut(): void {
  captureShortcutSuspended = true
  unregisterCaptureShortcut()
}

function registerCaptureShortcut(shortcut: string): boolean {
  unregisterCaptureShortcut()
  if (captureShortcutSuspended) return true
  const ok = globalShortcut.register(shortcut, () => startCapture())
  if (ok) {
    registeredShortcut = shortcut
    return true
  }
  console.error(`Failed to register global shortcut: ${shortcut}`)
  return false
}

function ensureCaptureShortcutRegistered(): void {
  if (captureShortcutSuspended) return
  if (registerCaptureShortcut(appSettings.captureShortcut)) return
  if (appSettings.captureShortcut !== DEFAULT_CAPTURE_SHORTCUT) {
    appSettings = saveSettings({ captureShortcut: DEFAULT_CAPTURE_SHORTCUT })
    rebuildTrayMenu()
    if (registerCaptureShortcut(DEFAULT_CAPTURE_SHORTCUT)) return
  }

  // No usable hotkey — walk the user into the picker so they are not left
  // staring at a tray-only app with nothing on screen after dismissing the
  // warning (especially on Windows, where the tray icon is easy to miss).
  void (async () => {
    if (process.platform === 'win32' && tray) {
      tray.displayBalloon({
        title: 'LiteSnap',
        content: 'Capture shortcut unavailable. Pick a new one from the window that opens.',
        iconType: 'warning'
      })
    }
    await dialog.showMessageBox({
      type: 'warning',
      buttons: ['OK'],
      defaultId: 0,
      title: 'Shortcut unavailable',
      message: 'LiteSnap could not register the capture shortcut.',
      detail:
        'The shortcut may be used by another app. Click OK to choose a new shortcut.'
    })
    openShortcutWindow()
  })()
}

function broadcastSettings(): void {
  const targets = [overlayWindow, shortcutWindow]
  for (const win of targets) {
    if (win && !win.isDestroyed()) {
      win.webContents.send('settings-changed', appSettings)
    }
  }
}

function setLanguage(language: Language): void {
  appSettings = saveSettings({ language })
  rebuildTrayMenu()
  broadcastSettings()
}

function setCaptureShortcut(shortcut: string): { ok: boolean; error?: string } {
  const normalized = normalizeAccelerator(shortcut.trim())
  if (!isValidCaptureShortcut(normalized)) {
    return { ok: false, error: 'shortcutInvalid' }
  }

  unregisterCaptureShortcut()
  const ok = globalShortcut.register(normalized, () => startCapture())
  if (!ok) {
    registerCaptureShortcut(appSettings.captureShortcut)
    return { ok: false, error: 'shortcutInUse' }
  }

  registeredShortcut = normalized
  captureShortcutSuspended = false
  appSettings = saveSettings({ captureShortcut: normalized })
  rebuildTrayMenu()
  broadcastSettings()
  return { ok: true }
}

function createPrefsWindow(options: {
  hash: string
  title: string
  width: number
  height: number
  onOpen: (win: BrowserWindow) => void
  onClose: () => void
}): void {
  suspendCaptureShortcut()

  const win = new BrowserWindow({
    width: options.width,
    height: options.height,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    title: options.title,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  options.onOpen(win)

  win.on('closed', () => {
    options.onClose()
    resumeCaptureShortcutIfIdle()
  })

  win.once('ready-to-show', () => {
    win.setTitle(options.title)
    if (process.platform === 'win32') {
      // Prefs windows must surface above other apps — LiteSnap has no main
      // window, so without this the picker can open behind everything.
      win.setAlwaysOnTop(true, 'floating')
    }
    win.show()
    win.focus()
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#${options.hash}`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { hash: options.hash })
  }
}

function openShortcutWindow(): void {
  if (shortcutWindow && !shortcutWindow.isDestroyed()) {
    shortcutWindow.focus()
    return
  }

  createPrefsWindow({
    hash: 'shortcut',
    title: 'LiteSnap',
    width: 400,
    height: 272,
    onOpen: (win) => {
      shortcutWindow = win
    },
    onClose: () => {
      shortcutWindow = null
    }
  })
}

function closeShortcutWindow(): void {
  if (shortcutWindow && !shortcutWindow.isDestroyed()) shortcutWindow.close()
}

function rebuildTrayMenu(): void {
  if (!tray) return
  const tm = TRAY_MESSAGES[appSettings.language] ?? TRAY_MESSAGES.en
  const shortcutLabel = formatShortcutForMenu(appSettings.captureShortcut)
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: tm.capture(shortcutLabel),
        click: (): void => {
          startCapture()
        }
      },
      {
        label: tm.changeShortcut,
        click: (): void => openShortcutWindow()
      },
      {
        label: tm.language,
        submenu: [
          {
            label: tm.languageEnglish,
            type: 'radio',
            checked: appSettings.language === 'en',
            click: (): void => setLanguage('en')
          },
          {
            label: tm.languageZh,
            type: 'radio',
            checked: appSettings.language === 'zh',
            click: (): void => setLanguage('zh')
          },
          {
            label: tm.languageZhTW,
            type: 'radio',
            checked: appSettings.language === 'zh-TW',
            click: (): void => setLanguage('zh-TW')
          }
        ]
      },
      // Screen Recording permission is a macOS-only concept.
      ...(process.platform === 'darwin'
        ? [
            {
              label: tm.openScreenPermission,
              click: (): void => openScreenRecordingSettings()
            }
          ]
        : []),
      { type: 'separator' },
      {
        label: tm.quit,
        click: (): void => app.quit()
      }
    ])
  )
}

function startCapture(): void {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.showInactive()
    return
  }

  void (async () => {
    try {
      const result = await captureScreenBest()
      cachedFullScreenshot = result.png
      captureDisplay = result.display
      captureBounds = result.bounds
      await openOverlayWindow()
    } catch (error) {
      console.error(error)
      cachedFullScreenshot = null
      captureBounds = null
      showCaptureHelp(error instanceof Error ? error.message : String(error))
    }
  })()
}

async function openOverlayWindow(): Promise<void> {
  if (overlayWindow || !cachedFullScreenshot) return

  const display = captureDisplay ?? getActiveDisplay()
  const bounds = captureBounds ?? {
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height
  }

  overlayWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    enableLargerThanScreen: true,
    backgroundColor: '#00000000',
    ...(process.platform === 'darwin' ? { type: 'panel' as const } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      backgroundThrottling: false
    }
  })

  overlayWindow.setAlwaysOnTop(true, 'screen-saver')
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  overlayWindow.setContentProtection(true)
  overlayWindow.setBounds(bounds)

  overlayWindow.on('closed', () => {
    overlayWindow = null
    cachedFullScreenshot = null
    captureDisplay = null
    captureBounds = null
  })

  overlayWindow.once('ready-to-show', () => {
    overlayWindow?.showInactive()
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    overlayWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    overlayWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function showCaptureHelp(detail?: string): void {
  openScreenRecordingSettings()
  void dialog.showMessageBox({
    type: 'error',
    buttons: ['OK'],
    defaultId: 0,
    title: 'Cannot capture screen',
    message: 'LiteSnap needs Screen Recording permission',
    detail: [
      '1. System Settings → Privacy & Security → Screen & System Audio Recording',
      '2. Turn ON LiteSnap (or Electron if running npm run dev)',
      '3. Fully Quit LiteSnap from the menu bar, then open it again',
      '',
      detail ?? ''
    ]
      .filter(Boolean)
      .join('\n')
  })
}


function pngsAreSimilar(a: Buffer, b: Buffer): boolean {
  if (Math.abs(a.length - b.length) > 512) return false
  const len = Math.min(a.length, b.length)
  const step = Math.max(32, Math.floor(len / 600))
  let diff = 0
  for (let i = 0; i < len; i += step) {
    if (a[i] !== b[i]) {
      diff++
      if (diff > 32) return false
    }
  }
  return true
}

function stopScrollPolling(): void {
  if (scrollPollTimer) {
    clearInterval(scrollPollTimer)
    scrollPollTimer = null
  }
  lastScrollPollPNG = null
  scrollPollInFlight = false
}

async function pollScrollCaptureFrame(): Promise<void> {
  if (!scrollCaptureRect || !overlayWindow || overlayWindow.isDestroyed() || scrollPollInFlight) return
  scrollPollInFlight = true
  try {
    const png = await captureScreen(scrollCaptureRect)
    if (lastScrollPollPNG && pngsAreSimilar(lastScrollPollPNG, png)) return
    lastScrollPollPNG = png
    overlayWindow.webContents.send('scroll-capture-frame', pngToBase64(png))
  } catch (error) {
    console.error('Scroll capture poll failed:', error)
  } finally {
    scrollPollInFlight = false
  }
}

function startScrollPolling(): void {
  stopScrollPolling()
  void pollScrollCaptureFrame()
  scrollPollTimer = setInterval(() => {
    void pollScrollCaptureFrame()
  }, 120)
}

async function startScrollCaptureSession(rect: Rect): Promise<void> {
  if (scrollCaptureRect) throw new Error('Scroll capture already in progress')
  scrollCaptureRect = rect
  lastScrollPollPNG = null

  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.hide()
  }

  await new Promise((resolve) => setTimeout(resolve, 120))

  const initialPng = await captureScreen(rect)
  lastScrollPollPNG = initialPng
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('scroll-capture-init', pngToBase64(initialPng))
  }

  openScrollControlWindow()
  startScrollPolling()
}

function cancelScrollCaptureSession(): void {
  stopScrollPolling()
  scrollCaptureRect = null
  if (scrollControlWindow && !scrollControlWindow.isDestroyed()) {
    scrollControlWindow.removeAllListeners('closed')
    scrollControlWindow.close()
  }
  scrollControlWindow = null
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('scroll-capture-cancelled')
    overlayWindow.showInactive()
  }
}

function finishScrollCaptureSession(): void {
  stopScrollPolling()
  scrollCaptureRect = null
  if (scrollControlWindow && !scrollControlWindow.isDestroyed()) {
    scrollControlWindow.removeAllListeners('closed')
    scrollControlWindow.close()
  }
  scrollControlWindow = null
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('scroll-capture-finished')
    overlayWindow.showInactive()
  }
}

function openScrollControlWindow(): void {
  if (scrollControlWindow && !scrollControlWindow.isDestroyed()) {
    scrollControlWindow.focus()
    return
  }

  const display = getActiveDisplay()
  const width = 300
  const height = 420
  const x = display.bounds.x + display.bounds.width - width - 20
  const y = display.bounds.y + Math.round((display.bounds.height - height) / 2)

  scrollControlWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  scrollControlWindow.setAlwaysOnTop(true, 'screen-saver')
  scrollControlWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  // Excludes the panel from screen-capture APIs (NSWindowSharingNone on macOS)
  // so the live preview stays visible to the user but never lands in a frame.
  scrollControlWindow.setContentProtection(true)

  scrollControlWindow.on('closed', () => {
    scrollControlWindow = null
  })

  scrollControlWindow.once('ready-to-show', () => {
    scrollControlWindow?.showInactive()
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void scrollControlWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#scroll-capture`)
  } else {
    void scrollControlWindow.loadFile(join(__dirname, '../renderer/index.html'), {
      hash: 'scroll-capture'
    })
  }
}

function closeOverlay(): void {
  cancelScrollCaptureSession()
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.close()
  overlayWindow = null
  cachedFullScreenshot = null
}

async function captureFreshRegion(rect: Rect): Promise<Buffer> {
  // Opacity only — avoid hide() which can stall renderer IPC on macOS
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.setIgnoreMouseEvents(true)
    overlayWindow.setOpacity(0)
    await sleep(120)
  }
  try {
    return await captureScreen(rect)
  } finally {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.setOpacity(1)
      overlayWindow.setIgnoreMouseEvents(false)
      overlayWindow.showInactive()
    }
  }
}

function createPinWindow(png: Buffer): void {
  pinWindow?.close()
  const img = nativeImage.createFromBuffer(png)
  const { width: pxWidth, height: pxHeight } = img.getSize()
  const display = captureDisplay ?? getActiveDisplay()
  const scaleFactor = display.scaleFactor || 1
  // The PNG is captured at physical-pixel resolution; convert back to the
  // logical size it appeared at on screen so "pin" defaults to actual size.
  const naturalW = Math.max(1, Math.round(pxWidth / scaleFactor))
  const naturalH = Math.max(1, Math.round(pxHeight / scaleFactor))
  const maxW = Math.max(160, display.workAreaSize.width - 40)
  const maxH = Math.max(160, display.workAreaSize.height - 40)
  const fitScale = Math.min(1, maxW / naturalW, maxH / naturalH)
  const winW = Math.max(60, Math.round(naturalW * fitScale))
  const winH = Math.max(60, Math.round(naturalH * fitScale))

  pinWindow = new BrowserWindow({
    width: winW,
    height: winH,
    minWidth: 60,
    minHeight: 60,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: true,
    hasShadow: true,
    webPreferences: { sandbox: true }
  })
  pinWindow.setAlwaysOnTop(true, 'floating')
  // Lock the aspect ratio so free-resizing never distorts the screenshot.
  pinWindow.setAspectRatio(naturalW / Math.max(1, naturalH))

  // Keep the image at native resolution — the CSS scales it to the window,
  // so shrinking/enlarging the pinned window never looks pre-blurred.
  const dataUrl = img.toDataURL()
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    *{margin:0;padding:0;box-sizing:border-box}
    html,body{width:100%;height:100%;background:transparent;overflow:hidden}
    .wrap{width:100%;height:100%;border:1.5px solid #6366f1;border-radius:8px;overflow:hidden;position:relative;-webkit-app-region:drag;box-shadow:0 10px 34px rgba(10,12,24,.34)}
    img{width:100%;height:100%;object-fit:contain;display:block;-webkit-app-region:drag}
    .close{position:absolute;top:6px;right:6px;width:20px;height:20px;border:none;border-radius:10px;background:rgba(12,13,20,.6);color:#fff;font-size:13px;cursor:pointer;-webkit-app-region:no-drag;line-height:20px;opacity:0;transition:opacity .15s ease}
    .wrap:hover .close{opacity:1}
  </style></head><body><div class="wrap"><img src="${dataUrl}"/><button class="close" onclick="window.close()">×</button></div></body></html>`
  pinWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  pinWindow.on('closed', () => {
    pinWindow = null
  })
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.litesnap.app')
  appSettings = loadSettings()

  if (process.platform === 'darwin') {
    app.dock?.hide()
  }

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  void desktopCapturer
    .getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } })
    .catch(() => undefined)

  const trayImage = nativeImage.createFromPath(trayIconAsset).resize({
    width: process.platform === 'darwin' ? 18 : 16,
    height: process.platform === 'darwin' ? 18 : 16,
    quality: 'best'
  })
  tray = new Tray(trayImage)
  tray.setToolTip('LiteSnap')
  rebuildTrayMenu()
  // Windows hides tray icons in the overflow area; left-click must open the
  // menu because users often don't know to right-click.
  if (process.platform === 'win32') {
    tray.on('click', () => {
      tray?.popUpContextMenu()
    })
  }

  // Register after the tray exists so a failed hotkey can still surface UI.
  ensureCaptureShortcutRegistered()

  ipcMain.on('close-overlay', () => closeOverlay())

  ipcMain.handle('get-full-screenshot', async () => {
    if (!cachedFullScreenshot) {
      const result = await captureScreenBest()
      cachedFullScreenshot = result.png
      captureDisplay = result.display
      captureBounds = result.bounds
    }
    const display = captureDisplay ?? getActiveDisplay()
    const bounds = captureBounds ?? {
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height
    }
    const image = nativeImage.createFromBuffer(cachedFullScreenshot)
    const { width: imageWidth, height: imageHeight } = image.getSize()
    return {
      base64: pngToBase64(cachedFullScreenshot),
      displayWidth: bounds.width,
      displayHeight: bounds.height,
      imageWidth,
      imageHeight
    }
  })

  ipcMain.handle('capture-scroll-frame', async (_event, rect: Rect) => {
    try {
      return pngToBase64(await captureFreshRegion(rect))
    } catch (error) {
      showCaptureHelp(error instanceof Error ? error.message : String(error))
      throw error
    }
  })

  ipcMain.handle('begin-scroll-capture', async (_event, rect: Rect) => {
    try {
      await startScrollCaptureSession(rect)
      return true
    } catch (error) {
      showCaptureHelp(error instanceof Error ? error.message : String(error))
      throw error
    }
  })

  ipcMain.handle('finish-scroll-capture', async () => {
    finishScrollCaptureSession()
    return true
  })

  ipcMain.handle('cancel-scroll-capture', async () => {
    cancelScrollCaptureSession()
    return true
  })

  ipcMain.on(
    'scroll-capture-preview',
    (_event, payload: { base64: string; width: number; height: number }) => {
      if (scrollControlWindow && !scrollControlWindow.isDestroyed()) {
        scrollControlWindow.webContents.send('scroll-capture-preview', payload)
      }
    }
  )

  ipcMain.handle('check-screen-permission', async () => ({
    granted:
      process.platform !== 'darwin' ||
      systemPreferences.getMediaAccessStatus('screen') === 'granted',
    status:
      process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('screen') : 'granted'
  }))

  ipcMain.handle('copy-image', async (_event, data: Uint8Array) => {
    clipboard.writeImage(nativeImage.createFromBuffer(bufferFromIpcData(data)))
    closeOverlay()
    return true
  })

  ipcMain.handle('save-image', async (_event, data: Uint8Array) => {
    const png = bufferFromIpcData(data)
    clipboard.writeImage(nativeImage.createFromBuffer(png))
    closeOverlay()
    await sleep(150)
    const result = await dialog.showSaveDialog({
      title: 'Save Screenshot',
      defaultPath: join(app.getPath('pictures'), `LiteSnap-${Date.now()}.png`),
      filters: [{ name: 'PNG Image', extensions: ['png'] }]
    })
    if (result.canceled || !result.filePath) return false
    writeFileSync(result.filePath, png)
    return true
  })

  ipcMain.handle('pin-image', async (_event, data: Uint8Array) => {
    createPinWindow(bufferFromIpcData(data))
    closeOverlay()
    return true
  })

  ipcMain.handle('open-url', async (_event, url: string) => {
    await shell.openExternal(url)
    return true
  })

  ipcMain.handle('get-settings', () => appSettings)

  ipcMain.handle('set-language', (_event, language: Language) => {
    if (language !== 'en' && language !== 'zh' && language !== 'zh-TW') return appSettings
    setLanguage(language)
    return appSettings
  })

  ipcMain.handle('set-capture-shortcut', (_event, shortcut: string) => {
    const result = setCaptureShortcut(shortcut)
    return {
      ok: result.ok,
      settings: appSettings,
      error: result.error
    }
  })

  ipcMain.handle('begin-shortcut-recording', () => {
    suspendCaptureShortcut()
  })

  ipcMain.handle('end-shortcut-recording', () => {
    resumeCaptureShortcutIfIdle()
  })

  ipcMain.on('close-shortcut-window', () => closeShortcutWindow())
})

app.on('window-all-closed', () => {
  // Keep running in the system tray
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})
