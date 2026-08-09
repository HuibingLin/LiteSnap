import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow, PhysicalSize } from '@tauri-apps/api/window'

export default function PinImage(): React.JSX.Element {
  const [base64, setBase64] = useState('')
  const aspectRatio = useRef(1)
  const correctingSize = useRef(false)

  useEffect(() => {
    void invoke<string>('get_pin_image').then(setBase64)
  }, [])

  useEffect(() => {
    const appWindow = getCurrentWindow()
    let disposed = false
    let unlisten: (() => void) | undefined

    void appWindow
      .onResized(({ payload: size }) => {
        if (disposed || correctingSize.current || aspectRatio.current <= 0) return

        // Project the freely-resized native window back onto the image's
        // aspect ratio. This remains smooth for corner and edge resizing and
        // prevents object-fit letterboxing from making the image and window
        // sizes disagree.
        const ratio = aspectRatio.current
        const projectedHeight = (ratio * size.width + size.height) / (ratio * ratio + 1)
        const nextHeight = Math.max(projectedHeight, 60, 60 / ratio)
        const nextWidth = ratio * nextHeight

        if (Math.abs(nextWidth - size.width) <= 1 && Math.abs(nextHeight - size.height) <= 1) return
        correctingSize.current = true
        const corrected = new PhysicalSize(Math.round(nextWidth), Math.round(nextHeight))
        void appWindow.setSize(corrected).finally(() => {
          correctingSize.current = false
        })
      })
      .then((off) => {
        if (disposed) off()
        else unlisten = off
      })

    return () => {
      disposed = true
      unlisten?.()
    }
  }, [])

  const startDragging = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return
    event.preventDefault()
    void getCurrentWindow().startDragging()
  }

  return (
    <div className="pin-wrap" onPointerDown={startDragging}>
      {base64 ? (
        <img
          src={`data:image/png;base64,${base64}`}
          draggable={false}
          onLoad={(event) => {
            const image = event.currentTarget
            aspectRatio.current = image.naturalWidth / Math.max(1, image.naturalHeight)
          }}
        />
      ) : null}
      <button
        type="button"
        className="pin-close"
        aria-label="Close"
        title="Close"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => void getCurrentWindow().destroy()}
      >
        ×
      </button>
      <button
        type="button"
        className="pin-resize"
        aria-label="Resize"
        title="Resize"
        onPointerDown={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void getCurrentWindow().startResizeDragging('SouthEast')
        }}
      />
    </div>
  )
}
