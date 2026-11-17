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

  it('follows a renamed category by its id', () => {
    store.setGoalPlan('2026-11-17', plan, DEFAULT_CATEGORIES)
    const renamed = DEFAULT_CATEGORIES.map((c) => (c.id === 'work' ? { ...c, name: 'Deep work' } : c))
    expect(store.goalPlan('2026-11-17', renamed)?.focusCategories).toEqual(['Deep work'])
  })
})
