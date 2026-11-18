// Blacks out rectangles of a frame. Upstream pixelates with blocks taller than
// the text (PrivacyShieldFrameMasker.pixelate); a solid fill hides the same and
// needs no image library. JPEG decoding and encoding is pure JS (jpeg-js), so
// there is no native module.

import jpeg from 'jpeg-js'
import type { Rect } from './regions'

/** Same quality as the helper writes frames with (capture.go). */
const QUALITY = 75

export interface RgbaImage {
  width: number
  height: number
  /** 4 bytes per pixel, row by row. */
  data: Uint8Array
}

/** Fills every pixel a rectangle touches with opaque black, in place. */
export function blackOut(image: RgbaImage, rects: readonly Rect[]): void {
  const { width, height, data } = image
  for (const r of rects) {
    const x0 = Math.max(0, Math.floor(r.x0))
    const y0 = Math.max(0, Math.floor(r.y0))
    const x1 = Math.min(width, Math.ceil(r.x1))
    const y1 = Math.min(height, Math.ceil(r.y1))
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * width + x) * 4
        data[i] = 0
        data[i + 1] = 0
        data[i + 2] = 0
        data[i + 3] = 255
      }
    }
  }
}

/** The frame with the rectangles black, as a new JPEG. */
export function redactJpeg(frame: Uint8Array, rects: readonly Rect[]): Uint8Array {
  const image = jpeg.decode(frame, { useTArray: true, formatAsRGBA: true })
  blackOut(image, rects)
  const { data } = jpeg.encode(image, QUALITY)
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
}

/** Width and height from a JPEG's start-of-frame marker, or null when it has none. */
export function jpegSize(frame: Uint8Array): { width: number; height: number } | null {
  if (frame[0] !== 0xff || frame[1] !== 0xd8) return null
  let i = 2
  while (i + 9 < frame.length) {
    if (frame[i] !== 0xff) return null
    const marker = frame[i + 1]!
    // Fill bytes and markers without a length.
    if (marker === 0xff) {
      i++
      continue
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2
      continue
    }
    const length = (frame[i + 2]! << 8) | frame[i + 3]!
    // SOF0..SOF15, except DHT (c4), JPG (c8) and DAC (cc).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: (frame[i + 5]! << 8) | frame[i + 6]!, width: (frame[i + 7]! << 8) | frame[i + 8]! }
    }
    i += 2 + length
  }
  return null
}
