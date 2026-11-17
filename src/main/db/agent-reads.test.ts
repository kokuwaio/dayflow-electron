import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Store } from './store'

const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime() / 1000
const card = (start: number, end: number, title: string, category = 'Work', summary = '') => ({
  start, end, title, category, subcategory: '', summary, detailedSummary: '', distractions: [], appSites: {}
})

let store: Store
beforeEach(() => {
  store = Store.open(':memory:')
})

describe('reads for the CLI and MCP server', () => {
  it('finds one live card by id', () => {
    const b = store.createBatch({ start: at(17, 9), end: at(17, 10), shotIds: [] })
    store.addCards(b, [card(at(17, 9), at(17, 10), 'Fixed the login bug')])
    const id = store.cardsForDay('2026-11-17')[0]!.id
    expect(store.card(id)?.title).toBe('Fixed the login bug')
    store.deleteCard(id)
    expect(store.card(id)).toBeUndefined()
  })

  it('lists cards overlapping a range, error cards included, oldest first', () => {
    const b = store.createBatch({ start: at(17, 3), end: at(17, 5), shotIds: [] })
    store.addCards(b, [
      card(at(17, 10), at(17, 11), 'Later'),
      card(at(17, 3, 30), at(17, 4, 30), 'Across 4 AM'),
      card(at(16, 9), at(16, 10), 'Day before'),
      card(at(17, 12), at(17, 12, 15), 'Processing failed', 'System')
    ])
    expect(store.cardsOverlapping(at(17, 4), at(18, 4)).map((c) => c.title)).toEqual(['Across 4 AM', 'Later', 'Processing failed'])
  })

  it('searches titles and summaries, newest first, with LIKE wildcards taken literally', () => {
    const b = store.createBatch({ start: at(17, 9), end: at(17, 12), shotIds: [] })
    store.addCards(b, [
      card(at(15, 9), at(15, 10), 'Reviewed PR', 'Work', 'Looked at the 100% coverage change'),
      card(at(17, 9), at(17, 10), 'Wrote docs', 'Work', 'pr template'),
      card(at(16, 9), at(16, 10), 'Lunch')
    ])
    expect(store.searchCards('pr', 50).map((c) => c.title)).toEqual(['Wrote docs', 'Reviewed PR'])
    expect(store.searchCards('100%', 50).map((c) => c.title)).toEqual(['Reviewed PR'])
    expect(store.searchCards('%', 50)).toHaveLength(1)
    expect(store.searchCards('pr', 1).map((c) => c.title)).toEqual(['Wrote docs'])
  })

  it('reports the last capture and the analysis backlog', () => {
    expect(store.captureStatus()).toEqual({ lastCaptureAt: null, pendingBatches: 0, failedBatches: 0 })
    store.insertScreenshot({ capturedAt: at(17, 9), filePath: '/x.jpg', fileSize: 1, idleSeconds: null })
    store.insertScreenshot({ capturedAt: at(17, 9, 5), filePath: '/y.jpg', fileSize: 1, idleSeconds: null })
    store.createBatch({ start: at(17, 9), end: at(17, 9, 15), shotIds: [] })
    const failed = store.createBatch({ start: at(17, 9, 15), end: at(17, 9, 30), shotIds: [] })
    store.finishBatch(failed, 'failed_empty')
    expect(store.captureStatus()).toEqual({ lastCaptureAt: at(17, 9, 5), pendingBatches: 1, failedBatches: 1 })
  })

  it('counts live cards in a category', () => {
    const b = store.createBatch({ start: at(17, 9), end: at(17, 12), shotIds: [] })
    store.addCards(b, [card(at(17, 9), at(17, 10), 'a'), card(at(17, 10), at(17, 11), 'b'), card(at(17, 11), at(17, 12), 'c', 'Personal')])
    expect(store.countCardsInCategory('Work')).toBe(2)
  })
})

describe('read-only open', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dayflow-ro-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('reads the app database but cannot write to it', () => {
    const file = join(dir, 'dayflow.sqlite')
    const writer = Store.open(file)
    const b = writer.createBatch({ start: at(17, 9), end: at(17, 10), shotIds: [] })
    writer.addCards(b, [card(at(17, 9), at(17, 10), 'Fixed the login bug')])

    const reader = Store.openReadOnly(file)
    expect(reader.cardsForDay('2026-11-17').map((c) => c.title)).toEqual(['Fixed the login bug'])
    expect(() => reader.deleteCard(1)).toThrow()
    reader.close()
    writer.close()
  })

  it('does not create a missing database', () => {
    expect(() => Store.openReadOnly(join(dir, 'missing.sqlite'))).toThrow()
  })
})
