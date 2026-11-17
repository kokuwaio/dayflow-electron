import { describe, expect, it } from 'vitest'
import { selectFramesToPurge } from './retention'

const frame = (id: number, capturedAt: number, bytes: number) => ({ id, capturedAt, bytes })

describe('selectFramesToPurge', () => {
  it('keeps everything while the total is within the cap', () => {
    expect(selectFramesToPurge([frame(1, 100, 400), frame(2, 200, 600)], 1000)).toEqual([])
  })

  it('purges the oldest frames until the total fits the cap', () => {
    const frames = [frame(3, 300, 500), frame(1, 100, 500), frame(2, 200, 500)]
    expect(selectFramesToPurge(frames, 1000)).toEqual([1])
    expect(selectFramesToPurge(frames, 400)).toEqual([1, 2, 3])
  })
})
