import { describe, expect, it } from 'vitest'
import { Store } from './store'

const draft = { highlightsTitle: 'Yesterday', highlights: ['Shipped it.'], tasksTitle: 'Today', tasks: [], blockersTitle: 'Blockers', blockersBody: '' }
const at = (d: number, h: number) => new Date(2026, 10, d, h).getTime() / 1000

describe('daily store', () => {
  it('saves one standup per day and remembers which days were summarized', () => {
    const store = Store.open(':memory:')
    expect(store.standup('2026-11-17')).toBeNull()
    store.saveStandup('2026-11-17', { draft, sourceDay: '2026-11-16', provider: 'openai', model: 'qwen', generatedAt: 1 })
    store.saveStandup('2026-11-17', { draft: { ...draft, blockersBody: 'none' }, sourceDay: '2026-11-16', provider: 'openai', model: 'qwen', generatedAt: 2 })
    store.saveStandup('2026-11-18', { draft, sourceDay: '2026-11-15', provider: 'openai', model: 'qwen', generatedAt: 3 })

    expect(store.standup('2026-11-17')).toMatchObject({ draft: { blockersBody: 'none' }, sourceDay: '2026-11-16', generatedAt: 2 })
    expect(store.usedSourceDays('2026-11-18')).toEqual(new Set(['2026-11-16']))
  })

  it('counts analyzed batches for unlocking and card minutes per day', () => {
    const store = Store.open(':memory:')
    for (const status of ['completed', 'analyzed', 'failed', 'skipped_short'] as const) {
      const b = store.createBatch({ start: 0, end: 900, shotIds: [] })
      store.finishBatch(b, status)
    }
    expect(store.analyzedBatchCount()).toBe(2)
    const b = store.createBatch({ start: at(17, 9), end: at(17, 10), shotIds: [] })
    const card = { start: at(17, 9), end: at(17, 10), title: 'x', category: 'Work', subcategory: '', summary: '', detailedSummary: '', distractions: [], appSites: {} }
    store.replaceCards({ start: at(17, 9), end: at(17, 11) }, b, [card, { ...card, start: at(17, 10), end: at(17, 10) + 1800 }])
    expect(store.cardMinutesOn('2026-11-17')).toBe(90)
  })
})
