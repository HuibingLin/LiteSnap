import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n'

function ScrollCaptureControl(): React.JSX.Element {
  const { t } = useI18n()
  const previewRef = useRef<HTMLDivElement>(null)
  const [preview, setPreview] = useState<{
    base64: string
    width: number
    height: number
  } | null>(null)

  useEffect(() => {
    return window.api.onScrollCapturePreview((payload) => {
      setPreview(payload)
      requestAnimationFrame(() => {
        const el = previewRef.current
        if (el) el.scrollTop = el.scrollHeight
      })
    })
  }, [])

  return (
    <div className="scroll-capture-control">
      <p className="scroll-capture-control__hint">{t.scrollCapture.hint}</p>
      <div className="scroll-capture-control__preview-wrap">
        <p className="scroll-capture-control__preview-label">{t.scrollCapture.preview}</p>
        <div ref={previewRef} className="scroll-capture-control__preview">
          {preview ? (
            <img
              className="scroll-capture-control__preview-img"
              src={`data:image/png;base64,${preview.base64}`}
              alt=""
              style={{ width: '100%', height: 'auto' }}
            />
          ) : (
            <div className="scroll-capture-control__preview-empty">{t.scrollCapture.previewEmpty}</div>
          )}
        </div>
        {preview && preview.height > 0 && (
          <p className="scroll-capture-control__preview-meta">
            {Math.round(preview.width)} × {Math.round(preview.height)}
          </p>
        )}
      </div>
      <div className="scroll-capture-control__actions">
        <button type="button" className="settings-btn" onClick={() => void window.api.finishScrollCapture()}>
          {t.scrollCapture.done}
        </button>
        <button
          type="button"
          className="settings-btn settings-btn--ghost"
          onClick={() => void window.api.cancelScrollCapture()}
        >
          {t.scrollCapture.cancel}
        </button>
      </div>
    </div>
  )
}

export default ScrollCaptureControl
