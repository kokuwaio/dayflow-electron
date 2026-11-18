import { describe, expect, it } from 'vitest'
import {
  STORAGE_LIMIT_PRESETS,
  estimatedBytesPerHour,
  estimatedBytesPerMonth,
  limitBytes,
  limitChange,
  limitLabel,
  observedBytesPerHour,
  sizeLabel,
  snapStorageLimit,
  usedShare
} from './storage'

describe('storage limit presets', () => {
  it('offers upstream 1, 2, 3, 5, 10 and 20 GB and Unlimited', () => {
    expect(STORAGE_LIMIT_PRESETS).toEqual([1, 2, 3, 5, 10, 20, 0])
    expect(STORAGE_LIMIT_PRESETS.map(limitLabel)).toEqual(['1 GB', '2 GB', '3 GB', '5 GB', '10 GB', '20 GB', 'Unlimited'])
  })

  it('snaps an older typed limit up to the next preset, and above 20 GB to Unlimited', () => {
    expect(snapStorageLimit(10)).toBe(10)
    expect(snapStorageLimit(4)).toBe(5)
    expect(snapStorageLimit(7)).toBe(10)
    expect(snapStorageLimit(1.5)).toBe(2)
    expect(snapStorageLimit(50)).toBe(0)
    expect(snapStorageLimit(0)).toBe(0)
  })

  it('falls back to the default for missing or broken values', () => {
    expect(snapStorageLimit(undefined)).toBe(10)
    expect(snapStorageLimit('abc')).toBe(10)
    expect(snapStorageLimit(-3)).toBe(10)
    expect(snapStorageLimit(null, 5)).toBe(5)
  })

  it('counts a GB as 1024³ bytes, like the purge always did', () => {
    expect(limitBytes(10)).toBe(10 * 1024 ** 3)
    expect(limitBytes(0)).toBe(Infinity)
  })
})

describe('changing the limit', () => {
  it('asks first when the new limit is lower, since that deletes the oldest recordings', () => {
    expect(limitChange(10, 5)).toBe('confirm')
    expect(limitChange(0, 20)).toBe('confirm') // Unlimited → 20 GB
  })

  it('applies a higher limit or Unlimited right away', () => {
    expect(limitChange(5, 10)).toBe('apply')
    expect(limitChange(20, 0)).toBe('apply')
  })

  it('does nothing for the same limit', () => {
    expect(limitChange(10, 10)).toBe('none')
    expect(limitChange(0, 0)).toBe('none')
  })
})

describe('disk use per hour', () => {
  it('expects about 25 MB per hour at 720p every 10 s and about 52 MB at 1080p', () => {
    expect(estimatedBytesPerHour(720, 10)).toBe(25_200_000)
    expect(estimatedBytesPerHour(1080, 10)).toBe(52_200_000)
  })

  it('scales with the capture interval', () => {
    expect(estimatedBytesPerHour(720, 1)).toBe(252_000_000)
    expect(estimatedBytesPerHour(720, 60)).toBe(4_200_000)
  })

  it('reckons a month as 8 hours a day for 30 days, like upstream', () => {
    expect(estimatedBytesPerMonth(25_200_000)).toBe(6_048_000_000)
  })

  it('measures the last hour once the frames span 10 minutes', () => {
    const now = 100_000
    // One 70 KB frame every 10 s for the last 20 minutes: 120 frames over 1190 s.
    const frames = Array.from({ length: 120 }, (_, i) => ({ capturedAt: now - 1190 + i * 10, bytes: 70_000 }))
    expect(observedBytesPerHour(frames, now)).toBe(Math.round((120 * 70_000 * 3600) / 1190))
  })

  it('ignores frames older than an hour and says nothing for under 10 minutes', () => {
    const now = 100_000
    const old = { capturedAt: now - 7200, bytes: 1_000_000 }
    const recent = Array.from({ length: 30 }, (_, i) => ({ capturedAt: now - 290 + i * 10, bytes: 70_000 }))
    expect(observedBytesPerHour([old, ...recent], now)).toBeNull()
    expect(observedBytesPerHour([], now)).toBeNull()
  })
})

describe('labels', () => {
  it('shows MB below 1 GB and GB above', () => {
    expect(sizeLabel(25_200_000)).toBe('24 MB')
    expect(sizeLabel(1.5 * 1024 ** 3)).toBe('1.5 GB')
    expect(sizeLabel(12 * 1024 ** 3)).toBe('12 GB')
  })

  it('tells how full the limit is, and nothing for Unlimited', () => {
    expect(usedShare(5 * 1024 ** 3, 10)).toBe(0.5)
    expect(usedShare(15 * 1024 ** 3, 10)).toBe(1)
    expect(usedShare(15 * 1024 ** 3, 0)).toBeNull()
  })
})
