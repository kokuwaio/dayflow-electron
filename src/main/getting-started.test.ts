import { describe, expect, it } from 'vitest'
import { INACTIVE_GUIDE, beginGuide } from '../shared/getting-started'
import { applyGuidePatch } from './getting-started'

describe('guide changes from the window', () => {
  const guide = beginGuide(1_800_000_000)

  it('finishes the tour, collapses and dismisses the checklist', () => {
    expect(applyGuidePatch(guide, { tourPending: false, collapsed: true })).toEqual({ ...guide, tourPending: false, collapsed: true })
    expect(applyGuidePatch(guide, { dismissed: true }).dismissed).toBe(true)
  })

  it('cannot restart the guide or move its week', () => {
    expect(applyGuidePatch(INACTIVE_GUIDE, { active: true, startedAt: 5 })).toEqual(INACTIVE_GUIDE)
    expect(applyGuidePatch(guide, { tourPending: 'no' })).toEqual(guide)
    expect(applyGuidePatch(guide, null)).toEqual(guide)
  })

  it('ticks "Open a card" only while the guide runs, and never unticks it', () => {
    expect(applyGuidePatch(guide, { openedCard: true }).openedCard).toBe(true)
    expect(applyGuidePatch(INACTIVE_GUIDE, { openedCard: true }).openedCard).toBe(false)
    expect(applyGuidePatch({ ...guide, openedCard: true }, { openedCard: false }).openedCard).toBe(true)
  })
})
