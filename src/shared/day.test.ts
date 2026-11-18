import { describe, expect, it } from 'vitest'
import { beforeBoundary, dayCount, dayKey, dayRange, daysOf, isDayKey, shiftDay } from './day'

const at = (y: number, mo: number, d: number, h: number, m = 0) => new Date(y, mo - 1, d, h, m).getTime() / 1000

describe('4 AM day boundary', () => {
  it('counts the hours before 4 AM to the previous day', () => {
    expect(dayKey(at(2026, 11, 18, 3, 59))).toBe('2026-11-17')
    expect(dayKey(at(2026, 11, 18, 4, 0))).toBe('2026-11-18')
    expect(dayKey(at(2026, 1, 1, 1, 0))).toBe('2025-12-31')
  })

  it('gives a day as 4 AM to 4 AM the next morning', () => {
    expect(dayRange('2026-11-17')).toEqual({ start: at(2026, 11, 17, 4), end: at(2026, 11, 18, 4) })
  })

  it('steps between days across month ends', () => {
    expect(shiftDay('2026-11-30', 1)).toBe('2026-12-01')
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28')
  })
})

describe('isDayKey', () => {
  it('accepts real YYYY-MM-DD dates only', () => {
    expect(isDayKey('2026-11-17')).toBe(true)
    expect(isDayKey('2028-02-29')).toBe(true)
    for (const bad of ['2026-02-30', '2026-13-01', '2026-1-1', '17.11.2026', '', ' 2026-11-17', '2026-11-17T00:00']) {
      expect(isDayKey(bad), bad).toBe(false)
    }
  })
})

describe('day ranges and the boundary hour', () => {
  it('lists and counts the days of an inclusive range, across the clock change', () => {
    expect(daysOf('2026-10-24', '2026-10-26')).toEqual(['2026-10-24', '2026-10-25', '2026-10-26'])
    expect(daysOf('2026-11-17', '2026-11-17')).toEqual(['2026-11-17'])
    expect(daysOf('2026-11-18', '2026-11-17')).toEqual([])
    expect(dayCount('2026-10-24', '2026-10-26')).toBe(3)
    expect(dayCount('2026-01-01', '2026-12-31')).toBe(365)
  })

  it('knows when a calendar day has not reached the 4 AM boundary yet', () => {
    expect(beforeBoundary(new Date(2026, 10, 17, 3, 59))).toBe(true)
    expect(beforeBoundary(new Date(2026, 10, 17, 4, 0))).toBe(false)
  })
})
