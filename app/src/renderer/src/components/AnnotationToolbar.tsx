import { useI18n } from '../i18n'
import TooltipButton from './TooltipButton'

export type AnnotTool =
  | 'rect'
  | 'ellipse'
  | 'arrow'
  | 'pen'
  | 'highlight'
  | 'mosaic'
  | 'text'
  | 'emoji'
  | null

export const STROKE_COLORS = [
  '#f43f5e',
  '#f59e0b',
  '#22c55e',
  '#3b82f6',
  '#6366f1',
  '#ffffff',
  '#15161d'
] as const

export function toolUsesColor(tool: AnnotTool): boolean {
  return tool === 'rect' || tool === 'ellipse' || tool === 'arrow' || tool === 'pen' || tool === 'highlight' || tool === 'text'
}

interface AnnotationToolbarProps {
  tool: AnnotTool
  canUndo: boolean
  toolsDisabled?: boolean
  scrollCaptureDisabled?: boolean
  confirmDisabled?: boolean
  showEmojiPicker?: boolean
  onToolChange: (tool: AnnotTool) => void
  onUndo: () => void
  onScrollCapture: () => void
  onSave: () => void
  onPin: () => void
  onCancel: () => void
  onConfirm: () => void
  style?: React.CSSProperties
}

function AnnotationToolbar({
  tool,
  canUndo,
  toolsDisabled,
  scrollCaptureDisabled,
  confirmDisabled,
  showEmojiPicker,
  onToolChange,
  onUndo,
  onScrollCapture,
  onSave,
  onPin,
  onCancel,
  onConfirm,
  style
}: AnnotationToolbarProps): React.JSX.Element {
  const { t } = useI18n()
  const locked = Boolean(toolsDisabled)

  return (
    <div className="wx-toolbar" style={style} onMouseDown={(e) => e.stopPropagation()}>
      <div className="wx-toolbar__group">
        <TooltipButton label={t.toolbar.rectangle} active={tool === 'rect'} disabled={locked} onClick={() => onToolChange(tool === 'rect' ? null : 'rect')}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="4" y="5" width="16" height="14" rx="1.5" /></svg>
        </TooltipButton>
        <TooltipButton label={t.toolbar.ellipse} active={tool === 'ellipse'} disabled={locked} onClick={() => onToolChange(tool === 'ellipse' ? null : 'ellipse')}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8"><ellipse cx="12" cy="12" rx="8" ry="6" /></svg>
        </TooltipButton>
        <TooltipButton label={t.toolbar.emojiSticker} active={tool === 'emoji' || showEmojiPicker} disabled={locked} onClick={() => onToolChange(tool === 'emoji' ? null : 'emoji')}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9" /><path d="M8.5 10.5 H8.51" /><path d="M15.5 10.5 H15.51" /><path d="M8.5 15 C9.5 17 14.5 17 15.5 15" /></svg>
        </TooltipButton>
        <TooltipButton label={t.toolbar.arrow} active={tool === 'arrow'} disabled={locked} onClick={() => onToolChange(tool === 'arrow' ? null : 'arrow')}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M5 19 L19 5" /><path d="M11 5 H19 V13" /></svg>
        </TooltipButton>
        <TooltipButton label={t.toolbar.pen} active={tool === 'pen'} disabled={locked} onClick={() => onToolChange(tool === 'pen' ? null : 'pen')}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 20 L8.5 18.5 L19 8 L16 5 L5.5 15.5 Z" /><path d="M14.5 6.5 L17.5 9.5" /></svg>
        </TooltipButton>
        <TooltipButton label={t.toolbar.highlight} active={tool === 'highlight'} disabled={locked} onClick={() => onToolChange(tool === 'highlight' ? null : 'highlight')}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 20 L10.5 18.5 L18.5 6.5 L13.5 4.5 L5.5 16.5 Z" /><path d="M9 14 L11 16" /></svg>
        </TooltipButton>
        <TooltipButton label={t.toolbar.mosaic} active={tool === 'mosaic'} disabled={locked} onClick={() => onToolChange(tool === 'mosaic' ? null : 'mosaic')}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><rect x="3" y="3" width="5" height="5" opacity="0.9" /><rect x="10" y="3" width="5" height="5" opacity="0.45" /><rect x="17" y="3" width="4" height="5" opacity="0.75" /><rect x="3" y="10" width="5" height="5" opacity="0.5" /><rect x="10" y="10" width="5" height="5" opacity="0.85" /><rect x="17" y="10" width="4" height="5" opacity="0.4" /><rect x="3" y="17" width="5" height="4" opacity="0.7" /><rect x="10" y="17" width="5" height="4" opacity="0.35" /><rect x="17" y="17" width="4" height="4" opacity="0.9" /></svg>
        </TooltipButton>
        <TooltipButton label={t.toolbar.text} active={tool === 'text'} disabled={locked} onClick={() => onToolChange(tool === 'text' ? null : 'text')}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M5 6 H19" /><path d="M12 6 V19" /><path d="M8 19 H16" /></svg>
        </TooltipButton>
      </div>

      <div className="wx-toolbar__divider" />

      <div className="wx-toolbar__group">
        <TooltipButton
          label={t.toolbar.scrollCapture}
          disabled={locked || scrollCaptureDisabled}
          onClick={onScrollCapture}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="7" y="3" width="10" height="18" rx="1" strokeDasharray="3 2" /><path d="M12 7 V17" /><path d="M9 14 L12 17 L15 14" /></svg>
        </TooltipButton>
      </div>

      <div className="wx-toolbar__divider" />

      <div className="wx-toolbar__group">
        <TooltipButton label={t.toolbar.undo} disabled={locked || !canUndo} onClick={onUndo}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M8 8 H5 V5" /><path d="M5 8 C7 4 17 3 19 10" /><path d="M19 14 C17 19 8 20 6 15" /></svg>
        </TooltipButton>
        <TooltipButton label={t.toolbar.save} disabled={locked || confirmDisabled} onClick={onSave}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 4 V14" /><path d="M8 10 L12 14 L16 10" /><path d="M5 18 H19" /></svg>
        </TooltipButton>
        <TooltipButton label={t.toolbar.pin} disabled={locked || confirmDisabled} onClick={onPin}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 17v5" /><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16h14v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" /></svg>
        </TooltipButton>
      </div>

      <div className="wx-toolbar__divider" />

      <div className="wx-toolbar__group">
        <TooltipButton label={t.toolbar.cancel} danger onClick={onCancel}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M7 7 L17 17" /><path d="M17 7 L7 17" /></svg>
        </TooltipButton>
        <TooltipButton label={t.toolbar.done} success disabled={confirmDisabled} onClick={onConfirm}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M5 12.5 L10 17.5 L19 7" /></svg>
        </TooltipButton>
      </div>
    </div>
  )
}

export default AnnotationToolbar
