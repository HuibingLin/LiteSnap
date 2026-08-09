import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

export interface SelectionRect {
  x: number
  y: number
  width: number
  height: number
}

export type Language = 'en' | 'zh' | 'zh-TW'

export interface AppSettings {
  language: Language
  captureShortcut: string
  launchAtStartup: boolean
}

export interface SetShortcutResult {
  ok: boolean
  settings: AppSettings
  error?: string
}

export interface FullScreenshot {
  base64: string
  displayWidth: number
  displayHeight: number
  imageWidth: number
  imageHeight: number
}

export interface ScrollCaptureResult {
  base64: string
  imageWidth: number
  imageHeight: number
}

export interface Api {
  closeOverlay: () => void
  showCaptureOverlay: () => Promise<boolean>
  getFullScreenshot: () => Promise<FullScreenshot>
  beginScrollCapture: (rect: SelectionRect) => Promise<boolean>
  scrollControlReady: () => Promise<void>
  finishScrollCapture: () => Promise<boolean>
  cancelScrollCapture: () => Promise<boolean>
  onScrollCaptureFinished: (callback: () => void) => () => void
  onScrollCaptureResult: (callback: (payload: ScrollCaptureResult) => void) => () => void
  onScrollCaptureCancelled: (callback: () => void) => () => void
  onScrollCaptureStarted: (callback: () => void) => () => void
  onScrollCapturePreview: (callback: (payload: ScrollPreview) => void) => () => void
  checkScreenPermission: () => Promise<{ granted: boolean; status: string }>
  copyImage: (png: Uint8Array) => Promise<boolean>
  saveImage: (png: Uint8Array) => Promise<boolean>
  pinImage: (png: Uint8Array) => Promise<boolean>
  openUrl: (url: string) => Promise<boolean>
  getSettings: () => Promise<AppSettings>
  setLanguage: (language: Language) => Promise<AppSettings>
  setCaptureShortcut: (shortcut: string) => Promise<SetShortcutResult>
  beginShortcutRecording: () => Promise<void>
  endShortcutRecording: () => Promise<void>
  closeShortcutWindow: () => void
  onSettingsChanged: (callback: (settings: AppSettings) => void) => () => void
}

interface ScrollPreview {
  base64: string
  width: number
  height: number
}

function subscribe<T>(event: string, callback: (payload: T) => void): () => void {
  let disposed = false
  let unlisten: UnlistenFn | undefined
  void listen<T>(event, ({ payload }) => callback(payload)).then((off) => {
    if (disposed) off()
    else unlisten = off
  })
  return () => {
    disposed = true
    unlisten?.()
  }
}

const bytes = (png: Uint8Array): number[] => Array.from(png)

export const api: Api = {
  closeOverlay: () => void invoke('close_overlay'),
  showCaptureOverlay: () => invoke('show_capture_overlay'),
  getFullScreenshot: () => invoke('get_full_screenshot'),
  beginScrollCapture: (rect) => invoke('begin_scroll_capture', { rect }),
  scrollControlReady: () => invoke('scroll_control_ready'),
  finishScrollCapture: () => invoke('finish_scroll_capture'),
  cancelScrollCapture: () => invoke('cancel_scroll_capture'),
  onScrollCaptureFinished: (callback) => subscribe('scroll-capture-finished', callback),
  onScrollCaptureResult: (callback) => subscribe('scroll-capture-result', callback),
  onScrollCaptureCancelled: (callback) => subscribe('scroll-capture-cancelled', callback),
  onScrollCaptureStarted: (callback) => subscribe('scroll-capture-started', callback),
  onScrollCapturePreview: (callback) => subscribe('scroll-capture-preview', callback),
  checkScreenPermission: () => invoke('check_screen_permission'),
  copyImage: (png) => invoke('copy_image', { data: bytes(png) }),
  saveImage: (png) => invoke('save_image', { data: bytes(png) }),
  pinImage: (png) => invoke('pin_image', { data: bytes(png) }),
  openUrl: (url) => invoke('open_url', { url }),
  getSettings: () => invoke('get_settings'),
  setLanguage: (language) => invoke('set_language', { language }),
  setCaptureShortcut: (shortcut) => invoke('set_capture_shortcut', { shortcut }),
  beginShortcutRecording: () => invoke('begin_shortcut_recording'),
  endShortcutRecording: () => invoke('end_shortcut_recording'),
  closeShortcutWindow: () => void invoke('close_shortcut_window'),
  onSettingsChanged: (callback) => subscribe('settings-changed', callback)
}

declare global {
  interface Window {
    api: Api
  }
}

window.api = api
