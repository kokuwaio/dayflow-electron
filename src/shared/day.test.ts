import { describe, expect, it } from 'vitest'
import { dayKey, dayRange, isDayKey, shiftDay } from './day'

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
