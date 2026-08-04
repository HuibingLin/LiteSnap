import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

export type Language = 'en' | 'zh' | 'zh-TW'

// Alt+A is fine on macOS, but on Windows it is commonly taken by IMEs /
// other utilities, so prefer a less contested default there.
export const DEFAULT_CAPTURE_SHORTCUT =
  process.platform === 'win32' ? 'Control+Shift+A' : 'Alt+A'

export interface AppSettings {
  language: Language
  captureShortcut: string
}

const DEFAULT_SETTINGS: AppSettings = {
  language: 'en',
  captureShortcut: DEFAULT_CAPTURE_SHORTCUT
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function isValidAccelerator(accelerator: string): boolean {
  const parts = accelerator.split('+').filter(Boolean)
  if (parts.length < 2) return false
  const key = parts[parts.length - 1]
  const mods = parts.slice(0, -1)
  const validMods = new Set([
    'Command',
    'Control',
    'Alt',
    'Shift',
    'CommandOrControl',
    'Meta',
    'Super'
  ])
  return mods.every((mod) => validMods.has(mod)) && key.length > 0
}

export function loadSettings(): AppSettings {
  try {
    if (existsSync(settingsPath())) {
      const parsed = JSON.parse(readFileSync(settingsPath(), 'utf-8')) as Partial<AppSettings>
      const language: Language =
        parsed.language === 'zh-TW'
          ? 'zh-TW'
          : parsed.language === 'zh'
            ? 'zh'
            : 'en'
      const captureShortcut =
        typeof parsed.captureShortcut === 'string'
          ? normalizeAccelerator(parsed.captureShortcut)
          : DEFAULT_CAPTURE_SHORTCUT
      return {
        language,
        captureShortcut: isValidAccelerator(captureShortcut)
          ? captureShortcut
          : DEFAULT_CAPTURE_SHORTCUT
      }
    }
  } catch {
    // ignore corrupt settings
  }
  return { ...DEFAULT_SETTINGS }
}

export function saveSettings(partial: Partial<AppSettings>): AppSettings {
  const current = loadSettings()
  const next: AppSettings = { ...current, ...partial }
  if (
    partial.language !== undefined &&
    partial.language !== 'en' &&
    partial.language !== 'zh' &&
    partial.language !== 'zh-TW'
  ) {
    next.language = current.language
  }
  if (partial.captureShortcut !== undefined) {
    const normalized = normalizeAccelerator(partial.captureShortcut)
    next.captureShortcut = isValidAccelerator(normalized)
      ? normalized
      : current.captureShortcut
  }
  writeFileSync(settingsPath(), JSON.stringify(next, null, 2))
  return next
}

export function normalizeAccelerator(raw: string): string {
  return raw
    .split('+')
    .filter(Boolean)
    .map((part) => {
      switch (part) {
        case 'Cmd':
        case 'Meta':
        case 'Super':
          return 'Command'
        case 'Ctrl':
          return 'Control'
        case 'Option':
          return 'Alt'
        default:
          return part.length === 1 ? part.toUpperCase() : part
      }
    })
    .join('+')
}

export function isValidCaptureShortcut(accelerator: string): boolean {
  return isValidAccelerator(normalizeAccelerator(accelerator))
}
