import { join, sep } from 'node:path'
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
    // Paths as the OS writes them: /new/app/recordings on Linux and macOS, \new\app\recordings on Windows.
    const oldDir = join(sep, 'old', 'app', 'recordings')
    const newDir = join(sep, 'new', 'app', 'recordings')
    const moved = store.insertScreenshot({ capturedAt: 100, filePath: join(oldDir, 'a.jpg'), fileSize: 1, idleSeconds: null })
    const current = store.insertScreenshot({ capturedAt: 110, filePath: join(newDir, 'b.jpg'), fileSize: 1, idleSeconds: null })
    const blocked = store.insertScreenshot({ capturedAt: 120, filePath: '', fileSize: 0, idleSeconds: null, blocked: true })

    expect(store.relocateScreenshots(newDir)).toBe(1)

    const batchId = store.createBatch({ start: 100, end: 120, shotIds: [moved, current, blocked] })
    expect(store.batchScreenshots(batchId).map((s) => s.filePath)).toEqual([join(newDir, 'a.jpg'), join(newDir, 'b.jpg'), ''])
    expect(store.relocateScreenshots(newDir)).toBe(0)
    expect(store.relocateScreenshots(newDir + sep)).toBe(0)
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

describe('Store: chat history', () => {
  it('keeps conversations with their messages in order, newest conversation first', () => {
    const first = store.createConversation({ title: 'What did I do?', provider: 'anthropic', now: 100 })
    store.addChatMessage(first, { role: 'user', content: 'What did I do?', now: 100 })
    store.addChatMessage(first, { role: 'assistant', content: 'You coded.', now: 101 })
    const second = store.createConversation({ title: 'New chat', provider: 'gemini', now: 200 })

    expect(store.conversations().map((c) => c.id)).toEqual([second, first])
    store.addChatMessage(first, { role: 'user', content: 'More?', now: 300 })
    expect(store.conversations()[0]).toMatchObject({ id: first, title: 'What did I do?', provider: 'anthropic', updatedAt: 300 })
    expect(store.chatMessages(first).map((m) => [m.role, m.content])).toEqual([
      ['user', 'What did I do?'],
      ['assistant', 'You coded.'],
      ['user', 'More?']
    ])

    store.deleteConversation(first)
    expect(store.conversations().map((c) => c.id)).toEqual([second])
    expect(store.chatMessages(first)).toEqual([])
  })
})

describe('Store: chat tool data', () => {
  it('lists cards and observations that start in a time range', () => {
    const batchId = store.createBatch({ start: 1000, end: 1900, shotIds: [shot(1000)] })
    const card = (start: number, category = 'Work') => ({
      startTime: '', endTime: '', start, end: start + 300, title: `c${start}`, summary: '', category, subcategory: '', detailedSummary: '', distractions: [], appSites: {}
    })
    store.replaceCards({ start: 1000, end: 1900 }, batchId, [card(1000), card(1300, 'System'), card(1600)])
    store.replaceObservations(batchId, [{ start: 1000, end: 1100, text: 'Editing' }, { start: 2000, end: 2100, text: 'Later' }], 'm')

    expect(store.cardsBetween(1000, 1600).map((c) => c.title)).toEqual(['c1000'])
    expect(store.observationsBetween(900, 1500)).toEqual([{ start: 1000, end: 1100, text: 'Editing' }])
  })
})

describe('Store: card feedback storage', () => {
  it('keeps thumbs ratings out of upstream timeline_review_ratings', () => {
    store.rateRange({ start: 100, end: 200 }, 'up', 'great')
    expect(store.ratings({ start: 0, end: 1000 })).toEqual([{ start: 100, end: 200, rating: 'up', feedback: 'great' }])
    const db = (store as unknown as { db: { prepare(sql: string): { all(): unknown[] } } }).db
    expect(db.prepare('SELECT * FROM timeline_review_ratings').all()).toEqual([])
  })
})

describe('Store: debug snapshot', () => {
  it('returns the newest cards, LLM calls and batches without request or response bodies', () => {
    const first = store.createBatch({ start: 1000, end: 1900, shotIds: [shot(1000)] })
    const second = store.createBatch({ start: 2000, end: 2900, shotIds: [shot(2000)] })
    store.startAttempt(second)
    store.finishBatch(second, 'failed', 'HTTP 503')
    const card = (start: number, title: string) => ({
      startTime: '9:00 AM', endTime: '9:15 AM', start, end: start + 300, title, summary: 's', category: 'Work', subcategory: '', detailedSummary: 'long', distractions: [], appSites: {}
    })
    store.replaceCards({ start: 1000, end: 1900 }, first, [card(1000, 'older'), card(1300, 'newer')])
    store.logLlmCall({ batchId: second, attempt: 1, provider: 'gemini', model: 'm', operation: 'generate', ok: false, latencyMs: 40, httpStatus: 503, error: 'unavailable' })
    store.logLlmCall({ batchId: first, attempt: 2, provider: 'gemini', model: 'm', operation: 'generate', ok: true, latencyMs: 900, responseBody: '[{"title":"secret"}]' })

    const snap = store.debugSnapshot({ cards: 1, llmCalls: 5, batches: 5 })

    expect(snap.cards).toEqual([
      { day: '1969-12-31', startTime: '1:21 AM', endTime: '1:26 AM', title: 'newer', summary: 's', category: 'Work', subcategory: '', createdAt: expect.any(Number) }
    ])
    expect(snap.llmCalls).toEqual([
      { createdAt: expect.any(Number), provider: 'gemini', model: 'm', operation: 'generate', ok: true, latencyMs: 900, httpStatus: null, batchId: first, attempt: 2, error: null },
      { createdAt: expect.any(Number), provider: 'gemini', model: 'm', operation: 'generate', ok: false, latencyMs: 40, httpStatus: 503, batchId: second, attempt: 1, error: 'unavailable' }
    ])
    expect(snap.batches.map((b) => [b.id, b.status, b.reason, b.attempts])).toEqual([
      [second, 'failed', 'HTTP 503', 1],
      [first, 'pending', null, 0]
    ])
    expect(Math.abs(snap.batches[0]!.createdAt! - Date.now() / 1000)).toBeLessThan(60)
  })
})
