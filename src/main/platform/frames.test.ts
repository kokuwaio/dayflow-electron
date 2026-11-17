import { describe, expect, it } from 'vitest'
import { type DisplayInfo, displayUnderCursor, frameFileName, sourceForDisplay, thumbnailSize } from './frames'

const display = (id: number, x: number, y: number, width: number, height: number, scaleFactor = 1): DisplayInfo => ({
  id,
  bounds: { x, y, width, height },
  size: { width, height },
  scaleFactor
})

describe('frameFileName', () => {
  it('names frames like the Linux helper: local wall-clock time, UTC offset and the screen index', () => {
    expect(frameFileName(new Date(2026, 10, 17, 9, 5, 7), 0)).toBe('20261117-090507+0100_s0.jpg')
    expect(frameFileName(new Date(2026, 6, 2, 23, 59, 59), 2)).toBe('20260702-235959+0200_s2.jpg')
  })

  it('keeps the two 2:30 AM frames of the autumn clock change apart', () => {
    const first = new Date('2026-10-25T00:30:00Z') // 02:30 CEST
    const second = new Date('2026-10-25T01:30:00Z') // 02:30 CET
    expect(frameFileName(first, 0)).toBe('20261025-023000+0200_s0.jpg')
    expect(frameFileName(second, 0)).toBe('20261025-023000+0100_s0.jpg')
  })

  it('runs in the test time zone on every OS (vitest.config.ts sets TZ=Europe/Berlin)', () => {
    // Winter is UTC+1, summer UTC+2; a TZ the OS ignored would show the runner's zone instead.
    expect(new Date(2026, 0, 15).getTimezoneOffset()).toBe(-60)
    expect(new Date(2026, 6, 15).getTimezoneOffset()).toBe(-120)
    expect(frameFileName(new Date(Date.UTC(2026, 6, 15, 7, 0, 0)), 1)).toBe('20260715-090000+0200_s1.jpg')
  })
})

describe('displayUnderCursor', () => {
  // Laptop at the origin, a larger screen to its right, a third one above the laptop.
  const laptop = display(1, 0, 0, 1440, 900, 2)
  const right = display(2, 1440, 0, 2560, 1440)
  const above = display(3, 0, -1080, 1920, 1080)
  const all = [laptop, right, above]

  it('picks the display whose bounds contain the cursor', () => {
    expect(displayUnderCursor(all, { x: 10, y: 10 })).toBe(laptop)
    expect(displayUnderCursor(all, { x: 2000, y: 1200 })).toBe(right)
    expect(displayUnderCursor(all, { x: 500, y: -1 })).toBe(above)
  })

  it('gives a shared edge to the display that starts there', () => {
    expect(displayUnderCursor(all, { x: 1440, y: 0 })).toBe(right)
    expect(displayUnderCursor(all, { x: 0, y: 0 })).toBe(laptop)
  })

  it('falls back to the nearest display when the cursor sits in a gap', () => {
    expect(displayUnderCursor(all, { x: 1000, y: 1000 })).toBe(laptop)
    expect(displayUnderCursor(all, { x: 1500, y: 1500 })).toBe(right)
  })

  it('returns null without displays', () => {
    expect(displayUnderCursor([], { x: 0, y: 0 })).toBeNull()
  })
})

describe('thumbnailSize', () => {
  it('scales to the configured height and keeps the aspect ratio', () => {
    expect(thumbnailSize(display(1, 0, 0, 2560, 1440), 720)).toEqual({ width: 1280, height: 720 })
    expect(thumbnailSize(display(1, 0, 0, 1920, 1200), 1080)).toEqual({ width: 1728, height: 1080 })
  })

  it('counts physical pixels on HiDPI screens and never upscales', () => {
    expect(thumbnailSize(display(1, 0, 0, 1440, 900, 2), 1080)).toEqual({ width: 1728, height: 1080 })
    expect(thumbnailSize(display(1, 0, 0, 1366, 768), 1080)).toEqual({ width: 1366, height: 768 })
  })
})

describe('sourceForDisplay', () => {
  const sources = [
    { id: 'screen:0:0', display_id: '11' },
    { id: 'screen:1:0', display_id: '22' }
  ]

  it('matches the source by display ID', () => {
    expect(sourceForDisplay(sources, { id: 22 }, 2)).toBe(sources[1])
  })

  it('uses the only source when there is only one display', () => {
    expect(sourceForDisplay([{ id: 'screen:0:0', display_id: '' }], { id: 5 }, 1)).toEqual({ id: 'screen:0:0', display_id: '' })
  })

  it('refuses to guess between several unmatched sources', () => {
    expect(sourceForDisplay(sources, { id: 33 }, 2)).toBeNull()
  })
})
