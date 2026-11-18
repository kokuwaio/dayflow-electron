import { describe, expect, it } from 'vitest'
import { ATTENTION_BGRA, withDot } from './tray-dot'

const pixel = (bitmap: Buffer, width: number, x: number, y: number) => [...bitmap.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)]

describe('the tray icon\'s attention dot (upstream StatusBarController)', () => {
  const size = 32
  const icon = Buffer.alloc(size * size * 4, 0x40)

  it('paints an orange dot into the bottom-right corner, with a clear ring around it', () => {
    const dotted = withDot(icon, size, size)
    // The dot's centre: radius 8 at (23, 23) for a 32 px icon.
    expect(pixel(dotted, size, 23, 23)).toEqual([...ATTENTION_BGRA])
    expect(pixel(dotted, size, 28, 28)).toEqual([...ATTENTION_BGRA])
    // Just outside the dot: cut out, so the dot stands apart from the icon.
    expect(pixel(dotted, size, 23, 13)).toEqual([0, 0, 0, 0])
    // The rest of the icon stays as it was.
    expect(pixel(dotted, size, 4, 4)).toEqual([0x40, 0x40, 0x40, 0x40])
  })

  it('leaves the original bitmap alone', () => {
    withDot(icon, size, size)
    expect(pixel(icon, size, 23, 23)).toEqual([0x40, 0x40, 0x40, 0x40])
  })
})
