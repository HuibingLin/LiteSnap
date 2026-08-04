import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

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

const api = {
  closeOverlay: (): void => ipcRenderer.send('close-overlay'),
  getFullScreenshot: (): Promise<FullScreenshot> => ipcRenderer.invoke('get-full-screenshot'),
  beginScrollCapture: (rect: SelectionRect): Promise<boolean> =>
    ipcRenderer.invoke('begin-scroll-capture', rect),
  finishScrollCapture: (): Promise<boolean> => ipcRenderer.invoke('finish-scroll-capture'),
  cancelScrollCapture: (): Promise<boolean> => ipcRenderer.invoke('cancel-scroll-capture'),
  sendScrollCapturePreview: (payload: {
    base64: string
    width: number
    height: number
  }): void => ipcRenderer.send('scroll-capture-preview', payload),
  onScrollCaptureFrame: (callback: (base64: string) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, base64: string): void => {
      callback(base64)
    }
    ipcRenderer.on('scroll-capture-frame', listener)
    return () => ipcRenderer.removeListener('scroll-capture-frame', listener)
  },
  onScrollCaptureInit: (callback: (base64: string) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, base64: string): void => {
      callback(base64)
    }
    ipcRenderer.on('scroll-capture-init', listener)
    return () => ipcRenderer.removeListener('scroll-capture-init', listener)
  },
  onScrollCaptureFinished: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('scroll-capture-finished', listener)
    return () => ipcRenderer.removeListener('scroll-capture-finished', listener)
  },
  onScrollCaptureCancelled: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('scroll-capture-cancelled', listener)
    return () => ipcRenderer.removeListener('scroll-capture-cancelled', listener)
  },
  onScrollCapturePreview: (
    callback: (payload: { base64: string; width: number; height: number }) => void
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: { base64: string; width: number; height: number }
    ): void => {
      callback(payload)
    }
    ipcRenderer.on('scroll-capture-preview', listener)
    return () => ipcRenderer.removeListener('scroll-capture-preview', listener)
  },
  checkScreenPermission: (): Promise<{ granted: boolean; status: string }> =>
    ipcRenderer.invoke('check-screen-permission'),
  copyImage: (png: Uint8Array): Promise<boolean> => ipcRenderer.invoke('copy-image', png),
  saveImage: (png: Uint8Array): Promise<boolean> => ipcRenderer.invoke('save-image', png),
  pinImage: (png: Uint8Array): Promise<boolean> => ipcRenderer.invoke('pin-image', png),
  openUrl: (url: string): Promise<boolean> => ipcRenderer.invoke('open-url', url),
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('get-settings'),
  setLanguage: (language: Language): Promise<AppSettings> =>
    ipcRenderer.invoke('set-language', language),
  setCaptureShortcut: (shortcut: string): Promise<SetShortcutResult> =>
    ipcRenderer.invoke('set-capture-shortcut', shortcut),
  beginShortcutRecording: (): Promise<void> => ipcRenderer.invoke('begin-shortcut-recording'),
  endShortcutRecording: (): Promise<void> => ipcRenderer.invoke('end-shortcut-recording'),
  closeShortcutWindow: (): void => ipcRenderer.send('close-shortcut-window'),
  onSettingsChanged: (callback: (settings: AppSettings) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, settings: AppSettings): void => {
      callback(settings)
    }
    ipcRenderer.on('settings-changed', listener)
    return () => ipcRenderer.removeListener('settings-changed', listener)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
