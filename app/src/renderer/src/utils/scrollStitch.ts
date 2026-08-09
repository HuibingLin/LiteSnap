export function loadPngFromBase64(base64: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Failed to decode image'))
    image.src = `data:image/png;base64,${base64}`
  })
}

function imageToCanvas(image: HTMLImageElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas unavailable')
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(image, 0, 0)
  return canvas
}

interface ScrollSegment {
  canvas: HTMLCanvasElement
  height: number
}

export interface ScrollStitchSession {
  width: number
  viewportHeight: number
  totalHeight: number
  lastFrame: HTMLCanvasElement
  lastFrameData: ImageData
  segments: ScrollSegment[]
}

const MIN_NEW_CONTENT = 8
const MIN_OVERLAP = 12
const MAX_MATCH_SCORE = 0.115
const DUPLICATE_SCORE = 0.018
const SMALL_SHIFT_LIMIT = 16

/**
 * Scores a vertical overlap using a trimmed set of two-dimensional colour
 * samples. Trimming noisy rows tolerates fixed headers, cursors and animation.
 */
function overlapScore(prev: ImageData, next: ImageData, overlap: number): number {
  const width = Math.min(prev.width, next.width)
  const rows = Math.min(36, Math.max(10, Math.floor(overlap / 8)))
  const left = Math.floor(width * 0.05)
  const right = Math.max(left + 1, Math.ceil(width * 0.95))
  const xStep = Math.max(1, Math.floor((right - left) / 56))
  const rowScores: number[] = []

  for (let row = 0; row < rows; row++) {
    const offset = Math.min(overlap - 1, Math.floor(((row + 0.5) * overlap) / rows))
    const prevY = prev.height - overlap + offset
    const nextY = offset
    let difference = 0
    let samples = 0
    for (let x = left; x < right; x += xStep) {
      const pi = (prevY * prev.width + x) * 4
      const ni = (nextY * next.width + x) * 4
      difference += Math.abs(prev.data[pi] - next.data[ni])
      difference += Math.abs(prev.data[pi + 1] - next.data[ni + 1])
      difference += Math.abs(prev.data[pi + 2] - next.data[ni + 2])
      samples++
    }
    rowScores.push(difference / Math.max(1, samples * 255 * 3))
  }

  rowScores.sort((a, b) => a - b)
  const retainedRows = Math.max(6, Math.ceil(rowScores.length * 0.7))
  let total = 0
  for (let index = 0; index < retainedRows; index++) total += rowScores[index]
  return total / retainedRows
}

function findVerticalOverlap(prev: ImageData, next: ImageData): number | null {
  if (prev.width !== next.width || prev.height !== next.height) return null
  const viewport = prev.height
  const maxOverlap = viewport - MIN_NEW_CONTENT
  if (maxOverlap < MIN_OVERLAP) return null

  const fullFrameScore = overlapScore(prev, next, viewport)
  if (fullFrameScore <= DUPLICATE_SCORE) return viewport

  let bestOverlap = maxOverlap
  let bestScore = Infinity
  const coarseStep = Math.max(5, Math.floor(viewport / 100))

  for (let overlap = maxOverlap; overlap >= MIN_OVERLAP; overlap -= coarseStep) {
    const score = overlapScore(prev, next, overlap)
    if (score < bestScore - 0.0005) {
      bestScore = score
      bestOverlap = overlap
    }
  }

  const fineMin = Math.max(MIN_OVERLAP, bestOverlap - coarseStep - 2)
  const fineMax = Math.min(maxOverlap, bestOverlap + coarseStep + 2)
  for (let overlap = fineMax; overlap >= fineMin; overlap--) {
    const score = overlapScore(prev, next, overlap)
    if (
      score < bestScore - 0.0001 ||
      (Math.abs(score - bestScore) <= 0.0001 && overlap > bestOverlap)
    ) {
      bestScore = score
      bestOverlap = overlap
    }
  }

  if (bestScore > MAX_MATCH_SCORE) return null

  // Tiny apparent movement is usually a caret, hover state or animation in an
  // otherwise stationary viewport. Reject it so idle frames cannot slowly
  // duplicate the first viewport at the start of a capture.
  const newContent = viewport - bestOverlap
  if (newContent <= SMALL_SHIFT_LIMIT && fullFrameScore <= bestScore + 0.012) return viewport
  return bestOverlap
}

export function createScrollStitchSession(image: HTMLImageElement): ScrollStitchSession {
  const frame = imageToCanvas(image)
  const data = frame
    .getContext('2d', { willReadFrequently: true })!
    .getImageData(0, 0, frame.width, frame.height)
  return {
    width: frame.width,
    viewportHeight: frame.height,
    totalHeight: frame.height,
    lastFrame: frame,
    lastFrameData: data,
    segments: [{ canvas: frame, height: frame.height }]
  }
}

export async function stitchScrollFrame(
  session: ScrollStitchSession,
  nextBase64: string,
  displayWidth: number
): Promise<{ appended: boolean; displayAppend?: number }> {
  const nextRaw = await loadPngFromBase64(nextBase64)
  if (nextRaw.naturalWidth !== session.width || nextRaw.naturalHeight !== session.viewportHeight) {
    return { appended: false }
  }

  const nextFrame = imageToCanvas(nextRaw)
  const nextData = nextFrame
    .getContext('2d', { willReadFrequently: true })!
    .getImageData(0, 0, nextFrame.width, nextFrame.height)
  const overlap = findVerticalOverlap(session.lastFrameData, nextData)
  if (overlap === null) return { appended: false }

  // A valid duplicate still becomes the comparison baseline. This prevents a
  // blinking cursor or hover state from poisoning later overlap detection.
  session.lastFrame = nextFrame
  session.lastFrameData = nextData
  const newPartHeight = nextFrame.height - overlap
  if (newPartHeight < MIN_NEW_CONTENT) return { appended: false }

  const slice = document.createElement('canvas')
  slice.width = nextFrame.width
  slice.height = newPartHeight
  const sliceContext = slice.getContext('2d')
  if (!sliceContext) return { appended: false }
  sliceContext.imageSmoothingEnabled = false
  sliceContext.drawImage(
    nextFrame,
    0,
    overlap,
    nextFrame.width,
    newPartHeight,
    0,
    0,
    nextFrame.width,
    newPartHeight
  )
  session.segments.push({ canvas: slice, height: newPartHeight })
  session.totalHeight += newPartHeight
  return {
    appended: true,
    displayAppend: (newPartHeight / session.width) * displayWidth
  }
}

function drawSession(session: ScrollStitchSession, target: HTMLCanvasElement, scale: number): void {
  target.width = Math.max(1, Math.round(session.width * scale))
  target.height = Math.max(1, Math.round(session.totalHeight * scale))
  const ctx = target.getContext('2d')
  if (!ctx) return
  ctx.imageSmoothingEnabled = scale !== 1
  if (scale !== 1) ctx.imageSmoothingQuality = 'high'
  let y = 0
  for (const segment of session.segments) {
    const height = Math.max(1, Math.round(segment.height * scale))
    ctx.drawImage(
      segment.canvas,
      0,
      0,
      segment.canvas.width,
      segment.height,
      0,
      y,
      target.width,
      height
    )
    y += height
  }
}

export function renderScrollStitchSession(
  session: ScrollStitchSession,
  target: HTMLCanvasElement
): void {
  drawSession(session, target, 1)
}

export function exportScrollSessionPreviewBase64(
  session: ScrollStitchSession,
  maxWidth = 300
): string {
  const preview = document.createElement('canvas')
  drawSession(session, preview, Math.min(1, maxWidth / session.width))
  return preview.toDataURL('image/png').split(',')[1] ?? ''
}

export function exportCanvasPreviewBase64(canvas: HTMLCanvasElement, maxWidth = 300): string {
  const scale = Math.min(1, maxWidth / canvas.width)
  const tmp = document.createElement('canvas')
  tmp.width = Math.max(1, Math.round(canvas.width * scale))
  tmp.height = Math.max(1, Math.round(canvas.height * scale))
  const ctx = tmp.getContext('2d')
  if (!ctx) return ''
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(canvas, 0, 0, tmp.width, tmp.height)
  return tmp.toDataURL('image/png').split(',')[1] ?? ''
}

export type StitchResult = Awaited<ReturnType<typeof stitchScrollFrame>>
