import { describe, expect, it } from 'vitest'
import { badgeCount, badgeOnRecap, badgeOnView } from './daily-badge'

describe('the Daily "ready" badge', () => {
  const away = { tab: 'timeline', focused: true } as const
  const onDaily = { tab: 'daily', focused: true } as const
  const hidden = { tab: 'daily', focused: false } as const

  it('appears when the scheduler writes a recap the user is not looking at', () => {
    expect(badgeOnRecap('', '2026-11-18', away)).toBe('2026-11-18')
    // Window in the tray, last on Daily: still unseen.
    expect(badgeOnRecap('', '2026-11-18', hidden)).toBe('2026-11-18')
  })

  it('does not appear while Daily is on screen', () => {
    expect(badgeOnRecap('', '2026-11-18', onDaily)).toBe('')
  })

  it('stays through other tabs and clears once Daily is opened in a focused window', () => {
    expect(badgeOnView('2026-11-18', away)).toBe('2026-11-18')
    expect(badgeOnView('2026-11-18', hidden)).toBe('2026-11-18')
    expect(badgeOnView('2026-11-18', onDaily)).toBe('')
  })

  it('counts one for the Dock or launcher while unseen', () => {
    expect(badgeCount('2026-11-18')).toBe(1)
    expect(badgeCount('')).toBe(0)
  })
})
