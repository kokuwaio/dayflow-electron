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
