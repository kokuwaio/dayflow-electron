import { describe, expect, it } from 'vitest'
import { DEFAULT_PAUSE_MINUTES, PAUSE_PRESETS, pauseChipLabel, pauseChipTitle, pauseLabel, pausePresets, sanitizePauseMinutes } from './status'

describe('pause lengths', () => {
  it('default to 15, 30 and 60 minutes plus until resumed', () => {
    expect(DEFAULT_PAUSE_MINUTES).toEqual([15, 30, 60])
    expect(PAUSE_PRESETS).toEqual([{ seconds: 900 }, { seconds: 1800 }, { seconds: 3600 }, { seconds: null }])
  })

  it('follow the three chosen lengths, shortest first', () => {
    expect(pausePresets([90, 5, 240])).toEqual([{ seconds: 300 }, { seconds: 5400 }, { seconds: 14400 }, { seconds: null }])
  })

  it('show a length chosen twice once', () => {
    expect(pausePresets([30, 30, 60]).map((p) => p.seconds)).toEqual([1800, 3600, null])
  })

  it('keep only three of upstream options, else the defaults', () => {
    expect(sanitizePauseMinutes([5, 45, 480])).toEqual([5, 45, 480])
    expect(sanitizePauseMinutes([15, 30])).toEqual([15, 30, 60])
    expect(sanitizePauseMinutes([15, 30, 7])).toEqual([15, 30, 60])
    expect(sanitizePauseMinutes('15,30,60')).toEqual([15, 30, 60])
    expect(sanitizePauseMinutes(undefined)).toEqual([15, 30, 60])
  })
})

describe('pause labels', () => {
  it('reads as a menu entry', () => {
    expect(pauseLabel(15 * 60)).toBe('For 15 minutes')
    expect(pauseLabel(3600)).toBe('For 1 hour')
    expect(pauseLabel(4 * 3600)).toBe('For 4 hours')
    expect(pauseLabel(90 * 60)).toBe('For 1 hour, 30 minutes')
    expect(pauseLabel(null)).toBe('Until I resume')
  })

  it('reads short on a chip, like upstream', () => {
    expect([300, 3600, 5400, 28800, null].map(pauseChipLabel)).toEqual(['5m', '1h', '1h 30m', '8h', '∞'])
  })

  it('names the chip in full', () => {
    expect(pauseChipTitle(1800)).toBe('Pause for 30 minutes')
    expect(pauseChipTitle(7200)).toBe('Pause for 2 hours')
    expect(pauseChipTitle(5400)).toBe('Pause for 1 hour, 30 minutes')
    expect(pauseChipTitle(null)).toBe('Pause until I resume')
  })
})
