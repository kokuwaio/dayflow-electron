// Copy-as-text and Markdown export, in upstream Dayflow's formats
// (Utilities/TimelineClipboardFormatter.swift).

import { parseKey } from './day'
import type { TimelineCard } from './types'
import type { DayCards } from './week'

export interface FormatOptions {
  /** Today's day key, so its heading reads "Today, …". */
  today: string
  /** Locale for dates; the system default when left out. */
  locale?: string
}

/** The product name in exported text; one place to change when the app gets its own name. */
export const PRODUCT_NAME = 'Dayflow Electron'

export function dayHeading(day: string, opts: FormatOptions): string {
  const date = parseKey(day)
  return day === opts.today
    ? `Today, ${date.toLocaleDateString(opts.locale, { month: 'short', day: 'numeric' })}`
    : date.toLocaleDateString(opts.locale, { weekday: 'long', month: 'short', day: 'numeric' })
}

const cleanLines = (text: string) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

/** "Label: text", or the label alone followed by the lines indented by `indent`. */
function field(label: string, text: string, prefix: string, indent: string): string[] {
  const lines = cleanLines(text)
  if (lines.length === 0) return []
  if (lines.length === 1) return [`${prefix}${label}: ${lines[0]}`]
  return [`${prefix}${label}:`, ...lines.map((l) => `${indent}${l}`)]
}

const details = (c: TimelineCard) => (c.detailedSummary.trim() === c.summary.trim() ? '' : c.detailedSummary)

const byStart = (cards: TimelineCard[]) => [...cards].sort((a, b) => a.start - b.start || a.title.localeCompare(b.title))

function textEntry(c: TimelineCard, n: number): string {
  return [
    `${n}. ${c.startTime} – ${c.endTime}: ${c.title}`,
    `   ${c.category}`,
    ...field('Summary', c.summary, '   ', '      '),
    ...field('Details', details(c), '   ', '      ')
  ].join('\n')
}

export function timelineText(day: string, cards: TimelineCard[], opts: FormatOptions): string {
  const header = `${PRODUCT_NAME} timeline · ${dayHeading(day, opts)}`
  if (cards.length === 0) return `${header}\n\nNo timeline activities were recorded for this day.`
  return [header, '', ...byStart(cards).map((c, i) => textEntry(c, i + 1))].join('\n\n')
}

export function weekText(title: string, days: DayCards[], opts: FormatOptions): string {
  const header = `${PRODUCT_NAME} timeline · ${title}`
  const sections = days.filter((d) => d.cards.length > 0)
  if (sections.length === 0) return `${header}\n\nNo timeline activities were recorded for this week.`
  return [
    header,
    '',
    ...sections.flatMap((d) => [dayHeading(d.day, opts), '', ...byStart(d.cards).map((c, i) => textEntry(c, i + 1))])
  ].join('\n\n')
}

function markdownEntry(c: TimelineCard, n: number): string {
  return [
    `${n}. **${c.startTime} – ${c.endTime}: ${c.title}**`,
    `   - _${c.category}_`,
    ...field('Summary', c.summary, '   - ', '      '),
    ...field('Details', details(c), '   - ', '      ')
  ].join('\n')
}

export function dayMarkdown(day: string, cards: TimelineCard[], opts: FormatOptions): string {
  const header = `## ${PRODUCT_NAME} timeline · ${dayHeading(day, opts)}`
  if (cards.length === 0) return `${header}\n\n_No timeline activities were recorded for this day._`
  return [header, '', ...byStart(cards).map((c, i) => markdownEntry(c, i + 1))].join('\n\n')
}

/** Every day of a range, empty ones included, separated by rules. */
export function rangeMarkdown(days: DayCards[], opts: FormatOptions): string {
  return days.map((d) => dayMarkdown(d.day, d.cards, opts)).join('\n\n---\n\n')
}

export const exportFileName = (from: string, to: string) => `${PRODUCT_NAME} timeline ${from} to ${to}.md`
