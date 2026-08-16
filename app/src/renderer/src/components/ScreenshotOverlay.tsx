import { useCallback, useEffect, useRef, useState } from 'react'
import type { Selection } from '../store'
import { useStore } from '../store'
import { useI18n } from '../i18n'
import AnnotationToolbar, {
  STROKE_COLORS,
  toolUsesColor,
  type AnnotTool
} from './AnnotationToolbar'
import { loadPngFromBase64 } from '../utils/scrollStitch'
import ColorPalette from './ColorPalette'
import EmojiPicker from './EmojiPicker'
import TextEditor, {
  TEXT_SIZES,
  type TextEditorState,
  type TextObject,
  type TextSize
} from './TextEditor'

const MIN_SIZE = 8
const LINE_WIDTH = 3
const HIGHLIGHT_WIDTH = 20
const HIGHLIGHT_ALPHA = 0.32

// Intrinsic widths of the floating bars, used only to position them; both bars
// size themselves from their content so these must track the CSS metrics.
const TOOLBAR_WIDTH = 492
const PALETTE_WIDTH = 176

const DEFAULT_EMOJI_SIZE = 40
const EMOJI_MIN_SIZE = 16
const EMOJI_MAX_SIZE = 240

const TOOLBAR_HEIGHT = 42
const PALETTE_HEIGHT = 40
const EMOJI_PICKER_HEIGHT = 380

interface EmojiObject {
  id: string
  emoji: string
  canvasX: number
  canvasY: number
  size: number
  scale: number
}

const RESIZE_HANDLES = ['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se'] as const
type ResizeHandle = (typeof RESIZE_HANDLES)[number]

const HANDLE_CURSORS: Record<ResizeHandle, string> = {
  nw: 'nwse-resize',
  n: 'ns-resize',
  ne: 'nesw-resize',
  w: 'ew-resize',
  e: 'ew-resize',
  sw: 'nesw-resize',
  s: 'ns-resize',
  se: 'nwse-resize'
}

function resizeRect(origin: Selection, handle: ResizeHandle, dx: number, dy: number): Selection {
  const right = origin.x + origin.width
  const bottom = origin.y + origin.height
  let { x, y, width, height } = origin

  if (handle.includes('w')) {
    x = Math.max(0, Math.min(origin.x + dx, right - MIN_SIZE))
    width = right - x
  }
  if (handle.includes('e')) {
    width = Math.max(MIN_SIZE, Math.min(right + dx, window.innerWidth) - x)
  }
  if (handle.includes('n')) {
    y = Math.max(0, Math.min(origin.y + dy, bottom - MIN_SIZE))
    height = bottom - y
  }
  if (handle.includes('s')) {
    height = Math.max(MIN_SIZE, Math.min(bottom + dy, window.innerHeight) - y)
  }
  return { x, y, width, height }
}

function moveRect(origin: Selection, dx: number, dy: number): Selection {
  const x = Math.max(0, Math.min(origin.x + dx, window.innerWidth - origin.width))
  const y = Math.max(0, Math.min(origin.y + dy, window.innerHeight - origin.height))
  return { ...origin, x, y }
}

function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace('#', '')
  const r = parseInt(normalized.slice(0, 2), 16)
  const g = parseInt(normalized.slice(2, 4), 16)
  const b = parseInt(normalized.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function strokeHighlightPath(
  ctx: CanvasRenderingContext2D,
  points: Array<{ x: number; y: number }>,
  color: string,
  lineWidth: number
): void {
  if (points.length === 0) return
  ctx.save()
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
  ctx.strokeStyle = hexToRgba(color, HIGHLIGHT_ALPHA)
  ctx.lineWidth = lineWidth
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
  ctx.stroke()
  ctx.restore()
}

function normalizeRect(x1: number, y1: number, x2: number, y2: number): Selection {
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1)
  }
}

function clampPoint(x: number, y: number): { x: number; y: number } {
  return {
    x: Math.max(0, Math.min(x, window.innerWidth)),
    y: Math.max(0, Math.min(y, window.innerHeight))
  }
}

function clampSelection(rect: Selection): Selection {
  const maxW = window.innerWidth
  const maxH = window.innerHeight
  const x = Math.max(0, Math.min(rect.x, maxW - MIN_SIZE))
  const y = Math.max(0, Math.min(rect.y, maxH - MIN_SIZE))
  const width = Math.max(MIN_SIZE, Math.min(rect.width, maxW - x))
  const height = Math.max(MIN_SIZE, Math.min(rect.height, maxH - y))
  return { x, y, width, height }
}

function syncImageScale(image: HTMLImageElement): { scaleX: number; scaleY: number } {
  return {
    scaleX: image.naturalWidth / Math.max(1, window.innerWidth),
    scaleY: image.naturalHeight / Math.max(1, window.innerHeight)
  }
}

// Windows benefits from two paint opportunities before revealing the native
// overlay, but macOS pauses requestAnimationFrame for a hidden WebView. Always
// resolve through a short timer as a fallback so the hidden capture window can
// never wait forever and fail to open.
function waitForOverlayPaint(): Promise<void> {
  return new Promise((resolve) => {
    let settled = false
    let timer = 0
    const finish = (): void => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      resolve()
    }
    timer = window.setTimeout(finish, 48)
    requestAnimationFrame(() => {
      requestAnimationFrame(finish)
    })
  })
}

function selectionToImageCrop(
  rect: Selection,
  image: HTMLImageElement,
  heightOverride?: number
): { sx: number; sy: number; sw: number; sh: number } {
  const { scaleX, scaleY } = syncImageScale(image)
  const logicalH = heightOverride ?? rect.height
  let sx = Math.floor(rect.x * scaleX)
  let sy = Math.floor(rect.y * scaleY)
  let sw = Math.ceil((rect.x + rect.width) * scaleX) - sx
  let sh = Math.ceil((rect.y + logicalH) * scaleY) - sy
  sx = Math.max(0, Math.min(sx, image.naturalWidth - 1))
  sy = Math.max(0, Math.min(sy, image.naturalHeight - 1))
  sw = Math.max(1, Math.min(sw, image.naturalWidth - sx))
  sh = Math.max(1, Math.min(sh, image.naturalHeight - sy))
  return { sx, sy, sw, sh }
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): void {
  const length = Math.hypot(x2 - x1, y2 - y1)
  if (length < 1) return

  // Annotation coordinates are physical canvas pixels. On Retina displays the
  // canvas is commonly 2x the CSS size, so a fixed 12px arrowhead becomes only
  // 6px on screen and is almost invisible. Derive it from the already-scaled
  // stroke width and cap it for short arrows.
  const head = Math.min(Math.max(16, ctx.lineWidth * 5), length * 0.55)
  const wingAngle = Math.PI / 5
  const angle = Math.atan2(y2 - y1, x2 - x1)
  const shaftInset = head * Math.cos(wingAngle)
  const shaftEndX = x2 - shaftInset * Math.cos(angle)
  const shaftEndY = y2 - shaftInset * Math.sin(angle)

  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  // End the round-capped shaft underneath the arrowhead. Drawing it all the
  // way to (x2, y2) lets the cap protrude past the tip, which is especially
  // visible as a detached-looking dot on a Retina canvas.
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(shaftEndX, shaftEndY)
  ctx.stroke()

  ctx.beginPath()
  ctx.moveTo(x2, y2)
  ctx.lineTo(x2 - head * Math.cos(angle - wingAngle), y2 - head * Math.sin(angle - wingAngle))
  ctx.lineTo(x2 - head * Math.cos(angle + wingAngle), y2 - head * Math.sin(angle + wingAngle))
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

function applyMosaic(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  block = 10
): void {
  const sx = Math.max(0, Math.floor(x))
  const sy = Math.max(0, Math.floor(y))
  const sw = Math.max(1, Math.floor(w))
  const sh = Math.max(1, Math.floor(h))
  if (sw < 2 || sh < 2) return
  const imageData = ctx.getImageData(sx, sy, sw, sh)
  const { data, width, height } = imageData
  for (let by = 0; by < height; by += block) {
    for (let bx = 0; bx < width; bx += block) {
      let r = 0,
        g = 0,
        b = 0,
        count = 0
      const bw = Math.min(block, width - bx)
      const bh = Math.min(block, height - by)
      for (let yy = 0; yy < bh; yy++) {
        for (let xx = 0; xx < bw; xx++) {
          const i = ((by + yy) * width + (bx + xx)) * 4
          r += data[i]
          g += data[i + 1]
          b += data[i + 2]
          count++
        }
      }
      r = Math.round(r / count)
      g = Math.round(g / count)
      b = Math.round(b / count)
      for (let yy = 0; yy < bh; yy++) {
        for (let xx = 0; xx < bw; xx++) {
          const i = ((by + yy) * width + (bx + xx)) * 4
          data[i] = r
          data[i + 1] = g
          data[i + 2] = b
        }
      }
    }
  }
  ctx.putImageData(imageData, sx, sy)
}

function ScreenshotOverlay(): React.JSX.Element {
  const { t } = useI18n()
  const bgRef = useRef<HTMLCanvasElement>(null)
  const shotRef = useRef<HTMLCanvasElement>(null)
  const shotViewportRef = useRef<HTMLDivElement>(null)
  const fullImageRef = useRef<HTMLImageElement | null>(null)
  const origin = useRef({ x: 0, y: 0 })
  const drawOrigin = useRef({ x: 0, y: 0 })
  const history = useRef<ImageData[]>([])
  const penDrawing = useRef(false)
  const highlightDrawing = useRef(false)
  const highlightPoints = useRef<Array<{ x: number; y: number }>>([])
  const scrollCapturing = useRef(false)
  const scrollResultReceived = useRef(false)
  const pendingAction = useRef(0)
  const initialSelectionHeight = useRef(0)
  const imageScaleRef = useRef({ scaleX: 1, scaleY: 1 })
  const lastTextFontSize = useRef<TextSize>(TEXT_SIZES[1])
  const textDragRef = useRef<{
    id: string
    startX: number
    startY: number
    originCanvasX: number
    originCanvasY: number
  } | null>(null)
  const emojiDragRef = useRef<{
    id: string
    mode: 'move' | 'resize'
    startX: number
    startY: number
    originCanvasX: number
    originCanvasY: number
    originSize: number
  } | null>(null)
  const regionDragRef = useRef<{
    handle: ResizeHandle | 'move'
    startX: number
    startY: number
    origin: Selection
    // Pixels captured when the drag began, so shrinking then re-growing the
    // region restores annotations instead of losing them.
    baseCanvas: HTMLCanvasElement
    baseSx: number
    baseSy: number
    baseTextObjects: TextObject[]
    baseEmojiObjects: EmojiObject[]
  } | null>(null)

  const [phase, setPhase] = useState<'loading' | 'selecting' | 'editing'>('loading')
  const [dragging, setDragging] = useState(false)
  const [drawing, setDrawing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [shotReady, setShotReady] = useState(false)
  const [tool, setTool] = useState<AnnotTool>(null)
  const [strokeColor, setStrokeColor] = useState<string>(STROKE_COLORS[0])
  const [canUndo, setCanUndo] = useState(false)
  const [selectedEmoji, setSelectedEmoji] = useState('😀')
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [textEditor, setTextEditor] = useState<TextEditorState | null>(null)
  const [textDraft, setTextDraft] = useState('')
  const [textObjects, setTextObjects] = useState<TextObject[]>([])
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null)
  const [emojiObjects, setEmojiObjects] = useState<EmojiObject[]>([])
  const [selectedEmojiId, setSelectedEmojiId] = useState<string | null>(null)
  const [editHeight, setEditHeight] = useState(0)
  const [viewScrollTop, setViewScrollTop] = useState(0)
  const [adjustingRegion, setAdjustingRegion] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selection = useStore((s) => s.selection)
  const setSelection = useStore((s) => s.setSelection)

  const displayHeight = selection ? editHeight || selection.height : 0
  // Scroll capture starts a fresh frame-stitching pipeline. Mixing that pipeline
  // with an annotated canvas corrupts its baseline and can leave the overlay busy
  // forever, so only allow it while the selected crop is still untouched.
  const hasAnnotations =
    canUndo || textObjects.length > 0 || emojiObjects.length > 0 || textEditor !== null || drawing
  const isLongImage =
    initialSelectionHeight.current > 0 && displayHeight > initialSelectionHeight.current + 2
  // A stitched long screenshot is no longer a plain crop of the frozen frame,
  // so the region can only be re-cropped for ordinary captures.
  const canAdjustRegion = phase === 'editing' && shotReady && !busy && !isLongImage && !tool

  const paintBackground = useCallback(
    (rect: Selection | null, holeHeight?: number, scrollTop = 0, showStroke = true) => {
      const canvas = bgRef.current
      const image = fullImageRef.current
      if (!canvas || !image) return
      imageScaleRef.current = syncImageScale(image)
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const { width, height } = canvas
      ctx.clearRect(0, 0, width, height)
      ctx.drawImage(image, 0, 0, width, height)
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)'
      ctx.fillRect(0, 0, width, height)
      if (rect && rect.width > 0 && rect.height > 0) {
        const visibleHeight = holeHeight ?? rect.height
        const { sx, sy, sw, sh } = selectionToImageCrop(rect, image, visibleHeight)
        const { scaleY } = imageScaleRef.current
        const scrollOffset = Math.floor(scrollTop * scaleY)
        const holeSy = Math.max(0, sy - scrollOffset)
        const shot = shotRef.current
        const useShot = shot && visibleHeight > initialSelectionHeight.current + 2

        if (useShot) {
          const srcY = Math.max(0, Math.floor((scrollTop / visibleHeight) * shot.height))
          const srcH = Math.max(1, shot.height - srcY)
          ctx.drawImage(shot, 0, srcY, shot.width, srcH, sx, holeSy, sw, sh)
        } else {
          ctx.drawImage(image, sx, sy, sw, sh, sx, sy, sw, sh)
        }
        if (showStroke) {
          ctx.strokeStyle = '#6366f1'
          ctx.lineWidth = 2
          const strokeY = useShot ? holeSy : sy
          ctx.strokeRect(sx + 1, strokeY + 1, sw - 2, sh - 2)
        }
      }
    },
    []
  )

  const pushHistory = useCallback(() => {
    const canvas = shotRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    history.current.push(ctx.getImageData(0, 0, canvas.width, canvas.height))
    if (history.current.length > 30) history.current.shift()
    setCanUndo(history.current.length > 0)
  }, [])

  const undo = useCallback(() => {
    const canvas = shotRef.current
    const snapshot = history.current.pop()
    if (!canvas || !snapshot) return
    canvas.getContext('2d')?.putImageData(snapshot, 0, 0)
    setCanUndo(history.current.length > 0)
  }, [])

  useEffect(() => {
    const offResult = window.api.onScrollCaptureResult((result) => {
      if (!scrollCapturing.current || !selection) return
      scrollResultReceived.current = true
      void (async () => {
        try {
          const image = await loadPngFromBase64(result.base64)
          const canvas = shotRef.current
          if (!canvas) return
          canvas.width = result.imageWidth
          canvas.height = result.imageHeight
          const ctx = canvas.getContext('2d')
          if (!ctx) return
          ctx.imageSmoothingEnabled = false
          ctx.drawImage(image, 0, 0)
          const finalHeight =
            (result.imageHeight / Math.max(1, result.imageWidth)) * selection.width
          setEditHeight(finalHeight)
          setViewScrollTop(0)
          history.current = []
          setCanUndo(false)
          paintBackground({ ...selection, height: finalHeight }, finalHeight, 0)
          scrollCapturing.current = false
          setBusy(false)
          await waitForOverlayPaint()
          await window.api.showCaptureOverlay()
          requestAnimationFrame(() => {
            const viewport = shotViewportRef.current
            // The completed long screenshot should open at its beginning so
            // the user can inspect the capture from top to bottom. Previously
            // this jumped straight to the tail, making it look as if the
            // beginning had not been captured.
            if (viewport) viewport.scrollTop = 0
          })
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to decode long screenshot')
          scrollCapturing.current = false
          setBusy(false)
          void window.api.showCaptureOverlay()
        }
      })()
    })
    const offDone = window.api.onScrollCaptureFinished(() => {
      if (scrollResultReceived.current) return
      scrollCapturing.current = false
      setBusy(false)
      void window.api.showCaptureOverlay()
    })
    const offCancel = window.api.onScrollCaptureCancelled(() => {
      scrollCapturing.current = false
      scrollResultReceived.current = false
      setBusy(false)
    })
    return () => {
      offResult()
      offDone()
      offCancel()
    }
  }, [selection, paintBackground])

  const exportPng = useCallback(async (): Promise<Uint8Array> => {
    const canvas = shotRef.current
    if (!canvas) throw new Error('No canvas')

    const exportCanvas = document.createElement('canvas')
    exportCanvas.width = canvas.width
    exportCanvas.height = canvas.height
    const ctx = exportCanvas.getContext('2d')
    if (!ctx) throw new Error('Canvas unavailable')
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(canvas, 0, 0)
    for (const obj of textObjects) {
      const fontPx = Math.round(obj.fontSize * obj.scale)
      ctx.fillStyle = obj.color
      ctx.font = `bold ${fontPx}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
      ctx.textBaseline = 'top'
      const lines = obj.text.split('\n')
      const lineHeight = Math.round(fontPx * 1.25)
      lines.forEach((line, index) => {
        ctx.fillText(line, obj.canvasX, obj.canvasY + index * lineHeight)
      })
    }
    for (const obj of emojiObjects) {
      const glyphPx = Math.round(obj.size * obj.scale)
      ctx.font = `${glyphPx}px -apple-system, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`
      ctx.textBaseline = 'top'
      ctx.fillText(obj.emoji, obj.canvasX, obj.canvasY)
    }

    const blob = await new Promise<Blob>((resolve, reject) => {
      exportCanvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png')
    })
    return new Uint8Array(await blob.arrayBuffer())
  }, [textObjects, emojiObjects])

  const cancelOverlay = useCallback(() => {
    // Invalidate an export that is still waiting for canvas encoding before it
    // reaches the native pin/save/copy command.
    pendingAction.current += 1
    setBusy(false)
    window.api.closeOverlay()
  }, [])

  const screenToCanvas = useCallback(
    (left: number, top: number): { canvasX: number; canvasY: number } => {
      const canvas = shotRef.current
      if (!canvas || !selection) return { canvasX: 0, canvasY: 0 }
      const scale = canvas.width / Math.max(1, selection.width)
      const viewport = shotViewportRef.current
      const scrollTop = viewport?.scrollTop ?? 0
      return {
        canvasX: (left - selection.x) * scale,
        canvasY: (top - selection.y + scrollTop) * scale
      }
    },
    [selection]
  )

  const commitText = useCallback(
    (value: string, screenLeft?: number, screenTop?: number) => {
      const draft = value.trim()
      if (!textEditor) {
        setTextEditor(null)
        setTextDraft('')
        return
      }
      if (draft) {
        const point =
          screenLeft !== undefined && screenTop !== undefined
            ? screenToCanvas(screenLeft, screenTop)
            : { canvasX: textEditor.canvasX, canvasY: textEditor.canvasY }
        const next: TextObject = {
          id: textEditor.id ?? `text-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          text: draft,
          canvasX: point.canvasX,
          canvasY: point.canvasY,
          scale: textEditor.scale,
          fontSize: textEditor.fontSize,
          color: textEditor.color
        }
        setTextObjects((prev) => {
          const idx = prev.findIndex((item) => item.id === next.id)
          if (idx >= 0) {
            const copy = [...prev]
            copy[idx] = next
            return copy
          }
          return [...prev, next]
        })
        setSelectedTextId(next.id)
      }
      setTextEditor(null)
      setTextDraft('')
    },
    [textEditor, screenToCanvas]
  )

  const cancelTextEditor = useCallback(() => {
    setTextEditor(null)
    setTextDraft('')
  }, [])

  const openTextObjectEditor = useCallback(
    (obj: TextObject) => {
      const canvas = shotRef.current
      if (!canvas || !selection) return
      const scale = canvas.width / Math.max(1, selection.width)
      const viewport = shotViewportRef.current
      const scrollTop = viewport?.scrollTop ?? 0
      const textLeft = selection.x + obj.canvasX / scale
      const textTop = selection.y + obj.canvasY / scale - scrollTop
      // Offset so the textarea (below drag handle + size/color bar) lands on the text
      const panelOffsetY = 58
      setSelectedTextId(obj.id)
      setTextDraft(obj.text)
      setTextEditor({
        id: obj.id,
        canvasX: obj.canvasX,
        canvasY: obj.canvasY,
        left: Math.max(8, textLeft),
        top: Math.max(8, textTop - panelOffsetY),
        scale: obj.scale,
        fontSize: obj.fontSize,
        color: obj.color
      })
      lastTextFontSize.current = obj.fontSize
      setStrokeColor(obj.color)
      setTool('text')
    },
    [selection]
  )

  // Load frozen screenshot once
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const shot = await window.api.getFullScreenshot()
        if (cancelled) return
        const img = await loadPngFromBase64(shot.base64)
        if (cancelled) return
        fullImageRef.current = img
        imageScaleRef.current = syncImageScale(img)
        const canvas = bgRef.current
        if (!canvas) return
        canvas.width = shot.imageWidth
        canvas.height = shot.imageHeight
        imageScaleRef.current = syncImageScale(img)
        paintBackground(null)
        setPhase('selecting')
        setError(null)
        await waitForOverlayPaint()
        if (cancelled) return
        await window.api.showCaptureOverlay()
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load screenshot')
          setPhase('selecting')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [paintBackground])

  useEffect(() => {
    if (phase === 'loading') return
    if (phase === 'editing' && selection) {
      paintBackground(selection, editHeight || selection.height, viewScrollTop)
      return
    }
    paintBackground(selection)
  }, [selection, phase, editHeight, viewScrollTop, paintBackground])

  const enterEditMode = useCallback(
    (rect: Selection) => {
      const image = fullImageRef.current
      const bg = bgRef.current
      if (!image || !bg) {
        setError('Screenshot not ready')
        return
      }

      const clamped = clampSelection(rect)
      imageScaleRef.current = syncImageScale(image)

      setPhase('editing')
      setEditHeight(clamped.height)
      initialSelectionHeight.current = clamped.height
      setViewScrollTop(0)
      setTool(null)
      setShowEmojiPicker(false)
      setShotReady(false)
      setTextObjects([])
      setSelectedTextId(null)
      setTextEditor(null)
      setTextDraft('')
      setEmojiObjects([])
      setSelectedEmojiId(null)
      setSelection(clamped)
      paintBackground(clamped, clamped.height, 0, true)

      // Crop synchronously from the already-frozen image — unlock tools immediately after
      requestAnimationFrame(() => {
        const canvas = shotRef.current
        if (!canvas) {
          setError('Editor canvas missing')
          return
        }
        const { sx, sy, sw, sh } = selectionToImageCrop(clamped, image)

        canvas.width = sw
        canvas.height = sh
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.imageSmoothingEnabled = false
        ctx.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh)
        history.current = []
        setCanUndo(false)
        setShotReady(true)
        setError(null)
      })
    },
    [paintBackground, setSelection]
  )

  // Re-derives the crop for a new region: fills it from the frozen screenshot,
  // then stamps the drag's starting pixels back on top so annotations survive.
  const recropSelection = useCallback(
    (next: Selection) => {
      const image = fullImageRef.current
      const canvas = shotRef.current
      const drag = regionDragRef.current
      if (!image || !canvas || !drag) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      const { sx, sy, sw, sh } = selectionToImageCrop(next, image)
      canvas.width = sw
      canvas.height = sh
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh)

      const dx = drag.baseSx - sx
      const dy = drag.baseSy - sy
      ctx.drawImage(drag.baseCanvas, dx, dy)

      setTextObjects(
        drag.baseTextObjects.map((item) => ({
          ...item,
          canvasX: item.canvasX + dx,
          canvasY: item.canvasY + dy
        }))
      )
      setEmojiObjects(
        drag.baseEmojiObjects.map((item) => ({
          ...item,
          canvasX: item.canvasX + dx,
          canvasY: item.canvasY + dy
        }))
      )

      initialSelectionHeight.current = next.height
      setEditHeight(next.height)
      setSelection(next)
    },
    [setSelection]
  )

  const beginRegionDrag = useCallback(
    (handle: ResizeHandle | 'move', event: React.MouseEvent) => {
      const image = fullImageRef.current
      const canvas = shotRef.current
      if (!image || !canvas || !selection) return
      const { sx, sy } = selectionToImageCrop(selection, image)

      const baseCanvas = document.createElement('canvas')
      baseCanvas.width = canvas.width
      baseCanvas.height = canvas.height
      baseCanvas.getContext('2d')?.drawImage(canvas, 0, 0)

      regionDragRef.current = {
        handle,
        startX: event.clientX,
        startY: event.clientY,
        origin: selection,
        baseCanvas,
        baseSx: sx,
        baseSy: sy,
        baseTextObjects: textObjects,
        baseEmojiObjects: emojiObjects
      }
      // The raster changes size, so previous ImageData snapshots no longer fit.
      history.current = []
      setCanUndo(false)
      setSelectedTextId(null)
      setSelectedEmojiId(null)
      setAdjustingRegion(true)
    },
    [selection, textObjects, emojiObjects]
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (textEditor) return
      if (event.key === 'Escape') {
        if (selectedTextId) {
          setSelectedTextId(null)
          return
        }
        if (selectedEmojiId) {
          setSelectedEmojiId(null)
          return
        }
        cancelOverlay()
        return
      }
      if (
        (event.key === 'Backspace' || event.key === 'Delete') &&
        (selectedTextId || selectedEmojiId) &&
        phase === 'editing'
      ) {
        event.preventDefault()
        if (selectedTextId) {
          setTextObjects((prev) => prev.filter((item) => item.id !== selectedTextId))
          setSelectedTextId(null)
        }
        if (selectedEmojiId) {
          setEmojiObjects((prev) => prev.filter((item) => item.id !== selectedEmojiId))
          setSelectedEmojiId(null)
        }
        return
      }
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === 'z' &&
        phase === 'editing'
      ) {
        event.preventDefault()
        undo()
      }
      if (event.key === 'Enter' && phase === 'editing' && shotReady && !busy) {
        event.preventDefault()
        void (async () => {
          setBusy(true)
          try {
            await window.api.copyImage(await exportPng())
          } finally {
            setBusy(false)
          }
        })()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [phase, busy, shotReady, undo, exportPng, cancelOverlay, textEditor, selectedTextId, selectedEmojiId])

  useEffect(() => {
    const onMove = (event: MouseEvent): void => {
      const canvas = shotRef.current
      if (!canvas || !selection) return
      const scale = canvas.width / Math.max(1, selection.width)

      const regionDrag = regionDragRef.current
      if (regionDrag) {
        const dx = event.clientX - regionDrag.startX
        const dy = event.clientY - regionDrag.startY
        recropSelection(
          regionDrag.handle === 'move'
            ? moveRect(regionDrag.origin, dx, dy)
            : resizeRect(regionDrag.origin, regionDrag.handle, dx, dy)
        )
        return
      }

      const textDrag = textDragRef.current
      if (textDrag) {
        const dx = (event.clientX - textDrag.startX) * scale
        const dy = (event.clientY - textDrag.startY) * scale
        setTextObjects((prev) =>
          prev.map((item) =>
            item.id === textDrag.id
              ? {
                  ...item,
                  canvasX: Math.max(0, textDrag.originCanvasX + dx),
                  canvasY: Math.max(0, textDrag.originCanvasY + dy)
                }
              : item
          )
        )
      }

      const emojiDrag = emojiDragRef.current
      if (emojiDrag) {
        if (emojiDrag.mode === 'move') {
          const dx = (event.clientX - emojiDrag.startX) * scale
          const dy = (event.clientY - emojiDrag.startY) * scale
          setEmojiObjects((prev) =>
            prev.map((item) =>
              item.id === emojiDrag.id
                ? {
                    ...item,
                    canvasX: Math.max(0, emojiDrag.originCanvasX + dx),
                    canvasY: Math.max(0, emojiDrag.originCanvasY + dy)
                  }
                : item
            )
          )
        } else {
          const delta = (event.clientX - emojiDrag.startX + (event.clientY - emojiDrag.startY)) / 2
          const nextSize = Math.max(
            EMOJI_MIN_SIZE,
            Math.min(EMOJI_MAX_SIZE, emojiDrag.originSize + delta)
          )
          setEmojiObjects((prev) =>
            prev.map((item) => (item.id === emojiDrag.id ? { ...item, size: nextSize } : item))
          )
        }
      }
    }
    const onUp = (): void => {
      textDragRef.current = null
      emojiDragRef.current = null
      if (regionDragRef.current) {
        regionDragRef.current = null
        setAdjustingRegion(false)
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [selection, recropSelection])

  const onBgMouseDown = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      if (phase !== 'selecting' || busy) return
      setDragging(true)
      const point = clampPoint(event.clientX, event.clientY)
      origin.current = point
      setSelection({ x: point.x, y: point.y, width: 0, height: 0 })
    },
    [phase, busy, setSelection]
  )

  const onBgMouseMove = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      if (!dragging || phase !== 'selecting') return
      const point = clampPoint(event.clientX, event.clientY)
      setSelection(
        clampSelection(normalizeRect(origin.current.x, origin.current.y, point.x, point.y))
      )
    },
    [dragging, phase, setSelection]
  )

  const onBgMouseUp = useCallback(() => {
    if (!dragging || phase !== 'selecting') return
    setDragging(false)
    const current = useStore.getState().selection
    if (current && current.width >= MIN_SIZE && current.height >= MIN_SIZE) {
      enterEditMode(clampSelection(current))
    } else {
      setSelection(null)
    }
  }, [dragging, phase, enterEditMode, setSelection])

  const toLocal = (event: React.MouseEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const canvas = shotRef.current
    if (!canvas) return { x: 0, y: 0 }
    const bounds = canvas.getBoundingClientRect()
    return {
      x: ((event.clientX - bounds.left) * canvas.width) / Math.max(1, bounds.width),
      y: ((event.clientY - bounds.top) * canvas.height) / Math.max(1, bounds.height)
    }
  }

  const onShotMouseDown = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      if (phase !== 'editing' || busy || !shotReady) return
      setSelectedTextId(null)
      setSelectedEmojiId(null)
      if (!tool) {
        if (canAdjustRegion) {
          event.preventDefault()
          beginRegionDrag('move', event)
        }
        return
      }
      const canvas = shotRef.current
      const ctx = canvas?.getContext('2d')
      if (!canvas || !ctx) return
      const point = toLocal(event)
      const scale = canvas.width / Math.max(1, selection?.width || canvas.width)

      if (tool === 'emoji') {
        const id = `emoji-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
        const newObj: EmojiObject = {
          id,
          emoji: selectedEmoji,
          canvasX: point.x,
          canvasY: point.y,
          size: DEFAULT_EMOJI_SIZE,
          scale
        }
        setEmojiObjects((prev) => [...prev, newObj])
        setSelectedEmojiId(id)
        return
      }

      if (tool === 'text') {
        setSelectedTextId(null)
        setTextEditor({
          canvasX: point.x,
          canvasY: point.y,
          left: event.clientX,
          top: event.clientY,
          scale,
          fontSize: lastTextFontSize.current,
          color: strokeColor
        })
        setTextDraft('')
        return
      }

      drawOrigin.current = point
      pushHistory()

      if (tool === 'pen') {
        penDrawing.current = true
        setDrawing(true)
        ctx.strokeStyle = strokeColor
        ctx.lineWidth = LINE_WIDTH * scale
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.globalAlpha = 1
        ctx.beginPath()
        ctx.moveTo(point.x, point.y)
        return
      }

      if (tool === 'highlight') {
        highlightDrawing.current = true
        highlightPoints.current = [point]
        setDrawing(true)
        return
      }

      setDrawing(true)
    },
    [
      phase,
      busy,
      tool,
      shotReady,
      selectedEmoji,
      pushHistory,
      selection,
      strokeColor,
      canAdjustRegion,
      beginRegionDrag
    ]
  )

  const onShotMouseMove = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      if (!drawing || phase !== 'editing' || !tool) return
      const canvas = shotRef.current
      const ctx = canvas?.getContext('2d')
      if (!canvas || !ctx) return
      const point = toLocal(event)
      const scale = canvas.width / Math.max(1, selection?.width || canvas.width)

      if (tool === 'pen' && penDrawing.current) {
        ctx.lineTo(point.x, point.y)
        ctx.stroke()
        return
      }

      if (tool === 'highlight' && highlightDrawing.current) {
        highlightPoints.current.push(point)
        const last = history.current[history.current.length - 1]
        if (!last) return
        ctx.putImageData(last, 0, 0)
        strokeHighlightPath(ctx, highlightPoints.current, strokeColor, HIGHLIGHT_WIDTH * scale)
        return
      }

      const last = history.current[history.current.length - 1]
      if (!last) return
      ctx.putImageData(last, 0, 0)
      ctx.globalAlpha = 1
      ctx.strokeStyle = strokeColor
      ctx.fillStyle = strokeColor
      ctx.lineWidth = LINE_WIDTH * scale
      const { x: x1, y: y1 } = drawOrigin.current
      const w = point.x - x1
      const h = point.y - y1

      if (tool === 'rect') ctx.strokeRect(x1, y1, w, h)
      else if (tool === 'ellipse') {
        ctx.beginPath()
        ctx.ellipse(x1 + w / 2, y1 + h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2)
        ctx.stroke()
      } else if (tool === 'arrow') drawArrow(ctx, x1, y1, point.x, point.y)
      else if (tool === 'mosaic') {
        applyMosaic(
          ctx,
          Math.min(x1, point.x),
          Math.min(y1, point.y),
          Math.abs(w),
          Math.abs(h),
          Math.max(6, Math.round(10 * scale))
        )
      }
    },
    [drawing, phase, tool, selection, strokeColor]
  )

  const onShotMouseUp = useCallback(() => {
    if (!drawing) return
    const canvas = shotRef.current
    const ctx = canvas?.getContext('2d')
    if (ctx) ctx.globalAlpha = 1
    setDrawing(false)
    penDrawing.current = false
    highlightDrawing.current = false
    highlightPoints.current = []
  }, [drawing])

  const handleScrollCapture = (): void => {
    // Keep this guard in addition to disabling the toolbar button so a queued or
    // programmatic click cannot start stitching after an annotation was added.
    if (!selection || !shotReady || hasAnnotations || scrollCapturing.current) return
    void (async () => {
      setBusy(true)
      scrollCapturing.current = true
      scrollResultReceived.current = false
      try {
        await window.api.beginScrollCapture(selection)
      } catch (err) {
        scrollCapturing.current = false
        if (err instanceof Error) setError(err.message)
        setBusy(false)
      }
    })()
  }

  const shotViewportHeight = isLongImage
    ? Math.min(displayHeight, window.innerHeight - selection!.y - 64)
    : displayHeight

  const toolbarPos = (() => {
    if (!selection || phase !== 'editing') return undefined
    const left = Math.min(
      Math.max(8, selection.x + selection.width / 2 - TOOLBAR_WIDTH / 2),
      window.innerWidth - TOOLBAR_WIDTH - 8
    )
    if (isLongImage) {
      return { left, top: window.innerHeight - 50 }
    }
    const below = selection.y + displayHeight + 12
    const top = below + 50 > window.innerHeight ? Math.max(8, selection.y - 58) : below
    return { left, top }
  })()

  const showColors = toolUsesColor(tool)

  // Prefer floating the palette/picker above the toolbar; if there isn't
  // enough headroom (e.g. a full-screen selection pins the toolbar near the
  // top edge), drop it below the toolbar instead so it never overlaps it.
  const placeAboveOrBelow = (height: number): number | undefined => {
    if (!toolbarPos) return undefined
    const above = toolbarPos.top - height - 8
    if (above >= 8) return above
    return Math.min(toolbarPos.top + TOOLBAR_HEIGHT + 8, window.innerHeight - height - 8)
  }

  const colorPalettePos =
    toolbarPos && showColors
      ? {
          left: toolbarPos.left + (TOOLBAR_WIDTH - PALETTE_WIDTH) / 2,
          top: placeAboveOrBelow(PALETTE_HEIGHT) ?? 8
        }
      : undefined

  const emojiPickerPos = toolbarPos
    ? { left: toolbarPos.left, top: placeAboveOrBelow(EMOJI_PICKER_HEIGHT) ?? 8 }
    : undefined

  // Tools usable as soon as crop is on canvas — only lock while an action is running
  const toolsLocked = busy || !shotReady

  return (
    <div className="screenshot-overlay">
      <canvas
        ref={bgRef}
        className="screenshot-canvas"
        style={{ pointerEvents: phase === 'selecting' ? 'auto' : 'none' }}
        onMouseDown={onBgMouseDown}
        onMouseMove={onBgMouseMove}
        onMouseUp={onBgMouseUp}
        onMouseLeave={onBgMouseUp}
      />

      {phase === 'editing' && selection && (
        <div
          ref={shotViewportRef}
          className={`shot-viewport${isLongImage ? ' shot-viewport--scrollable' : ''}`}
          style={{
            left: selection.x,
            top: selection.y,
            width: selection.width,
            height: shotViewportHeight
          }}
          onScroll={(event) => {
            const top = event.currentTarget.scrollTop
            setViewScrollTop(top)
            paintBackground(selection, displayHeight, top)
          }}
        >
          <canvas
            ref={shotRef}
            className={`shot-canvas${canAdjustRegion ? ' shot-canvas--movable' : ''}`}
            style={{
              width: selection.width,
              height: displayHeight
            }}
            onMouseDown={onShotMouseDown}
            onMouseMove={onShotMouseMove}
            onMouseUp={onShotMouseUp}
            onMouseLeave={onShotMouseUp}
          />
          {textObjects.map((obj) => {
            if (textEditor?.id === obj.id) return null
            const canvas = shotRef.current
            const scaleX = canvas ? canvas.width / Math.max(1, selection.width) : 1
            const scaleY = canvas ? canvas.height / Math.max(1, displayHeight) : scaleX
            return (
              <div
                key={obj.id}
                className={`text-object${selectedTextId === obj.id ? ' is-selected' : ''}`}
                style={{
                  left: obj.canvasX / scaleX,
                  top: obj.canvasY / scaleY,
                  color: obj.color,
                  fontSize: obj.fontSize,
                  fontWeight: 700,
                  lineHeight: 1.25,
                  whiteSpace: 'pre-wrap'
                }}
                onMouseDown={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  setSelectedTextId(obj.id)
                  setSelectedEmojiId(null)
                  textDragRef.current = {
                    id: obj.id,
                    startX: event.clientX,
                    startY: event.clientY,
                    originCanvasX: obj.canvasX,
                    originCanvasY: obj.canvasY
                  }
                }}
                onDoubleClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  openTextObjectEditor(obj)
                }}
              >
                {obj.text}
              </div>
            )
          })}
          {emojiObjects.map((obj) => {
            const canvas = shotRef.current
            const scaleX = canvas ? canvas.width / Math.max(1, selection.width) : 1
            const scaleY = canvas ? canvas.height / Math.max(1, displayHeight) : scaleX
            const isSelected = selectedEmojiId === obj.id
            return (
              <div
                key={obj.id}
                className={`emoji-object${isSelected ? ' is-selected' : ''}`}
                style={{
                  left: obj.canvasX / scaleX,
                  top: obj.canvasY / scaleY,
                  width: obj.size,
                  height: obj.size,
                  fontSize: obj.size
                }}
                onMouseDown={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  setSelectedTextId(null)
                  setSelectedEmojiId(obj.id)
                  emojiDragRef.current = {
                    id: obj.id,
                    mode: 'move',
                    startX: event.clientX,
                    startY: event.clientY,
                    originCanvasX: obj.canvasX,
                    originCanvasY: obj.canvasY,
                    originSize: obj.size
                  }
                }}
              >
                <span className="emoji-object__glyph">{obj.emoji}</span>
                {isSelected && (
                  <>
                    <button
                      type="button"
                      className="emoji-object__delete"
                      onMouseDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation()
                        setEmojiObjects((prev) => prev.filter((item) => item.id !== obj.id))
                        setSelectedEmojiId(null)
                      }}
                    >
                      ×
                    </button>
                    <span
                      className="emoji-object__resize"
                      onMouseDown={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        emojiDragRef.current = {
                          id: obj.id,
                          mode: 'resize',
                          startX: event.clientX,
                          startY: event.clientY,
                          originCanvasX: obj.canvasX,
                          originCanvasY: obj.canvasY,
                          originSize: obj.size
                        }
                      }}
                    />
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}

      {canAdjustRegion &&
        selection &&
        RESIZE_HANDLES.map((handle) => {
          const left = handle.includes('w')
            ? selection.x
            : handle.includes('e')
              ? selection.x + selection.width
              : selection.x + selection.width / 2
          const top = handle.includes('n')
            ? selection.y
            : handle.includes('s')
              ? selection.y + displayHeight
              : selection.y + displayHeight / 2
          return (
            <div
              key={handle}
              className="selection-handle"
              style={{ left, top, cursor: HANDLE_CURSORS[handle] }}
              onMouseDown={(event) => {
                event.preventDefault()
                event.stopPropagation()
                beginRegionDrag(handle, event)
              }}
            />
          )
        })}

      {canAdjustRegion && selection && !adjustingRegion && (
        <div className="overlay-hint-bar">{t.hints.adjustRegion}</div>
      )}

      {adjustingRegion && selection && (
        <div
          className="selection-size"
          style={{ left: selection.x, top: Math.max(8, selection.y - 28) }}
        >
          {Math.round(selection.width)} × {Math.round(selection.height)}
        </div>
      )}

      {phase === 'editing' &&
        !textEditor &&
        (textObjects.length > 0 || emojiObjects.length > 0) && (
          <div className="long-image-scroll-hint">
            {textObjects.length > 0 ? t.textEditor.moveHint : t.textEditor.emojiMoveHint}
          </div>
        )}

      {phase === 'editing' && isLongImage && (
        <div className="long-image-scroll-hint">{t.scrollCapture.scrollPreviewHint}</div>
      )}

      {phase === 'loading' && <div className="overlay-status">{t.hints.capturing}</div>}

      {phase === 'selecting' && !selection && !error && (
        <div className="overlay-hint-bar">{t.hints.dragToSelect}</div>
      )}

      {error && <div className="overlay-hint-bar overlay-hint-bar--error">{error}</div>}

      {selection && selection.width > 0 && selection.height > 0 && phase === 'selecting' && (
        <div
          className="selection-size"
          style={{ left: selection.x, top: Math.max(8, selection.y - 28) }}
        >
          {Math.round(selection.width)} × {Math.round(selection.height)}
        </div>
      )}

      {phase === 'editing' && toolbarPos && (
        <>
          {showEmojiPicker && emojiPickerPos && (
            <EmojiPicker
              style={emojiPickerPos}
              onPick={(emoji) => {
                setSelectedEmoji(emoji)
                setTool('emoji')
              }}
            />
          )}
          {showColors && colorPalettePos && (
            <ColorPalette
              strokeColor={strokeColor}
              disabled={toolsLocked}
              style={colorPalettePos}
              onChange={setStrokeColor}
            />
          )}
          <AnnotationToolbar
            tool={tool}
            canUndo={canUndo}
            toolsDisabled={toolsLocked}
            scrollCaptureDisabled={hasAnnotations}
            confirmDisabled={toolsLocked}
            showEmojiPicker={showEmojiPicker}
            style={toolbarPos}
            onToolChange={(next) => {
              setTool(next)
              setShowEmojiPicker(next === 'emoji')
            }}
            onUndo={undo}
            onScrollCapture={handleScrollCapture}
            onSave={() => {
              void (async () => {
                setBusy(true)
                try {
                  await window.api.saveImage(await exportPng())
                } finally {
                  setBusy(false)
                }
              })()
            }}
            onPin={() => {
              void (async () => {
                const action = ++pendingAction.current
                setBusy(true)
                try {
                  const png = await exportPng()
                  if (action !== pendingAction.current) return
                  await window.api.pinImage(png)
                } catch (err) {
                  if (action === pendingAction.current) {
                    setError(err instanceof Error ? err.message : 'Failed to pin screenshot')
                  }
                } finally {
                  if (action === pendingAction.current) setBusy(false)
                }
              })()
            }}
            onCancel={cancelOverlay}
            onConfirm={() => {
              void (async () => {
                setBusy(true)
                try {
                  await window.api.copyImage(await exportPng())
                } finally {
                  setBusy(false)
                }
              })()
            }}
          />
        </>
      )}

      {textEditor && (
        <TextEditor
          editor={textEditor}
          draft={textDraft}
          onDraftChange={setTextDraft}
          onMove={(left, top, canvasX, canvasY) => {
            setTextEditor((prev) => (prev ? { ...prev, left, top, canvasX, canvasY } : prev))
          }}
          onFontSizeChange={(size) => {
            lastTextFontSize.current = size
            setTextEditor((prev) => (prev ? { ...prev, fontSize: size } : prev))
          }}
          onColorChange={(color) => {
            setStrokeColor(color)
            setTextEditor((prev) => (prev ? { ...prev, color } : prev))
          }}
          onCommit={(left, top) => commitText(textDraft, left, top)}
          onCancel={cancelTextEditor}
          screenToCanvas={screenToCanvas}
        />
      )}

      {busy && <div className="overlay-status">{t.hints.working}</div>}
    </div>
  )
}

export default ScreenshotOverlay
