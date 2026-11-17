import { describe, expect, it } from 'vitest'
import { cycleCategory, goalFlowStart, goalPromptAction, referenceMinutes, spelledDuration, wheelMinutes } from './goal-flow'

const plan = { focusTargetMinutes: 270, distractionLimitMinutes: 120, focusCategories: ['Work'], distractionCategories: ['Distraction'], skipped: false }
const check = { enabled: true, handledDay: null, today: '2026-11-17', hasOwnPlan: false, activeDays: 3, skipStreak: 0 }

describe('daily goal pop-up (upstream MainView/Lifecycle.swift, DayGoalFlowView.swift)', () => {
  it('opens once a day after three active days, unless turned off, set already or skipped five times in a row', () => {
    expect(goalPromptAction(check)).toBe('open')
    expect(goalPromptAction({ ...check, enabled: false })).toBe('none')
    expect(goalPromptAction({ ...check, handledDay: '2026-11-17' })).toBe('none')
    expect(goalPromptAction({ ...check, hasOwnPlan: true })).toBe('handled')
    expect(goalPromptAction({ ...check, activeDays: 2 })).toBe('none')
    expect(goalPromptAction({ ...check, skipStreak: 5 })).toBe('none')
    expect(goalPromptAction({ ...check, skipStreak: 4 })).toBe('open')
  })

  it("starts with yesterday's review once a day when yesterday had confirmed goals", () => {
    expect(goalFlowStart(plan, null, '2026-11-17')).toBe('review')
    expect(goalFlowStart(plan, '2026-11-17', '2026-11-17')).toBe('setup')
    expect(goalFlowStart({ ...plan, skipped: true }, null, '2026-11-17')).toBe('setup')
    expect(goalFlowStart(null, null, '2026-11-17')).toBe('setup')
  })

  it('cycles a clicked category: untracked, focus, distraction, untracked', () => {
    const empty = { ...plan, focusCategories: [], distractionCategories: [] }
    const focus = cycleCategory(empty, 'Personal')
    expect(focus.focusCategories).toEqual(['Personal'])
    const distraction = cycleCategory(focus, 'Personal')
    expect([distraction.focusCategories, distraction.distractionCategories]).toEqual([[], ['Personal']])
    expect(cycleCategory(distraction, 'Personal')).toEqual(empty)
  })

  it("sums the reference minutes of a panel's categories, any case", () => {
    expect(referenceMinutes({ Work: 120, Personal: 30, Distraction: 15 }, ['work', 'Personal'])).toBe(150)
    expect(referenceMinutes({}, ['Work'])).toBe(0)
  })

  it('spells durations out and keeps the wheels within 12 hours', () => {
    expect(spelledDuration(150)).toBe('2 hours, 30 minutes')
    expect(spelledDuration(60)).toBe('1 hour')
    expect(spelledDuration(1)).toBe('1 minute')
    expect(spelledDuration(0)).toBe('0 minutes')
    expect(wheelMinutes(4, 30)).toBe(270)
    expect(wheelMinutes(12, 55)).toBe(720)
    expect(wheelMinutes(-1, 70)).toBe(55)
  })
})
