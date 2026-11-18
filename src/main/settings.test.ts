import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../shared/types'
import { sanitizeSettings } from './settings'

describe('sanitizeSettings: capture resolution', () => {
  it('records at 720p unless 1080p was chosen', () => {
    expect(DEFAULT_SETTINGS.captureHeight).toBe(720)
    expect(sanitizeSettings({}).captureHeight).toBe(720)
    expect(sanitizeSettings({ captureHeight: 4320 } as never).captureHeight).toBe(720)
    expect(sanitizeSettings({ captureHeight: 1080 }).captureHeight).toBe(1080)
  })
})

describe('sanitizeSettings: first-day guide and Daily provider', () => {
  it('keeps the guide off for older settings files and the Daily provider on "auto"', () => {
    const s = sanitizeSettings({ provider: 'gemini' })
    expect(s.gettingStarted.active).toBe(false)
    expect(s.dailyProvider).toBe('auto')
    expect(s.dailyRecapUnseen).toBe('')
  })

  it('keeps valid choices and drops broken ones', () => {
    expect(sanitizeSettings({ dailyProvider: 'none' }).dailyProvider).toBe('none')
    expect(sanitizeSettings({ dailyProvider: 'codex-cli' }).dailyProvider).toBe('codex-cli')
    expect(sanitizeSettings({ dailyProvider: 'dayflow' } as never).dailyProvider).toBe('auto')
    expect(sanitizeSettings({ dailyRecapUnseen: '2026-11-18' }).dailyRecapUnseen).toBe('2026-11-18')
    expect(sanitizeSettings({ dailyRecapUnseen: 'yesterday' }).dailyRecapUnseen).toBe('')
  })
})

describe('sanitizeSettings: launch at login', () => {
  it('stays off unless the user turned it on', () => {
    expect(DEFAULT_SETTINGS.launchAtLogin).toBe(false)
    expect(sanitizeSettings({}).launchAtLogin).toBe(false)
    // An install from before the setting existed, and values that are not exactly true.
    expect(sanitizeSettings({ provider: 'anthropic' }).launchAtLogin).toBe(false)
    expect(sanitizeSettings({ launchAtLogin: 'true' } as never).launchAtLogin).toBe(false)
    expect(sanitizeSettings({ launchAtLogin: true }).launchAtLogin).toBe(true)
  })

  it('is never switched on by the first-run setup', () => {
    const onboarding = readFileSync(new URL('../renderer/src/Onboarding.tsx', import.meta.url), 'utf8')
    expect(onboarding).not.toMatch(/launchAtLogin|setAutostart/)
  })
})

describe('sanitizeSettings: storage limit', () => {
  it('keeps the presets and Unlimited (0)', () => {
    expect(DEFAULT_SETTINGS.storageLimitGb).toBe(10)
    expect(sanitizeSettings({}).storageLimitGb).toBe(10)
    expect(sanitizeSettings({ storageLimitGb: 3 }).storageLimitGb).toBe(3)
    expect(sanitizeSettings({ storageLimitGb: 0 }).storageLimitGb).toBe(0)
  })

  it('moves a typed limit from older versions up to the next preset', () => {
    expect(sanitizeSettings({ storageLimitGb: 8 }).storageLimitGb).toBe(10)
    expect(sanitizeSettings({ storageLimitGb: 64 }).storageLimitGb).toBe(0)
  })
})

describe('sanitizeSettings: pause lengths', () => {
  it('defaults to 15, 30 and 60 minutes and keeps three of upstream choices', () => {
    expect(sanitizeSettings({}).pauseMinutes).toEqual([15, 30, 60])
    expect(sanitizeSettings({ pauseMinutes: [5, 90, 480] }).pauseMinutes).toEqual([5, 90, 480])
    expect(sanitizeSettings({ pauseMinutes: [5, 90] } as never).pauseMinutes).toEqual([15, 30, 60])
  })
})
