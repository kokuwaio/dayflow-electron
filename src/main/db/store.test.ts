import { beforeEach, describe, expect, it } from 'vitest'
import { Store } from './store'

let store: Store
beforeEach(() => {
  store = Store.open(':memory:')
})

const shot = (capturedAt: number, idleSeconds: number | null = null) =>
  store.insertScreenshot({ capturedAt, filePath: `/frames/${capturedAt}.jpg`, fileSize: 1000, idleSeconds })

describe('Store: screenshots and batches', () => {
  it('offers each screenshot for batching until it belongs to a batch', () => {
    const ids = [shot(100), shot(110, 75), shot(120)]
    expect(store.unbatchedScreenshots(0).map((s) => s.id)).toEqual(ids)

    const batchId = store.createBatch({ start: 100, end: 110, shotIds: ids.slice(0, 2) })

    expect(store.unbatchedScreenshots(0).map((s) => s.id)).toEqual([ids[2]])
    expect(store.batch(batchId)).toMatchObject({ id: batchId, start: 100, end: 110, status: 'pending' })
    expect(store.batchScreenshots(batchId)).toMatchObject([
      { id: ids[0], capturedAt: 100, idleSeconds: null, filePath: '/frames/100.jpg' },
      { id: ids[1], capturedAt: 110, idleSeconds: 75 }
    ])
  })

  it('points screenshots at the recordings folder after the data folder moved', () => {
    const moved = store.insertScreenshot({ capturedAt: 100, filePath: '/old/app/recordings/a.jpg', fileSize: 1, idleSeconds: null })
    const current = store.insertScreenshot({ capturedAt: 110, filePath: '/new/app/recordings/b.jpg', fileSize: 1, idleSeconds: null })
    const blocked = store.insertScreenshot({ capturedAt: 120, filePath: '', fileSize: 0, idleSeconds: null, blocked: true })

    expect(store.relocateScreenshots('/new/app/recordings')).toBe(1)

    const batchId = store.createBatch({ start: 100, end: 120, shotIds: [moved, current, blocked] })
    expect(store.batchScreenshots(batchId).map((s) => s.filePath)).toEqual(['/new/app/recordings/a.jpg', '/new/app/recordings/b.jpg', ''])
    expect(store.relocateScreenshots('/new/app/recordings')).toBe(0)
  })

  it('queues failed batches again with fresh attempts', () => {
    const failed = store.createBatch({ start: 100, end: 110, shotIds: [shot(100)] })
    store.startAttempt(failed)
    store.finishBatch(failed, 'failed', 'ENOENT')
    const done = store.createBatch({ start: 200, end: 210, shotIds: [shot(200)] })
    store.startAttempt(done)
    store.finishBatch(done, 'completed')

    expect(store.retryFailedBatches()).toBe(1)
    expect(store.batch(failed)).toMatchObject({ status: 'pending', attempts: 0 })
    expect(store.batch(done)).toMatchObject({ status: 'completed' })
  })
})

describe('Store: timeline cards', () => {
  const at = (h: number, m: number) => new Date(2026, 10, 17, h, m).getTime() / 1000
  const newCard = (start: number, end: number, title: string, category = 'Work') => ({
    start, end, startTime: '', endTime: '', title, category, subcategory: '', summary: '', detailedSummary: '',
    distractions: [], appSites: {}
  })

  it('replaces the cards in a range, keeping error cards of other batches', () => {
    const b1 = store.createBatch({ start: at(9, 0), end: at(9, 15), shotIds: [] })
    const b2 = store.createBatch({ start: at(9, 15), end: at(9, 30), shotIds: [] })
    store.replaceCards({ start: at(9, 0), end: at(9, 15) }, b1, [newCard(at(9, 0), at(9, 15), 'first draft')])
    store.writeErrorCard(b1, { start: at(8, 30), end: at(8, 45) }, 'Rate limited.')

    expect(store.contextCards({ start: at(8, 30), end: at(9, 30) }).map((c) => c.title)).toEqual(['first draft'])

    store.replaceCards({ start: at(8, 30), end: at(9, 30) }, b2, [
      newCard(at(9, 0), at(9, 20), 'merged'),
      newCard(at(9, 20), at(9, 30), 'next', 'Personal')
    ])

    expect(store.cardsForDay('2026-11-17')).toMatchObject([
      { title: 'Processing failed', category: 'System', summary: 'Rate limited. Your recording is saved.', batchId: b1 },
      { title: 'merged', start: at(9, 0), end: at(9, 20), startTime: '9:00 AM', endTime: '9:20 AM', day: '2026-11-17', batchId: b2 },
      { title: 'next', category: 'Personal' }
    ])
  })
})

describe('Store: batch lifecycle and retention', () => {
  it('counts attempts and offers failed batches for retry until they ran out of attempts', () => {
    const a = store.createBatch({ start: 100, end: 400, shotIds: [] })
    const b = store.createBatch({ start: 500, end: 900, shotIds: [] })
    expect(store.pendingBatches().map((x) => x.id)).toEqual([a, b])

    store.startAttempt(a)
    store.finishBatch(a, 'failed', 'Gemini API 503: overloaded')
    store.startAttempt(b)
    store.finishBatch(b, 'completed')

    expect(store.pendingBatches()).toEqual([])
    expect(store.retryableBatches(0, 3)).toMatchObject([{ id: a, attempts: 1, reason: 'Gemini API 503: overloaded' }])
    store.startAttempt(a)
    store.startAttempt(a)
    store.finishBatch(a, 'failed', 'still down')
    expect(store.retryableBatches(0, 3)).toEqual([])
  })

  it('treats batches left processing by a crash as pending again', () => {
    const a = store.createBatch({ start: 100, end: 400, shotIds: [] })
    store.startAttempt(a)
    store.resetInterruptedBatches()
    expect(store.pendingBatches().map((x) => x.id)).toEqual([a])
  })

  it('lists stored frames and deletes them, returning their files', () => {
    const first = shot(100)
    shot(200)
    expect(store.storedFrames()).toEqual([
      { id: first, capturedAt: 100, bytes: 1000 },
      { id: first + 1, capturedAt: 200, bytes: 1000 }
    ])
    expect(store.deleteScreenshots([first])).toEqual(['/frames/100.jpg'])
    expect(store.storedFrames().map((f) => f.id)).toEqual([first + 1])
    expect(store.unbatchedScreenshots(0).map((s) => s.id)).toEqual([first + 1])
  })
})
