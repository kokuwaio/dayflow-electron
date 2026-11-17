import { describe, expect, it } from 'vitest'
import { DEFAULT_CATEGORIES } from './categories'
import { accessProgress, parseRecap, pickSourceDay, standupText, workflowGrid } from './daily'
import type { TimelineCard } from './types'

const at = (h: number, m = 0, s = 0) => new Date(2026, 10, 17, h, m, s).getTime() / 1000
let id = 0
const card = (start: number, end: number, category: string, extra: Partial<TimelineCard> = {}): TimelineCard => ({
  id: ++id, batchId: 1, startTime: '', endTime: '', start, end, day: '2026-11-17', title: `${category} work`, summary: '',
  category, subcategory: '', detailedSummary: '', distractions: [], appSites: {}, ...extra
})

describe('accessProgress (upstream Core/Access)', () => {
  it('unlocks Daily at 5 h, Chat at 10 h and Weekly at 30 h of analyzed batches', () => {
    expect(accessProgress(13)).toEqual({
      daily: { unlocked: false, label: '3h 15m / 5h' },
      chat: { unlocked: false, label: '3h 15m / 10h' },
      weekly: { unlocked: false, label: '3h 15m / 30h' }
    })
    expect(accessProgress(40)).toMatchObject({ daily: { unlocked: true, label: '5h / 5h' }, chat: { unlocked: true } })
  })
})

describe('pickSourceDay', () => {
  const minutes: Record<string, number> = { '2026-11-16': 60, '2026-11-15': 200, '2026-11-14': 300 }
  it('takes the first of the last three days with enough activity that no other standup used', () => {
    expect(pickSourceDay('2026-11-17', (d) => minutes[d] ?? 0, new Set(), 120)).toBe('2026-11-15')
    expect(pickSourceDay('2026-11-17', (d) => minutes[d] ?? 0, new Set(['2026-11-15']), 120)).toBe('2026-11-14')
    expect(pickSourceDay('2026-11-17', (d) => minutes[d] ?? 0, new Set(), 400)).toBeNull()
  })
})

describe('parseRecap', () => {
  it('reads done and next from the JSON, deduplicating and keeping at most five highlights', () => {
    const reply = 'thinking...---END_THINKING---```json\n' +
      JSON.stringify({ done: ['Fixed the webhook bug.', ' Fixed the webhook bug. ', 'null', 'A', 'B', 'C', 'D', 'E'], next: 'Send the agreement.' }) + '\n```'
    expect(parseRecap(reply)).toEqual({ highlights: ['Fixed the webhook bug.', 'A', 'B', 'C', 'D'], next: 'Send the agreement.' })
  })

  it('treats a null next as no task and rejects answers with nothing in them', () => {
    expect(parseRecap('{"done":["Shipped it."],"next":null}')).toEqual({ highlights: ['Shipped it.'], next: null })
    expect(() => parseRecap('{"done":[],"next":null}')).toThrow(/empty/i)
    expect(() => parseRecap('I cannot help')).toThrow()
  })
})

describe('standupText (upstream copy format)', () => {
  it('lists each section with its items, or "None right now"', () => {
    expect(
      standupText({ highlightsTitle: 'Yesterday', highlights: ['Shipped the export.'], tasksTitle: 'Today', tasks: [], blockersTitle: 'Blockers', blockersBody: 'Waiting on review' })
    ).toBe('Yesterday\n- Shipped the export.\n\nToday\n- None right now\n\nBlockers\n- Waiting on review')
  })
})

describe('workflowGrid (upstream DailyWorkflowComputation)', () => {
  it('starts at the first card\'s hour, spans at least 12 hours in 15-minute slots and fills slots by overlap', () => {
    const grid = workflowGrid([card(at(10, 0), at(10, 30), 'Work'), card(at(10, 30), at(10, 37, 30), 'Personal')], DEFAULT_CATEGORIES)
    expect(grid.startMinute).toBe(10 * 60) // minutes since midnight
    expect(grid.slots).toBe(48)
    const work = grid.rows.find((r) => r.category === 'Work')!
    expect(work.cells.slice(0, 3)).toEqual([1, 1, 0])
    expect(grid.rows.find((r) => r.category === 'Personal')!.cells[2]).toBe(0.5)
    expect(grid.totals).toEqual([{ category: 'Work', minutes: 30 }, { category: 'Personal', minutes: 7 }])
  })

  it('shows 9 AM to 9 PM when there are no cards', () => {
    expect(workflowGrid([], DEFAULT_CATEGORIES)).toMatchObject({ startMinute: 9 * 60, slots: 48, totals: [] })
  })

  it('collects distraction markers from Distraction cards and card distractions, merging close ones', () => {
    const grid = workflowGrid(
      [
        card(at(11, 0), at(11, 30), 'Work', { distractions: [{ startTime: '11:10 AM', endTime: '11:12 AM', title: 'X feed', summary: '' }] }),
        card(at(11, 13), at(11, 20), 'Distraction', { title: 'YouTube' })
      ],
      DEFAULT_CATEGORIES
    )
    expect(grid.distractions).toEqual([{ start: 11 * 60 + 10, end: 11 * 60 + 20, title: 'X feed, YouTube' }])
  })
})
