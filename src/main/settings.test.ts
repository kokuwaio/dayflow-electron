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
