import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_CATEGORIES } from '../../shared/categories'
import { Store } from './store'

let store: Store
beforeEach(() => {
  store = Store.open(':memory:')
})

const plan = { focusTargetMinutes: 300, distractionLimitMinutes: 60, focusCategories: ['Work'], distractionCategories: ['Distraction'], skipped: false }

describe('day goals', () => {
  it('has no plan until one is set', () => {
    expect(store.goalPlan('2026-11-17', DEFAULT_CATEGORIES)).toBeNull()
  })

  it('carries the newest earlier plan forward, but not its "skipped" flag', () => {
    store.setGoalPlan('2026-11-15', { ...plan, skipped: true }, DEFAULT_CATEGORIES)
    expect(store.goalPlan('2026-11-17', DEFAULT_CATEGORIES)).toEqual({ ...plan, skipped: false })
    expect(store.goalPlan('2026-11-15', DEFAULT_CATEGORIES)).toEqual({ ...plan, skipped: true })
    expect(store.goalPlan('2026-11-14', DEFAULT_CATEGORIES)).toBeNull()
  })

  it('tells whether a day has a plan of its own', () => {
    store.setGoalPlan('2026-11-15', plan, DEFAULT_CATEGORIES)
    expect(store.hasOwnGoalPlan('2026-11-15')).toBe(true)
    expect(store.hasOwnGoalPlan('2026-11-16')).toBe(false)
  })

  it('counts the skipped days in a row before a day, at most five', () => {
    expect(store.goalSkipStreak('2026-11-17')).toBe(0)
    store.setGoalPlan('2026-11-10', plan, DEFAULT_CATEGORIES)
    for (const d of ['11', '12', '14', '16', '17']) store.setGoalPlan(`2026-11-${d}`, { ...plan, skipped: true }, DEFAULT_CATEGORIES)
    expect(store.goalSkipStreak('2026-11-17')).toBe(4) // the 17th itself does not count
    expect(store.goalSkipStreak('2026-11-18')).toBe(5)
    store.setGoalPlan('2026-11-14', plan, DEFAULT_CATEGORIES)
    expect(store.goalSkipStreak('2026-11-17')).toBe(1)
  })

  it('counts the days with cards other than the given one', () => {
    const at = (d: number, h: number) => new Date(2026, 10, d, h).getTime() / 1000
    const card = (d: number) => ({ start: at(d, 9), end: at(d, 10), title: 'x', category: 'Work', subcategory: '', summary: '', detailedSummary: '', distractions: [], appSites: {} })
    const b = store.createBatch({ start: at(14, 9), end: at(17, 10), shotIds: [] })
    store.addCards(b, [card(14), card(15), card(15), card(17)])
    expect(store.activeCardDays('2026-11-17')).toBe(2)
  })

  it('follows a renamed category by its id', () => {
    store.setGoalPlan('2026-11-17', plan, DEFAULT_CATEGORIES)
    const renamed = DEFAULT_CATEGORIES.map((c) => (c.id === 'work' ? { ...c, name: 'Deep work' } : c))
    expect(store.goalPlan('2026-11-17', renamed)?.focusCategories).toEqual(['Deep work'])
  })
})
