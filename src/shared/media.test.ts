import { describe, expect, it } from 'vitest'
import { frameDelayMs, nextSpeed } from './media'

const frame = (capturedAt: number) => ({ capturedAt, url: '' })

describe('timelapse timing', () => {
  it('shows frames 10 s apart for 500 ms at 20x and 250 ms at 40x', () => {
    expect(frameDelayMs(frame(0), frame(10), 20)).toBe(500)
    expect(frameDelayMs(frame(0), frame(10), 40)).toBe(250)
  })

  it('keeps 1 s frames visible for 50 ms and shortens a 30-minute lock to 2 s', () => {
    expect(frameDelayMs(frame(0), frame(1), 60)).toBe(50)
    expect(frameDelayMs(frame(0), frame(1800), 20)).toBe(2000)
  })

  it('cycles the speed chip 20x, 40x, 60x, 20x', () => {
    expect([nextSpeed(20), nextSpeed(40), nextSpeed(60)]).toEqual([40, 60, 20])
  })
})
