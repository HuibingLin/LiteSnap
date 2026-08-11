import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow, PhysicalSize } from '@tauri-apps/api/window'

export default function PinImage(): React.JSX.Element {
  const [imageUrl, setImageUrl] = useState('')
  const imageUrlRef = useRef('')
  const aspectRatio = useRef(1)
  const correctingSize = useRef(false)
  const userResizing = useRef(false)
  const resizeIdleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined

    const refreshImage = async (): Promise<void> => {
      try {
        const png = await invoke<string>('get_pin_image')
        if (disposed) return
        const nextUrl = `data:image/png;base64,${png}`
        imageUrlRef.current = nextUrl
        setImageUrl(nextUrl)
      } catch {
        // The Windows pin renderer is prewarmed before an image exists. The
        // update event below supplies the first image when the user pins one.
      }
    }

    // Register first, then request current data. This closes the race between
    // the hidden prewarmed renderer loading and the first pin operation.
    void listen('pin-image-updated', () => void refreshImage()).then((off) => {
      if (disposed) {
        off()
        return
      }
      unlisten = off
      void refreshImage()
    })

    return () => {
      disposed = true
      unlisten?.()
      imageUrlRef.current = ''
    }
  }, [])

  useEffect(() => {
    const appWindow = getCurrentWindow()
    let disposed = false
    let unlisten: (() => void) | undefined

    void appWindow
      .onResized(({ payload: size }) => {
        // Native code also resizes this prewarmed window whenever a new image
        // is pinned. Only project sizes back to the image ratio while the user
        // is actively dragging the resize handle; otherwise the previous
        // image's ratio can overwrite the new screenshot's exact dimensions.
        if (
          disposed ||
          !userResizing.current ||
          correctingSize.current ||
          aspectRatio.current <= 0
        )
          return

        if (resizeIdleTimer.current) clearTimeout(resizeIdleTimer.current)
        resizeIdleTimer.current = setTimeout(() => {
          userResizing.current = false
          resizeIdleTimer.current = null
        }, 180)

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
      if (resizeIdleTimer.current) clearTimeout(resizeIdleTimer.current)
      resizeIdleTimer.current = null
      userResizing.current = false
    }
  }, [])

  const startDragging = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return
    event.preventDefault()
    void getCurrentWindow().startDragging()
  }

  return (
    <div className="pin-wrap" onPointerDown={startDragging}>
      {imageUrl ? (
        <img
          src={imageUrl}
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
        onClick={() => void invoke('close_pin_window')}
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
          userResizing.current = true
          if (resizeIdleTimer.current) clearTimeout(resizeIdleTimer.current)
          void getCurrentWindow()
            .startResizeDragging('SouthEast')
            .catch(() => {
              userResizing.current = false
            })
        }}
      />
    </div>
  )
}
