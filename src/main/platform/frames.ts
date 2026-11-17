// Pure helpers for Electron-based capture on Windows and macOS: which screen
// to keep, how large to grab it, and what to call the file. The naming and the
// "screen under the mouse" rule follow the Linux helper
// (helper/linux/frames, cmd/dayflow-linux-helper/capture.go), which follows
// upstream's ActiveDisplayTracker.swift.

export interface Point {
  x: number
  y: number
}

export interface Rect extends Point {
  width: number
  height: number
}

/** The parts of Electron's Display these helpers read. */
export interface DisplayInfo {
  id: number
  /** In DIP, in the desktop's coordinate space. */
  bounds: Rect
  /** In DIP. */
  size: { width: number; height: number }
  scaleFactor: number
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0')

/**
 * "20261117-090507.042+0100_s1.jpg": local capture time to the millisecond,
 * UTC offset and screen index, like the Linux helper. The milliseconds keep a
 * restarted capture's first frame apart from the one before it in the same
 * second, the offset the repeated autumn hour's frames.
 */
export function frameFileName(at: Date, displayIndex: number): string {
  const date = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}`
  const time = `${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}.${pad(at.getMilliseconds(), 3)}`
  const offset = -at.getTimezoneOffset()
  const zone = `${offset < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(offset) / 60))}${pad(Math.abs(offset) % 60)}`
  return `${date}-${time}${zone}_s${displayIndex}.jpg`
}

/** Distance from p to the rectangle; 0 inside it. */
function distance(r: Rect, p: Point): number {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.width - 1))
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.height - 1))
  return Math.hypot(dx, dy)
}

/**
 * The display under the cursor, or the nearest one when the cursor sits in a
 * gap between displays (like screen.getDisplayNearestPoint).
 */
export function displayUnderCursor<D extends DisplayInfo>(displays: readonly D[], cursor: Point): D | null {
  let best: D | null = null
  let bestDistance = Infinity
  for (const d of displays) {
    const b = d.bounds
    if (cursor.x >= b.x && cursor.y >= b.y && cursor.x < b.x + b.width && cursor.y < b.y + b.height) return d
    const dist = distance(b, cursor)
    if (dist < bestDistance) {
      best = d
      bestDistance = dist
    }
  }
  return best
}

/** Thumbnail size for a display: `height` pixels high at most, never above its physical size. */
export function thumbnailSize(display: DisplayInfo, height: number): { width: number; height: number } {
  const physicalWidth = Math.round(display.size.width * display.scaleFactor)
  const physicalHeight = Math.round(display.size.height * display.scaleFactor)
  if (physicalHeight <= height) return { width: physicalWidth, height: physicalHeight }
  return { width: Math.round((physicalWidth * height) / physicalHeight), height }
}

/**
 * The desktopCapturer source showing `display`. Sources carry the display ID
 * on Windows and macOS; without a match, only a single screen is a safe guess.
 */
export function sourceForDisplay<S extends { display_id: string }>(
  sources: readonly S[],
  display: { id: number },
  displayCount: number
): S | null {
  const match = sources.find((s) => s.display_id === String(display.id))
  if (match) return match
  return sources.length === 1 && displayCount === 1 ? sources[0]! : null
}
