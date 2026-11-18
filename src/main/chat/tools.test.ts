import { describe, expect, it } from 'vitest'
import { dayRange } from '../../shared/day'
import type { TimelineCard } from '../../shared/types'
import { type ChatData, runChatTool } from './tools'

const at = (day: number, h: number, m = 0) => new Date(2026, 10, day, h, m).getTime() / 1000
const card = (day: number, h: number, extra: Partial<TimelineCard> = {}): TimelineCard => ({
  id: h, batchId: 1, startTime: `${h}:00 AM`, endTime: `${h}:30 AM`, start: at(day, h), end: at(day, h, 30), day: `2026-11-${day}`,
  title: `Card ${h}`, summary: 'S', category: 'Work', subcategory: '', detailedSummary: 'Long text', distractions: [], appSites: { primary: 'github.com' }, ...extra
})

const data = (cards: TimelineCard[], observations: Array<{ start: number; end: number; text: string }> = []): ChatData => ({
  cardsBetween: (from, to) => cards.filter((c) => c.start >= from && c.start < to),
  observationsBetween: (from, to) => observations.filter((o) => o.start >= from && o.start < to)
})

describe('chat tools (upstream GeminiDirectProvider+DashboardTools)', () => {
  it('fetches a day of timeline cards as structured items', () => {
    const result = runChatTool('fetchTimeline', { date: '2026-11-16' }, data([card(16, 9, { distractions: [{ startTime: '9:10 AM', endTime: '9:12 AM', title: 'X', summary: '' }] }), card(17, 9)]))
    expect(result).toEqual({
      request: { mode: 'date', date: '2026-11-16', startDate: null, endDate: null, includeDetailedSummary: true, limit: null },
      summary: 'Fetched 1 timeline card for Mon, Nov 16.',
      itemCount: 1,
      truncated: false,
      items: [
        {
          day: '2026-11-16', startTime: '9:00 AM', endTime: '9:30 AM', title: 'Card 9', summary: 'S', category: 'Work', subcategory: '',
          distractionsCount: 1, appSites: { primary: 'github.com', secondary: null }, detailedSummary: 'Long text'
        }
      ]
    })
  })

  it('fetches a range with a limit and without detailed summaries', () => {
    const result = runChatTool('fetchTimeline', { startDate: '2026-11-16', endDate: '2026-11-17', includeDetailedSummary: 'false', limit: 1 }, data([card(16, 9), card(17, 9)]))
    expect(result).toMatchObject({ summary: 'Fetched 1 timeline card for Nov 16 to Nov 17.', itemCount: 1 })
    expect((result.items as object[])[0]).not.toHaveProperty('detailedSummary')
  })

  it('drops detailed summaries when the answer would be too large', () => {
    const big = card(16, 9, { detailedSummary: 'x'.repeat(900_000) })
    const result = runChatTool('fetchTimeline', { date: '2026-11-16' }, data([big]))
    expect(result).toMatchObject({ truncated: true, summary: 'Fetched 1 timeline card for Mon, Nov 16. Detailed summaries were omitted due to payload size.' })
  })

  it('groups observations by day', () => {
    const { start } = dayRange('2026-11-16')
    const result = runChatTool('fetchObservations', { startDate: '2026-11-16', endDate: '2026-11-17' }, data([], [
      { start: start + 3600, end: start + 3660, text: 'Editing code' },
      { start: start + 86400 + 60, end: start + 86400 + 120, text: 'Reading mail' }
    ]))
    expect(result).toMatchObject({
      summary: 'Fetched 2 observations for Nov 16 to Nov 17 across 2 days.',
      dayCount: 2,
      itemCount: 2,
      items: [
        { day: '2026-11-16', observations: [{ startTime: '5:00 AM', endTime: '5:01 AM', observation: 'Editing code' }] },
        { day: '2026-11-17', observations: [{ startTime: '4:01 AM', endTime: '4:02 AM', observation: 'Reading mail' }] }
      ]
    })
  })

  it('explains bad arguments and unknown tools to the model', () => {
    const none = data([])
    expect(runChatTool('fetchTimeline', { date: '2026-11-16', startDate: '2026-11-15' }, none)).toEqual({
      summary: 'Provide either {date} OR {startDate, endDate}.',
      error: { code: 'validation_error', message: 'Provide either {date} OR {startDate, endDate}.' }
    })
    expect(runChatTool('fetchTimeline', { date: '16.11.2026' }, none)).toMatchObject({ summary: "Invalid date format '16.11.2026'. Use YYYY-MM-DD." })
    expect(runChatTool('fetchTimeline', { startDate: '2026-11-17', endDate: '2026-11-16' }, none)).toMatchObject({ summary: 'startDate must be less than or equal to endDate.' })
    expect(runChatTool('rm', {}, none)).toEqual({ summary: "Unknown tool 'rm'.", error: { code: 'unknown_tool', message: "Unknown tool 'rm'." } })
  })
})
