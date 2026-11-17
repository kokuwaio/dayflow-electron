import { describe, expect, it } from 'vitest'
import { dayRange } from './day'
import { cardsToReviewPrompt, reviewSummary, unreviewedCards } from './review'
import type { TimelineCard } from './types'

const day = '2026-11-17'
const at = (h: number, m = 0) => new Date(2026, 10, 17, h, m).getTime() / 1000
let id = 0
const card = (h: number, mins: number, category = 'Work'): TimelineCard => ({
  id: ++id, batchId: 1, startTime: '', endTime: '', start: at(h), end: at(h) + mins * 60, day,
  title: 'x', summary: '', category, subcategory: '', detailedSummary: '', distractions: [], appSites: {}
})

describe('timeline review (upstream StorageManager+TimelineReview, TimelineReviewOverlay)', () => {
  it('offers every card but failed ones, in time order, until 80% of it is rated', () => {
    const a = card(10, 60)
    const b = card(9, 30, 'Idle')
    const failed = card(11, 15, 'System')
    expect(unreviewedCards([a, b, failed], [], day).map((c) => c.id)).toEqual([b.id, a.id])
    const partly = [{ start: at(10), end: at(10, 47), rating: 'focused' as const }]
    expect(unreviewedCards([a], partly, day)).toEqual([a]) // 47 of 60 minutes
    const enough = [{ start: at(10), end: at(10, 30), rating: 'focused' as const }, { start: at(10, 25), end: at(10, 48), rating: 'neutral' as const }]
    expect(unreviewedCards([a], enough, day)).toEqual([]) // 48 of 60, overlaps merged
  })

  it('sums rated time per rating, clipped to the 4 AM day, and the end of the latest rating', () => {
    const { start, end } = dayRange(day)
    const segments = [
      { start: start - 3600, end: start + 1800, rating: 'distracted' as const },
      { start: at(10), end: at(11), rating: 'focused' as const },
      { start: at(11), end: at(11, 15), rating: 'neutral' as const },
      { start: end - 600, end: end + 600, rating: 'focused' as const }
    ]
    expect(reviewSummary(segments, day)).toEqual({ distracted: 1800, neutral: 900, focused: 3600 + 600, total: 1800 + 900 + 4200, lastReviewedAt: end })
    expect(reviewSummary([], day)).toEqual({ distracted: 0, neutral: 0, focused: 0, total: 0, lastReviewedAt: null })
  })

  it('prompts only new reviewers and those who rated in the last 7 days', () => {
    expect(cardsToReviewPrompt(3, { hasAny: false, hasRecent: false })).toBe(3)
    expect(cardsToReviewPrompt(3, { hasAny: true, hasRecent: true })).toBe(3)
    expect(cardsToReviewPrompt(3, { hasAny: true, hasRecent: false })).toBe(0)
    expect(cardsToReviewPrompt(0, { hasAny: false, hasRecent: false })).toBe(0)
  })
})
