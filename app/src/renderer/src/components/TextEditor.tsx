import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n'
import { STROKE_COLORS } from './AnnotationToolbar'

export const TEXT_SIZES = [16, 24, 36, 48] as const
export type TextSize = (typeof TEXT_SIZES)[number]

export interface TextEditorState {
  id?: string
  canvasX: number
  canvasY: number
  left: number
  top: number
  scale: number
  fontSize: TextSize
  color: string
}

export interface TextObject {
  id: string
  text: string
  canvasX: number
  canvasY: number
  scale: number
  fontSize: TextSize
  color: string
}

interface TextEditorProps {
  editor: TextEditorState
  draft: string
  onDraftChange: (value: string) => void
  onMove: (left: number, top: number, canvasX: number, canvasY: number) => void
  onFontSizeChange: (size: TextSize) => void
  onColorChange: (color: string) => void
  onCommit: (screenLeft: number, screenTop: number) => void
  onCancel: () => void
  screenToCanvas: (left: number, top: number) => { canvasX: number; canvasY: number }
}

function TextEditor({
  editor,
  draft,
  onDraftChange,
  onMove,
  onFontSizeChange,
  onColorChange,
  onCommit,
  onCancel,
  screenToCanvas
}: TextEditorProps): React.JSX.Element {
  const { t } = useI18n()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const dragRef = useRef<{
    startX: number
    startY: number
    originLeft: number
    originTop: number
  } | null>(null)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  useEffect(() => {
    const onMoveWin = (event: MouseEvent): void => {
      if (!dragRef.current) return
      const dx = event.clientX - dragRef.current.startX
      const dy = event.clientY - dragRef.current.startY
      const left = Math.max(8, Math.min(window.innerWidth - 80, dragRef.current.originLeft + dx))
      const top = Math.max(8, Math.min(window.innerHeight - 40, dragRef.current.originTop + dy))
      const point = screenToCanvas(left, top)
      onMove(left, top, point.canvasX, point.canvasY)
    }
    const onUp = (): void => {
      dragRef.current = null
      setDragging(false)
    }
    window.addEventListener('mousemove', onMoveWin)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMoveWin)
      window.removeEventListener('mouseup', onUp)
    }
  }, [onMove, screenToCanvas])

  const displayFontSize = Math.max(12, Math.round(editor.fontSize * Math.min(1.2, editor.scale)))

  return (
    <div
      className={`text-editor${dragging ? ' is-dragging' : ''}`}
      style={{ left: editor.left, top: editor.top }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        className="text-editor__drag"
        onMouseDown={(event) => {
          event.preventDefault()
          dragRef.current = {
            startX: event.clientX,
            startY: event.clientY,
            originLeft: editor.left,
            originTop: editor.top
          }
          setDragging(true)
        }}
      >
        <span>{t.textEditor.drag}</span>
      </div>

      <div className="text-editor__toolbar">
        <div className="text-editor__sizes">
          {TEXT_SIZES.map((size) => (
            <button
              key={size}
              type="button"
              className={`text-editor__size-btn${editor.fontSize === size ? ' is-active' : ''}`}
              onClick={() => onFontSizeChange(size)}
            >
              {size}
            </button>
          ))}
        </div>
        <div className="text-editor__colors">
          {STROKE_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              className={`color-swatch${editor.color === color ? ' is-active' : ''}`}
              style={{ backgroundColor: color }}
              aria-label={color}
              onClick={() => onColorChange(color)}
            />
          ))}
        </div>
      </div>

      <textarea
        ref={textareaRef}
        className="text-editor__input"
        style={{
          color: editor.color,
          fontSize: displayFontSize,
          minWidth: Math.max(160, displayFontSize * 6),
          minHeight: Math.max(36, displayFontSize + 16)
        }}
        value={draft}
        placeholder={t.textEditor.placeholder}
        rows={2}
        onChange={(e) => onDraftChange(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
            return
          }
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            const rect = textareaRef.current?.getBoundingClientRect()
            onCommit(rect?.left ?? editor.left, rect?.top ?? editor.top)
          }
        }}
      />

      <div className="text-editor__actions">
        <button type="button" className="settings-btn settings-btn--ghost" onClick={onCancel}>
          {t.textEditor.cancel}
        </button>
        <button
          type="button"
          className="settings-btn"
          onClick={() => {
            const rect = textareaRef.current?.getBoundingClientRect()
            onCommit(rect?.left ?? editor.left, rect?.top ?? editor.top)
          }}
        >
          {t.textEditor.done}
        </button>
      </div>
    </div>
  )
}

export default TextEditor
