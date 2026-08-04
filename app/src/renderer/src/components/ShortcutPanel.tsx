import { useCallback, useEffect, useState } from 'react'
import { useI18n } from '../i18n'

function formatShortcutLabel(shortcut: string): string {
  return shortcut
    .replace(/CommandOrControl/g, '⌘/Ctrl')
    .replace(/Command/g, '⌘')
    .replace(/Control/g, 'Ctrl')
    .replace(/Alt/g, '⌥')
    .replace(/Shift/g, '⇧')
    .replace(/\+/g, ' + ')
}

function codeToElectronKey(code: string): string | null {
  if (code.startsWith('Key')) return code.slice(3).toUpperCase()
  if (code.startsWith('Digit')) return code.slice(5)
  if (code.startsWith('Numpad')) return code.replace('Numpad', 'Num')
  const named: Record<string, string> = {
    Space: 'Space',
    Enter: 'Enter',
    Escape: 'Escape',
    Tab: 'Tab',
    Backspace: 'Backspace',
    Delete: 'Delete',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Minus: '-',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
    Backquote: '`'
  }
  return named[code] ?? null
}

function keyEventToAccelerator(event: KeyboardEvent): string | null {
  if (event.repeat) return null

  const mods: string[] = []
  if (event.metaKey) mods.push('Command')
  if (event.ctrlKey) mods.push('Control')
  if (event.altKey) mods.push('Alt')
  if (event.shiftKey) mods.push('Shift')
  if (mods.length === 0) return null

  const key = codeToElectronKey(event.code)
  if (!key) return null

  return [...mods, key].join('+')
}

function ShortcutPanel(): React.JSX.Element {
  const { t } = useI18n()
  const [draft, setDraft] = useState('')
  const [recording, setRecording] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    void window.api.getSettings().then((settings) => {
      setDraft(settings.captureShortcut)
    })
  }, [])

  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!recording || saving) return
      event.preventDefault()
      event.stopPropagation()
      const accelerator = keyEventToAccelerator(event)
      if (accelerator) setDraft(accelerator)
    },
    [recording, saving]
  )

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [onKeyDown])

  const saveShortcut = useCallback(async () => {
    if (!draft) {
      setError(t.settings.shortcutInvalid)
      return
    }
    setSaving(true)
    setError(null)
    setSaved(false)
    const result = await window.api.setCaptureShortcut(draft)
    setSaving(false)
    if (!result.ok) {
      setError(
        result.error === 'shortcutInUse' ? t.settings.shortcutInUse : t.settings.shortcutInvalid
      )
      return
    }
    setDraft(result.settings.captureShortcut)
    setSaved(true)
    setRecording(false)
    setTimeout(() => window.api.closeShortcutWindow(), 600)
  }, [draft, t.settings.shortcutInUse, t.settings.shortcutInvalid])

  return (
    <div className="shortcut-panel">
      <h1 className="shortcut-panel__title">{t.settings.changeShortcut}</h1>
      <p className="shortcut-panel__hint">{t.settings.shortcutPressNow}</p>
      <div className={`shortcut-panel__display${recording ? ' is-recording' : ''}`}>
        {draft ? formatShortcutLabel(draft) : t.settings.pressShortcut}
      </div>
      <div className="scroll-capture-control__actions">
        <button
          type="button"
          className="settings-btn"
          disabled={saving || !draft}
          onClick={() => void saveShortcut()}
        >
          {saving ? t.settings.saving : t.settings.save}
        </button>
        <button
          type="button"
          className="settings-btn settings-btn--ghost"
          disabled={saving}
          onClick={() => window.api.closeShortcutWindow()}
        >
          {t.settings.cancel}
        </button>
      </div>
      {error && <p className="settings-error">{error}</p>}
      {saved && <p className="settings-success">{t.settings.saved}</p>}
    </div>
  )
}

export default ShortcutPanel
