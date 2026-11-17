import { describe, expect, it } from 'vitest'
import { type OcrLine, orderLines, secretRects } from './regions'

/** A line of words, each `width` pixels per character, separated by one character. */
function line(text: string, x: number, y: number, charWidth = 10, height = 20): OcrLine {
  let cursor = x
  const words = text.split(' ').map((word) => {
    const box = { x0: cursor, y0: y, x1: cursor + word.length * charWidth, y1: y + height }
    cursor = box.x1 + charWidth
    return { text: word, box }
  })
  return { words }
}

describe('secretRects', () => {
  it('boxes the words of a masked run, padded', () => {
    const rects = secretRects([line('token sk-proj-7Fq2xL9mWc4RbT here', 100, 50)], 1080)
    // "sk-proj-7Fq2xL9mWc4RbT" is the second word: x 160..380.
    expect(rects).toEqual([{ x0: 157, y0: 47, x1: 383, y1: 73 }])
  })

  it('covers several words of one run with one box', () => {
    const rects = secretRects([line('JBSW Y3DP EHPK 3PXP', 0, 0)], 1080)
    expect(rects).toEqual([{ x0: -3, y0: -3, x1: 193, y1: 23 }])
  })

  it('boxes part of a word by its share of the word, plus a character', () => {
    // "--password=hunter2hunter" is one OCR word; the value is its last 13 of 24 characters.
    const rects = secretRects([line('mysql --password=hunter2hunter', 0, 0)], 1080)
    expect(rects).toHaveLength(1)
    const [r] = rects
    expect(r!.x0).toBe(60 + 110 - 10 - 3)
    expect(r!.x1).toBe(300 + 3)
  })

  it('uses context from the lines above in reading order', () => {
    const heading = line('Your recovery codes', 0, 0)
    const codes = line('a1b2c-3d4e5', 0, 40)
    expect(secretRects([codes, heading], 1080)).toHaveLength(1)
    expect(secretRects([codes], 1080)).toEqual([])
  })

  it('finds nothing in ordinary text', () => {
    expect(secretRects([line('Meeting notes ship the release', 0, 0)], 1080)).toEqual([])
    expect(secretRects([], 1080)).toEqual([])
  })
})

describe('orderLines', () => {
  it('sorts top to bottom in 1% bands, then left to right', () => {
    const a = line('a', 500, 100)
    const b = line('b', 0, 104) // same 1% band of 1000 px as a
    const c = line('c', 0, 50)
    expect(orderLines([a, b, c], 1000).map((l) => l.words[0]!.text)).toEqual(['c', 'b', 'a'])
  })
})
