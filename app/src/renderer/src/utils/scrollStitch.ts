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
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas unavailable')
  ctx.drawImage(image, 0, 0)
  return canvas
}

function normalizeToWidth(image: HTMLImageElement, targetWidth: number): HTMLCanvasElement {
  if (image.naturalWidth === targetWidth) return imageToCanvas(image)
  const scale = targetWidth / image.naturalWidth
  const canvas = document.createElement('canvas')
  canvas.width = targetWidth
  canvas.height = Math.round(image.naturalHeight * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas unavailable')
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
  return canvas
}

function extractBottomStrip(canvas: HTMLCanvasElement, stripHeight: number): HTMLCanvasElement {
  const height = Math.min(stripHeight, canvas.height)
  const strip = document.createElement('canvas')
  strip.width = canvas.width
  strip.height = height
  const ctx = strip.getContext('2d')
  if (!ctx) throw new Error('Canvas unavailable')
  ctx.drawImage(canvas, 0, canvas.height - height, canvas.width, height, 0, 0, canvas.width, height)
  return strip
}

const PIXEL_TOLERANCE = 18
const MIN_NEW_CONTENT = 4

function rowDiff(
  prev: ImageData,
  next: ImageData,
  prevY: number,
  nextY: number,
  width: number
): number {
  let diff = 0
  const step = Math.max(1, Math.floor(width / 80))
  for (let x = 0; x < width; x += step) {
    const pi = (prevY * prev.width + x) * 4
    const ni = (nextY * next.width + x) * 4
    const dr = Math.abs(prev.data[pi] - next.data[ni])
    const dg = Math.abs(prev.data[pi + 1] - next.data[ni + 1])
    const db = Math.abs(prev.data[pi + 2] - next.data[ni + 2])
    if (dr + dg + db > PIXEL_TOLERANCE) diff++
  }
  return diff
}

function overlapScore(
  prevData: ImageData,
  nextData: ImageData,
  prevHeight: number,
  width: number,
  overlap: number
): number {
  const samples = 20
  let score = 0
  for (let i = 0; i < samples; i++) {
    const prevY = prevHeight - overlap + Math.floor((i * overlap) / samples)
    const nextY = Math.floor((i * overlap) / samples)
    score += rowDiff(prevData, nextData, prevY, nextY, width)
  }
  return score
}

function findVerticalOverlap(prev: HTMLCanvasElement, next: HTMLCanvasElement): number | null {
  const width = Math.min(prev.width, next.width)
  const viewport = Math.min(prev.height, next.height)
  const maxOverlap = viewport - MIN_NEW_CONTENT
  const minOverlap = Math.max(16, Math.floor(viewport * 0.03))
  if (maxOverlap <= minOverlap) return null

  const prevData = prev.getContext('2d')!.getImageData(0, 0, width, prev.height)
  const nextData = next.getContext('2d')!.getImageData(0, 0, width, next.height)

  let bestOverlap = minOverlap
  let bestScore = Infinity

  for (let overlap = minOverlap; overlap <= maxOverlap; overlap += 8) {
    const score = overlapScore(prevData, nextData, prev.height, width, overlap)
    if (score < bestScore) {
      bestScore = score
      bestOverlap = overlap
    }
  }

  const fineMin = Math.max(minOverlap, bestOverlap - 20)
  const fineMax = Math.min(maxOverlap, bestOverlap + 20)
  for (let overlap = fineMin; overlap <= fineMax; overlap++) {
    const score = overlapScore(prevData, nextData, prev.height, width, overlap)
    if (score < bestScore) {
      bestScore = score
      bestOverlap = overlap
    }
  }

  const samplePoints = 20 * Math.ceil(width / 80)
  const maxAllowedScore = Math.max(10, Math.floor(samplePoints * 0.45))
  if (bestScore > maxAllowedScore) return null

  return bestOverlap
}

function appendToCanvas(
  canvas: HTMLCanvasElement,
  nextFrame: HTMLCanvasElement,
  overlap: number,
  displayWidth: number
): { appended: boolean; displayAppend?: number } {
  const newPartHeight = nextFrame.height - overlap
  if (newPartHeight < MIN_NEW_CONTENT) return { appended: false }

  const merged = document.createElement('canvas')
  merged.width = canvas.width
  merged.height = canvas.height + newPartHeight
  const mctx = merged.getContext('2d')
  if (!mctx) return { appended: false }

  mctx.drawImage(canvas, 0, 0)
  mctx.drawImage(
    nextFrame,
    0,
    overlap,
    nextFrame.width,
    newPartHeight,
    0,
    canvas.height,
    canvas.width,
    newPartHeight
  )

  canvas.height = merged.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return { appended: false }
  ctx.drawImage(merged, 0, 0)

  const displayAppend = (newPartHeight / canvas.width) * displayWidth
  return { appended: true, displayAppend }
}

function alignCanvasWidth(canvas: HTMLCanvasElement, targetWidth: number): void {
  if (canvas.width === targetWidth) return
  const resized = document.createElement('canvas')
  resized.width = targetWidth
  resized.height = Math.round(canvas.height * (targetWidth / canvas.width))
  const rctx = resized.getContext('2d')
  if (!rctx) return
  rctx.drawImage(canvas, 0, 0, resized.width, resized.height)
  canvas.width = resized.width
  canvas.height = resized.height
  canvas.getContext('2d')?.drawImage(resized, 0, 0)
}

export async function stitchScrollFrame(
  canvas: HTMLCanvasElement,
  lastViewportBase64: string,
  nextBase64: string,
  displayWidth: number
): Promise<{ appended: boolean; lastViewportBase64: string; displayAppend?: number }> {
  const prevRaw = await loadPngFromBase64(lastViewportBase64)
  const nextRaw = await loadPngFromBase64(nextBase64)

  const targetWidth = Math.max(prevRaw.naturalWidth, nextRaw.naturalWidth, canvas.width)
  const prevFrame = normalizeToWidth(prevRaw, targetWidth)
  const nextFrame = normalizeToWidth(nextRaw, targetWidth)

  if (Math.abs(prevFrame.height - nextFrame.height) > 8) {
    return { appended: false, lastViewportBase64: nextBase64 }
  }

  alignCanvasWidth(canvas, targetWidth)

  let overlap = findVerticalOverlap(prevFrame, nextFrame)

  if (overlap === null && canvas.height > MIN_NEW_CONTENT) {
    const stripHeight = Math.min(nextFrame.height, Math.max(Math.floor(nextFrame.height * 0.65), 120))
    const bottomStrip = extractBottomStrip(canvas, stripHeight)
    overlap = findVerticalOverlap(bottomStrip, nextFrame)
  }

  if (overlap === null) {
    return { appended: false, lastViewportBase64: nextBase64 }
  }

  const result = appendToCanvas(canvas, nextFrame, overlap, displayWidth)
  return { ...result, lastViewportBase64: nextBase64 }
}

export function exportCanvasPreviewBase64(canvas: HTMLCanvasElement, maxWidth = 300): string {
  const scale = Math.min(1, maxWidth / canvas.width)
  const tmp = document.createElement('canvas')
  tmp.width = Math.max(1, Math.round(canvas.width * scale))
  tmp.height = Math.max(1, Math.round(canvas.height * scale))
  const ctx = tmp.getContext('2d')
  if (!ctx) return ''
  ctx.drawImage(canvas, 0, 0, tmp.width, tmp.height)
  return tmp.toDataURL('image/png').split(',')[1] ?? ''
}

export type StitchResult = Awaited<ReturnType<typeof stitchScrollFrame>>
