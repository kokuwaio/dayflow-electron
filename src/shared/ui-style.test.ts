import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from './types'
import { sanitizeUiStyle, windowBackground } from './ui-style'

describe('sanitizeUiStyle', () => {
  it('keeps the known styles', () => {
    expect(sanitizeUiStyle('dayflow')).toBe('dayflow')
    expect(sanitizeUiStyle('modern')).toBe('modern')
  })

  it('falls back to Modern, the default, for anything else', () => {
    for (const value of [undefined, null, '', 'Modern', 'glass', 42, {}]) expect(sanitizeUiStyle(value)).toBe('modern')
    expect(DEFAULT_SETTINGS.uiStyle).toBe('modern')
  })
})

describe('windowBackground', () => {
  it("matches each style's window colour, so the window does not flash", () => {
    expect(windowBackground('dayflow', true)).toBe('#303C5B')
    expect(windowBackground('dayflow', false)).toBe('#FFE6E0')
    expect(windowBackground('modern', true)).toBe('#0E0F12')
    expect(windowBackground('modern', false)).toBe('#F7F7F8')
  })
})
