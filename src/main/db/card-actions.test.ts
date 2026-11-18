import { beforeEach, describe, expect, it } from 'vitest'
import { Store } from './store'

const at = (h: number, m: number) => new Date(2026, 10, 17, h, m).getTime() / 1000
let store: Store

const card = (start: number, end: number, title: string, category = 'Work') => ({
  start, end, title, category, subcategory: '', summary: '', detailedSummary: '', distractions: [], appSites: {}
})

beforeEach(() => {
  store = Store.open(':memory:')
})

describe('card actions', () => {
  it('edits a card\'s title and category and deletes cards', () => {
    const b = store.createBatch({ start: at(9, 0), end: at(9, 15), shotIds: [] })
    store.replaceCards({ start: at(9, 0), end: at(9, 30) }, b, [card(at(9, 0), at(9, 15), 'Old'), card(at(9, 15), at(9, 30), 'Other')])
    const [first, second] = store.cardsForDay('2026-11-17')

    expect(store.updateCard(first!.id, { title: 'Fixed the login bug', category: 'Personal' })).toMatchObject({ title: 'Fixed the login bug', category: 'Personal' })
    store.deleteCard(second!.id)

    expect(store.cardsForDay('2026-11-17').map((c) => [c.title, c.category])).toEqual([['Fixed the login bug', 'Personal']])
  })

  it('carries a category rename over to existing cards', () => {
    const b = store.createBatch({ start: at(9, 0), end: at(9, 15), shotIds: [] })
    store.replaceCards({ start: at(9, 0), end: at(9, 15) }, b, [card(at(9, 0), at(9, 15), 'x', 'Work')])
    store.renameCategory('Work', 'Deep work')
    expect(store.cardsForDay('2026-11-17')[0]!.category).toBe('Deep work')
  })

  it('rates time ranges like upstream: a new rating replaces the overlapping part of older ones', () => {
    store.rateRange({ start: at(9, 0), end: at(10, 0) }, 'up')
    store.rateRange({ start: at(9, 20), end: at(9, 40) }, 'down', 'Title was wrong')

    expect(store.ratings({ start: at(8, 0), end: at(11, 0) })).toEqual([
      { start: at(9, 0), end: at(9, 20), rating: 'up', feedback: null },
      { start: at(9, 20), end: at(9, 40), rating: 'down', feedback: 'Title was wrong' },
      { start: at(9, 40), end: at(10, 0), rating: 'up', feedback: null }
    ])
  })

  it('reprocesses a single batch, failed or not, but leaves one being analyzed alone', () => {
    const done = store.createBatch({ start: at(9, 0), end: at(9, 15), shotIds: [] })
    store.finishBatch(done, 'completed')
    store.replaceCards({ start: at(9, 0), end: at(9, 15) }, done, [card(at(9, 0), at(9, 15), 'x')])
    const running = store.createBatch({ start: at(9, 15), end: at(9, 30), shotIds: [] })
    store.startAttempt(running)

    expect(store.reprocessBatch(done)).toBe(true)
    expect(store.reprocessBatch(running)).toBe(false)

    expect(store.pendingBatches().map((x) => x.id)).toEqual([done])
    expect(store.cardsForDay('2026-11-17')).toEqual([])
  })

  it('reprocesses a day: its batches become pending again and their cards and observations go', () => {
    const done = store.createBatch({ start: at(9, 0), end: at(9, 15), shotIds: [] })
    store.startAttempt(done)
    store.finishBatch(done, 'completed')
    store.replaceCards({ start: at(9, 0), end: at(9, 15) }, done, [card(at(9, 0), at(9, 15), 'x')])
    const running = store.createBatch({ start: at(11, 0), end: at(11, 15), shotIds: [] })
    store.startAttempt(running)
    store.replaceObservations(done, [{ start: at(9, 0), end: at(9, 15), text: 'obs' }], 'm')
    const short = store.createBatch({ start: at(10, 0), end: at(10, 2), shotIds: [] })
    store.finishBatch(short, 'skipped_short')
    const otherDay = store.createBatch({ start: at(9, 0) + 86400, end: at(9, 15) + 86400, shotIds: [] })
    store.finishBatch(otherDay, 'completed')

    expect(store.reprocessDay('2026-11-17')).toBe(1)

    expect(store.pendingBatches().map((x) => x.id)).toEqual([done])
    expect(store.batch(done)).toMatchObject({ attempts: 0 })
    expect(store.cardsForDay('2026-11-17')).toEqual([])
  })
})

describe('idle card writes (upstream saveIdleBatchCard)', () => {
  it('replaces only the batch\'s own cards; other batches\' cards stay', () => {
    const older = store.createBatch({ start: at(9, 0), end: at(9, 15), shotIds: [] })
    const idle = store.createBatch({ start: at(9, 15), end: at(9, 30), shotIds: [] })
    store.addCards(older, [card(at(9, 0), at(9, 20), 'Ran late')])
    store.addCards(idle, [card(at(9, 15), at(9, 30), 'Earlier attempt')])

    store.replaceBatchCards(idle, [card(at(9, 20), at(9, 30), 'Idle', 'Idle')])

    expect(store.cardsForDay('2026-11-17').map((c) => c.title)).toEqual(['Ran late', 'Idle'])
  })

  it('extends a live card only, and says whether it did', () => {
    const b = store.createBatch({ start: at(9, 0), end: at(9, 15), shotIds: [] })
    const next = store.createBatch({ start: at(9, 15), end: at(9, 30), shotIds: [] })
    store.addCards(b, [card(at(9, 0), at(9, 15), 'Idle', 'Idle')])
    const [idleCard] = store.cardsForDay('2026-11-17')

    expect(store.extendCard(idleCard!.id, at(9, 30), next)).toBe(true)
    expect(store.cardsForDay('2026-11-17')).toMatchObject([{ title: 'Idle', endTime: '9:30 AM' }])

    store.deleteCard(idleCard!.id)
    expect(store.extendCard(idleCard!.id, at(9, 45), next)).toBe(false)
  })
})
