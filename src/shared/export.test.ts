import { describe, expect, it } from 'vitest'
import { dayHeading, exportFileName, rangeMarkdown, timelineText, weekText } from './export'
import type { TimelineCard } from './types'

let order = 0
const card = (startTime: string, endTime: string, title: string, summary: string, detailedSummary: string, category = 'Work'): TimelineCard => ({
  id: ++order, batchId: 1, startTime, endTime, start: order * 60, end: order * 60 + 30, day: '2026-11-17', title, summary, category, subcategory: '',
  detailedSummary, distractions: [], appSites: {}
})

const opts = { today: '2026-11-17', locale: 'en-US' }
const cards = [
  card('9:00 AM', '9:45 AM', 'Fixed the login bug', 'Debugged OAuth.', '9:00 AM - 9:20 AM: read logs\n\n  9:20 AM - 9:45 AM: patched the callback  '),
  card('9:45 AM', '10:00 AM', 'Answered mail', 'Cleared the inbox.', 'Cleared the inbox.', 'Communication')
]

describe('copy and export formats (upstream TimelineClipboardFormatter)', () => {
  it('names today and other days like upstream', () => {
    expect(dayHeading('2026-11-17', opts)).toBe('Today, Nov 17')
    expect(dayHeading('2026-11-16', opts)).toBe('Monday, Nov 16')
  })

  it('copies a day as numbered plain text, leaving out details equal to the summary', () => {
    expect(timelineText('2026-11-17', cards, opts)).toBe(
      [
        'Dayflow Electron timeline · Today, Nov 17',
        '',
        '',
        '',
        '1. 9:00 AM – 9:45 AM: Fixed the login bug',
        '   Work',
        '   Summary: Debugged OAuth.',
        '   Details:',
        '      9:00 AM - 9:20 AM: read logs',
        '      9:20 AM - 9:45 AM: patched the callback',
        '',
        '2. 9:45 AM – 10:00 AM: Answered mail',
        '   Communication',
        '   Summary: Cleared the inbox.'
      ].join('\n')
    )
  })

  it('says so when a day has no cards', () => {
    expect(timelineText('2026-11-16', [], opts)).toBe('Dayflow Electron timeline · Monday, Nov 16\n\nNo timeline activities were recorded for this day.')
  })

  it('copies a week with a section per day and numbering per day', () => {
    const text = weekText('Nov 16 - Nov 22', [{ day: '2026-11-16', cards: [] }, { day: '2026-11-17', cards }], opts)
    expect(text.startsWith('Dayflow Electron timeline · Nov 16 - Nov 22\n\n\n\nToday, Nov 17\n\n\n\n1. 9:00 AM')).toBe(true)
    expect(text).toContain('\n\n2. 9:45 AM – 10:00 AM: Answered mail')
    expect(text).not.toContain('Monday')
  })

  it('exports a date range as Markdown, one section per day', () => {
    const md = rangeMarkdown([{ day: '2026-11-16', cards: [] }, { day: '2026-11-17', cards: cards.slice(1) }], opts)
    expect(md).toBe(
      [
        '## Dayflow Electron timeline · Monday, Nov 16',
        '',
        '_No timeline activities were recorded for this day._',
        '',
        '---',
        '',
        '## Dayflow Electron timeline · Today, Nov 17',
        '',
        '',
        '',
        '1. **9:45 AM – 10:00 AM: Answered mail**',
        '   - _Communication_',
        '   - Summary: Cleared the inbox.'
      ].join('\n')
    )
    expect(exportFileName('2026-11-16', '2026-11-17')).toBe('Dayflow Electron timeline 2026-11-16 to 2026-11-17.md')
  })
})
