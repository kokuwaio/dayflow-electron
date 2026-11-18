// The tray icon's attention dot while a provider problem waits on the user,
// after upstream's orange menu bar dot (System/StatusBarController.swift).
// Works on the raw bitmap Electron's nativeImage gives (BGRA, 4 bytes a pixel).

/** macOS's system orange, #FF9500, as BGRA. */
export const ATTENTION_BGRA = [0x00, 0x95, 0xff, 0xff] as const

/** A copy of the bitmap with a dot in the bottom-right corner and a transparent ring around it. */
export function withDot(bitmap: Buffer, width: number, height: number): Buffer {
  const out = Buffer.from(bitmap)
  const size = Math.min(width, height)
  const r = Math.round(size * 0.25)
  const cx = width - r - 1
  const cy = height - r - 1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const d = Math.hypot(x - cx, y - cy)
      if (d > r + 2) continue
      const i = (y * width + x) * 4
      if (d <= r) out.set(ATTENTION_BGRA, i)
      else out.fill(0, i, i + 4)
    }
  }
  return out
}
