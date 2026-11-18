import { describe, expect, it } from 'vitest'
import jpeg from 'jpeg-js'
import { blackOut, jpegSize, redactJpeg } from './redact'

const white = (width: number, height: number) => ({ width, height, data: new Uint8Array(width * height * 4).fill(255) })
const pixel = (img: { width: number; data: Uint8Array }, x: number, y: number) =>
  Array.from(img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 4))

describe('blackOut', () => {
  it('fills each rectangle with black, clipped to the image', () => {
    const img = white(8, 6)
    blackOut(img, [
      { x0: 2, y0: 1, x1: 4, y1: 3 },
      { x0: 6, y0: 4, x1: 20, y1: 20 }
    ])
    expect(pixel(img, 2, 1)).toEqual([0, 0, 0, 255])
    expect(pixel(img, 3, 2)).toEqual([0, 0, 0, 255])
    expect(pixel(img, 4, 2)).toEqual([255, 255, 255, 255])
    expect(pixel(img, 7, 5)).toEqual([0, 0, 0, 255])
    expect(pixel(img, 0, 0)).toEqual([255, 255, 255, 255])
  })

  it('covers partly covered pixels and ignores empty or outside rectangles', () => {
    const img = white(4, 4)
    blackOut(img, [
      { x0: 0.5, y0: 0.5, x1: 1.2, y1: 1.2 },
      { x0: -10, y0: -10, x1: -1, y1: -1 },
      { x0: 3, y0: 3, x1: 3, y1: 3 }
    ])
    expect(pixel(img, 0, 0)).toEqual([0, 0, 0, 255])
    expect(pixel(img, 1, 1)).toEqual([0, 0, 0, 255])
    expect(pixel(img, 2, 2)).toEqual([255, 255, 255, 255])
    expect(pixel(img, 3, 3)).toEqual([255, 255, 255, 255])
  })
})

describe('redactJpeg', () => {
  const frame = jpeg.encode(white(64, 32), 90).data

  it('returns a JPEG of the same size with the rectangles black', () => {
    const out = redactJpeg(frame, [{ x0: 0, y0: 0, x1: 32, y1: 16 }])
    const img = jpeg.decode(out, { useTArray: true })
    expect([img.width, img.height]).toEqual([64, 32])
    expect(pixel(img, 8, 8).slice(0, 3).every((v) => v < 20)).toBe(true)
    expect(pixel(img, 48, 24).slice(0, 3).every((v) => v > 235)).toBe(true)
  })

  it('reads the size from the JPEG header', () => {
    expect(jpegSize(frame)).toEqual({ width: 64, height: 32 })
    expect(jpegSize(new Uint8Array([1, 2, 3]))).toBeNull()
  })
})
