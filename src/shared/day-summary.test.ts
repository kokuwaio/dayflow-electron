import { describe, expect, it } from 'vitest'
import { DEFAULT_CATEGORIES } from './categories'
import { defaultGoalPlan, summarizeDay } from './day-summary'
import type { TimelineCard } from './types'

const at = (h: number, m: number) => new Date(2026, 10, 17, h, m).getTime() / 1000
let id = 0
const card = (start: number, end: number, category: string): TimelineCard => ({
  id: ++id, batchId: 1, startTime: '', endTime: '', start, end, day: '2026-11-17', title: category, summary: '',
  category, subcategory: '', detailedSummary: '', distractions: [], appSites: {}
})

describe('defaultGoalPlan', () => {
  it('follows upstream: 4.5 h focus, 2 h distraction, every category but Idle and Distraction counts as focus', () => {
    expect(defaultGoalPlan(DEFAULT_CATEGORIES)).toEqual({
      focusTargetMinutes: 270,
      distractionLimitMinutes: 120,
      focusCategories: ['Work', 'Personal'],
      distractionCategories: ['Distraction'],
      skipped: false
    })
  })
})

describe('summarizeDay', () => {
  const plan = defaultGoalPlan(DEFAULT_CATEGORIES)

  it('counts each minute once, leaves out Idle, System and Private, and sorts categories by time', () => {
    const cards = [
      card(at(9, 0), at(10, 0), 'Work'),
      card(at(9, 30), at(10, 30), 'Personal'), // overlaps Work by 30 min
      card(at(10, 30), at(11, 0), 'Idle'),
      card(at(11, 0), at(11, 20), 'System'),
      card(at(11, 20), at(11, 40), 'Private'),
      card(at(12, 0), at(12, 45), 'Distraction')
    ]
    const s = summarizeDay(cards, DEFAULT_CATEGORIES, plan)
    expect(s.totals).toEqual([
      { category: 'Work', minutes: 60, color: '#B984FF' },
      { category: 'Distraction', minutes: 45, color: '#FF5950' },
      { category: 'Personal', minutes: 30, color: '#6AADFF' }
    ])
    expect(s).toMatchObject({ capturedMinutes: 135, focusMinutes: 90, distractedMinutes: 45 })
  })

  it('finds the longest focus block, joining focus stretches less than 5 minutes apart', () => {
    const cards = [
      card(at(9, 0), at(9, 40), 'Work'),
      card(at(9, 44), at(10, 30), 'Personal'), // 4 min gap: same block
      card(at(10, 36), at(11, 30), 'Work') // 6 min gap: new block
    ]
    expect(summarizeDay(cards, DEFAULT_CATEGORIES, plan).longestFocusMinutes).toBe(90)
  })

  it('counts only the part of a card inside its 4 AM day, and matches categories regardless of case', () => {
    const lateNight = card(at(23, 0), new Date(2026, 10, 18, 5, 0).getTime() / 1000, ' work ') // ends 1 h after the day
    const s = summarizeDay([lateNight], DEFAULT_CATEGORIES, plan, '2026-11-17')
    expect(s).toMatchObject({ capturedMinutes: 300, focusMinutes: 300 })
  })
})
