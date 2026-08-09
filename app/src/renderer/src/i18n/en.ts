export interface Messages {
  toolbar: {
    rectangle: string
    ellipse: string
    emojiSticker: string
    arrow: string
    pen: string
    highlight: string
    mosaic: string
    text: string
    color: string
    translate: string
    ocr: string
    search: string
    scrollCapture: string
    undo: string
    save: string
    pin: string
    cancel: string
    done: string
  }
  hints: {
    dragToSelect: string
    loading: string
    capturing: string
    working: string
    adjustRegion: string
  }
  scrollCapture: {
    capture: string
    cancel: string
    done: string
    capturing: string
    failed: string
    preview: string
    previewEmpty: string
    scrollPreviewHint: string
  }
  ocr: {
    title: string
    copy: string
    close: string
    noTextFound: string
    noTextDetected: string
  }
  errors: {
    decodeFailed: string
    captureFailed: string
    loadFailed: string
  }
  settings: {
    title: string
    language: string
    shortcut: string
    shortcutHint: string
    changeShortcut: string
    pressShortcut: string
    save: string
    cancel: string
    saved: string
    shortcutInvalid: string
    shortcutInUse: string
    shortcutPressNow: string
    saving: string
  }
  textEditor: {
    drag: string
    placeholder: string
    done: string
    cancel: string
    moveHint: string
    emojiMoveHint: string
  }
}

export const en: Messages = {
  toolbar: {
    rectangle: 'Rectangle',
    ellipse: 'Ellipse',
    emojiSticker: 'Emoji sticker',
    arrow: 'Arrow',
    pen: 'Pen',
    highlight: 'Highlighter',
    mosaic: 'Mosaic',
    text: 'Text',
    color: 'Color',
    translate: 'Translate',
    ocr: 'Extract text (OCR)',
    search: 'Search',
    scrollCapture: 'Scroll capture',
    undo: 'Undo',
    save: 'Save',
    pin: 'Pin on screen',
    cancel: 'Cancel',
    done: 'Done (copy)'
  },
  hints: {
    dragToSelect: 'Drag to select a region · Esc to cancel',
    loading: 'Loading screenshot…',
    capturing: 'Capturing screen…',
    working: 'Working…',
    adjustRegion: 'Drag the handles to resize · Drag inside to move · Pick a tool to annotate'
  },
  scrollCapture: {
    capture: 'Capture next frame',
    cancel: 'Cancel',
    done: 'Done',
    capturing: 'Capturing…',
    failed: 'Scroll capture failed',
    preview: 'Live preview',
    previewEmpty: 'Scroll to build the long screenshot…',
    scrollPreviewHint: 'Scroll here to preview the full image'
  },
  ocr: {
    title: 'Extracted text',
    copy: 'Copy text',
    close: 'Close',
    noTextFound: 'No text found.',
    noTextDetected: '(no text detected)'
  },
  errors: {
    decodeFailed: 'Failed to decode screenshot',
    captureFailed: 'Screen capture failed',
    loadFailed: 'Failed to load screenshot'
  },
  settings: {
    title: 'Settings',
    language: 'Language',
    shortcut: 'Capture shortcut',
    shortcutHint: 'Click the field below, press your desired key combination, then Save.',
    changeShortcut: 'Change shortcut',
    pressShortcut: 'Press a shortcut…',
    save: 'Save',
    cancel: 'Cancel',
    saved: 'Shortcut saved.',
    shortcutInvalid: 'Invalid shortcut. Use at least one modifier (⌥, ⌘, Ctrl, ⇧) plus a key.',
    shortcutInUse: 'That shortcut is already used by another app.',
    shortcutPressNow: 'Press a new key combination, then click Save.',
    saving: 'Saving…'
  },
  textEditor: {
    drag: 'Drag to move',
    placeholder: 'Type text…',
    done: 'Done',
    cancel: 'Cancel',
    moveHint: 'Drag text to move · Double-click to edit',
    emojiMoveHint: 'Drag to move · Drag corner to resize · Backspace to delete'
  }
}
