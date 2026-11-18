import { describe, expect, it } from 'vitest'
import jpeg from 'jpeg-js'
import { type OcrEngine, hideSecrets, secretFilter } from './masker'
import type { OcrLine } from './regions'

const frame = jpeg.encode({ width: 200, height: 40, data: new Uint8Array(200 * 40 * 4).fill(255) }, 90).data

/** OCR that "reads" the given lines off any frame. */
function fakeOcr(lines: OcrLine[]) {
  const calls = { read: 0, close: 0 }
  const engine: OcrEngine = {
    async read() {
      calls.read++
      return lines
    },
    async close() {
      calls.close++
    }
  }
  return { engine, calls }
}

const key: OcrLine = { words: [{ text: 'sk-proj-7Fq2xL9mWc4RbT', box: { x0: 10, y0: 10, x1: 120, y1: 30 } }] }
const plain: OcrLine = { words: [{ text: 'hello', box: { x0: 10, y0: 10, x1: 60, y1: 30 } }] }

const brightness = (image: Uint8Array, x: number, y: number) => {
  const { data, width } = jpeg.decode(image, { useTArray: true })
  const i = (y * width + x) * 4
  return (data[i]! + data[i + 1]! + data[i + 2]!) / 3
}

describe('hideSecrets', () => {
  it('blacks out what the rules find', async () => {
    const out = await hideSecrets(frame, fakeOcr([key]).engine)
    expect(brightness(out, 60, 20)).toBeLessThan(20)
    expect(brightness(out, 180, 20)).toBeGreaterThan(235)
  })

  it('returns the frame unchanged when nothing is found', async () => {
    expect(await hideSecrets(frame, fakeOcr([plain]).engine)).toBe(frame)
  })
})

describe('secretFilter', () => {
  it('masks while enabled and releases the OCR engine when turned off', async () => {
    let enabled = true
    const { engine, calls } = fakeOcr([key])
    const filter = secretFilter(engine, () => enabled)

    expect(await filter(frame)).not.toBe(frame)
    expect(calls).toEqual({ read: 1, close: 0 })

    enabled = false
    expect(await filter(frame)).toBe(frame)
    expect(calls).toEqual({ read: 1, close: 1 })
  })
})
