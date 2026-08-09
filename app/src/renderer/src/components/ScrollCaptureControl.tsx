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
    const offStarted = window.api.onScrollCaptureStarted(() => {
      setPreview(null)
      if (previewRef.current) {
        previewRef.current.scrollTop = 0
        previewRef.current.scrollLeft = 0
      }
    })
    const offPreview = window.api.onScrollCapturePreview((payload) => {
      setPreview(payload)
      requestAnimationFrame(() => {
        const el = previewRef.current
        if (el) el.scrollTop = el.scrollHeight
      })
    })
    // Register all listeners first, then tell the native side it is safe to
    // send the baseline preview. The first Windows WebView is created lazily
    // and can otherwise miss the initial event while navigation is in flight.
    const readyTimer = window.setTimeout(() => {
      void window.api.scrollControlReady()
    }, 50)
    return () => {
      window.clearTimeout(readyTimer)
      offStarted()
      offPreview()
    }
  }, [])

  return (
    <div className="scroll-capture-control">
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
