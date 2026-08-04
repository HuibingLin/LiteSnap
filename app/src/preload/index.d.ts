import { ElectronAPI } from '@electron-toolkit/preload'

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

export interface Api {
  closeOverlay: () => void
  getFullScreenshot: () => Promise<FullScreenshot>
  beginScrollCapture: (rect: SelectionRect) => Promise<boolean>
  finishScrollCapture: () => Promise<boolean>
  cancelScrollCapture: () => Promise<boolean>
  sendScrollCapturePreview: (payload: {
    base64: string
    width: number
    height: number
  }) => void
  onScrollCaptureFrame: (callback: (base64: string) => void) => () => void
  onScrollCaptureInit: (callback: (base64: string) => void) => () => void
  onScrollCaptureFinished: (callback: () => void) => () => void
  onScrollCaptureCancelled: (callback: () => void) => () => void
  onScrollCapturePreview: (
    callback: (payload: { base64: string; width: number; height: number }) => void
  ) => () => void
  sendScrollCapturePreview: (payload: {
    base64: string
    width: number
    height: number
  }) => void
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

declare global {
  interface Window {
    electron: ElectronAPI
    api: Api
  }
}

export {}
