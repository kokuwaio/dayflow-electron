// The Daily tab's pure parts, after upstream Dayflow: access thresholds
// (Core/Access), the workflow grid (Views/UI/DailyWorkflowComputation.swift)
// and the standup (Core/AI/DailyRecap*.swift).

import { type Category, FALLBACK_COLOR, SYSTEM_CATEGORY } from './categories'
import { clockMinutes, parseKey, shiftDay, slotOverlap } from './day'
import { formatMinutes } from './day-summary'
import { jsonObject } from './json'
import type { TimelineCard } from './types'

// ---------------------------------------------------------------- access

/** Each analyzed batch counts as 15 minutes of timeline data. */
const BATCH_MINUTES = 15
export const UNLOCK_HOURS = { daily: 5, chat: 10, weekly: 30 } as const
export type Feature = keyof typeof UNLOCK_HOURS

export interface FeatureAccess {
  unlocked: boolean
  /** "2h 15m / 5h" */
  label: string
}

export function accessProgress(analyzedBatches: number): Record<Feature, FeatureAccess> {
  const minutes = analyzedBatches * BATCH_MINUTES
  const entry = (hours: number) => ({
    unlocked: minutes >= hours * 60,
    label: `${minutes === 0 ? '0h' : formatMinutes(Math.min(minutes, hours * 60))} / ${hours}h`
  })
  return { daily: entry(UNLOCK_HOURS.daily), chat: entry(UNLOCK_HOURS.chat), weekly: entry(UNLOCK_HOURS.weekly) }
}

// ---------------------------------------------------------------- standup

export interface StandupDraft {
  highlightsTitle: string
  highlights: string[]
  tasksTitle: string
  tasks: string[]
  blockersTitle: string
  blockersBody: string
}

/**
 * The day a standup for `target` summarizes: the first of the three days
 * before it with at least `minMinutes` of cards that no other standup used.
 */
export function pickSourceDay(
  target: string,
  minutesOn: (day: string) => number,
  usedSourceDays: Set<string>,
  minMinutes: number
): string | null {
  for (let back = 1; back <= 3; back++) {
    const day = shiftDay(target, -back)
    if (!usedSourceDays.has(day) && minutesOn(day) >= minMinutes) return day
  }
  return null
}

const END_THINKING = '---END_THINKING---'

/** Reads the model's {"done": [...], "next": ...} answer like upstream. */
export function parseRecap(reply: string): { highlights: string[]; next: string | null } {
  const cut = reply.indexOf(END_THINKING)
  const obj = jsonObject(cut < 0 ? reply : reply.slice(cut + END_THINKING.length))
  if (!obj) throw new Error('The recap answer contains no JSON object.')
  const seen = new Set<string>()
  const highlights = (Array.isArray(obj.done) ? obj.done : [])
    .map((d) => (typeof d === 'string' ? d.trim() : ''))
    .filter((d) => d && d.toLowerCase() !== 'null' && !seen.has(d) && seen.add(d))
    .slice(0, 5)
  const next = typeof obj.next === 'string' && obj.next.trim() && obj.next.trim().toLowerCase() !== 'null' ? obj.next.trim() : null
  if (highlights.length === 0 && !next) throw new Error('The recap answer is empty.')
  return { highlights, next }
}

/** "Today", "Yesterday", a weekday within the last week, else "Nov 12" (upstream standupDayLabelText). */
export function dayLabel(day: string, today: string): string {
  if (day === today) return 'Today'
  if (day === shiftDay(today, -1)) return 'Yesterday'
  const date = parseKey(day)
  for (let back = 2; back <= 6; back++) {
    if (day === shiftDay(today, -back)) return date.toLocaleDateString('en-US', { weekday: 'long' })
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export interface StandupTitles {
  highlights: string
  tasks: string
  blockers: string
}

/** Section titles for the current date, so "Yesterday" never goes stale (upstream standupSectionTitles). */
export function standupTitles(target: string, sourceDay: string | null, today: string): StandupTitles {
  return {
    highlights: sourceDay ? `Highlights from ${dayLabel(sourceDay, today)}` : 'Recent highlights',
    tasks: `Tasks for ${dayLabel(target, today)}`,
    blockers: 'Blockers'
  }
}

/** An empty draft the user can fill in before anything was generated. */
export const emptyStandup = (): StandupDraft => ({
  highlightsTitle: "Yesterday's highlights",
  highlights: [],
  tasksTitle: "Today's tasks",
  tasks: [],
  blockersTitle: 'Blockers',
  blockersBody: ''
})

/** Copy format (upstream standupClipboardText): titles, "- item" lines, a blank line between sections. */
export function standupText(d: StandupDraft, titles: StandupTitles): string {
  const items = (list: string[]) => list.map((i) => i.trim()).filter(Boolean)
  const section = (title: string, list: string[]) => [title, ...(list.length ? list.map((i) => `- ${i}`) : ['- None right now'])].join('\n')
  return [
    section(titles.highlights, items(d.highlights)),
    section(titles.tasks, items(d.tasks)),
    section(titles.blockers, items(d.blockersBody.split('\n')))
  ].join('\n\n')
}

// ---------------------------------------------------------------- workflow grid

const SLOT = 15
const DISTRACTION_MERGE_MIN = 2

/** Minutes since midnight of an "11:10 AM" label; null when it is not one. */
export function parseClockLabel(label: string): number | null {
  const m = /^(\d{1,2}):(\d{2}) ?([AaPp][Mm])$/.exec(label.trim())
  if (!m) return null
  return ((Number(m[1]) % 12) + (m[3]!.toLowerCase() === 'pm' ? 12 : 0)) * 60 + Number(m[2])
}

const distanceTo = (v: number, start: number, end: number) => (v < start ? start - v : v > end ? v - end : 0)

/** The candidate of `raw`, `raw ± 1 day` nearest the parent card (upstream anchoredMinute). */
const anchored = (raw: number, start: number, end: number) =>
  [raw, raw + 1440, raw - 1440].reduce((best, v) => (distanceTo(v, start, end) < distanceTo(best, start, end) ? v : best))

/**
 * A distraction's range inside its card. Labels outside the card collapse to
 * one minute at the nearest edge (upstream normalizedMiniDistractionRange).
 */
export function distractionRange(startLabel: string, endLabel: string, cardStart: number, cardEnd: number): { start: number; end: number } | null {
  const rawStart = parseClockLabel(startLabel)
  const rawEnd = parseClockLabel(endLabel)
  if (rawStart === null || rawEnd === null || cardEnd <= cardStart) return null
  const start = anchored(rawStart, cardStart, cardEnd)
  const end = anchored(rawEnd, cardStart, cardEnd)
  if (end > start && start >= cardStart && end <= cardEnd) return { start, end }
  const collapsedStart = Math.min(Math.max(start, cardStart), Math.max(cardStart, cardEnd - 1))
  const collapsedEnd = Math.min(cardEnd, collapsedStart + 1)
  return collapsedEnd > collapsedStart ? { start: collapsedStart, end: collapsedEnd } : null
}

const isDistractionCategory = (name: string) => ['distraction', 'distractions'].includes(name.trim().toLowerCase())
const categoryKey = (name: string) => name.trim().toLowerCase()

export interface WorkflowGrid {
  /** Clock minutes of the first slot. */
  startMinute: number
  slots: number
  rows: Array<{ category: string; color: string; cells: number[] }>
  totals: Array<{ category: string; minutes: number }>
  distractions: Array<{ start: number; end: number; title: string }>
  /** Whether the user has a Distraction category, so the grid shows its row. */
  hasDistractionRow: boolean
}

/** A row per category but System (upstream DailyWorkflowComputation), in the configured order. */
export function workflowGrid(cards: TimelineCard[], categories: Category[]): WorkflowGrid {
  const list = cards
    .filter((c) => categoryKey(c.category) !== categoryKey(SYSTEM_CATEGORY))
    .map((c) => ({ card: c, key: categoryKey(c.category), start: clockMinutes(c.start), end: clockMinutes(c.start) + (c.end - c.start) / 60 }))
    .sort((a, b) => a.start - b.start)
  const first = list[0]
  const startMinute = first ? Math.floor(first.start / 60) * 60 : 9 * 60
  const lastEnd = Math.max(...list.map((c) => c.end), 0)
  const endMinute = first ? Math.max(startMinute + 720, Math.ceil(lastEnd / 60) * 60) : 21 * 60
  const slots = Math.round((endMinute - startMinute) / SLOT)

  const configured = categories.filter((c) => categoryKey(c.name) !== categoryKey(SYSTEM_CATEGORY))
  const knownKeys = new Set(configured.map((c) => categoryKey(c.name)))
  const unknown = new Map<string, string>()
  for (const c of list) if (!knownKeys.has(c.key) && !unknown.has(c.key)) unknown.set(c.key, c.card.category.trim())
  const rowDefs = [
    ...configured.map((c) => ({ key: categoryKey(c.name), name: c.name, color: c.color })),
    ...[...unknown].sort((a, b) => a[1].localeCompare(b[1])).map(([key, name]) => ({ key, name, color: FALLBACK_COLOR }))
  ]
  const ofKey = (key: string) => list.filter((c) => c.key === key)
  const rows = rowDefs.map((row) => ({
    category: row.name,
    color: row.color,
    cells: Array.from({ length: slots }, (_, i) => {
      const from = startMinute + i * SLOT
      return Math.min(1, ofKey(row.key).reduce((sum, c) => sum + slotOverlap(c.start, c.end, from, SLOT), 0) / SLOT)
    })
  }))
  const totals = rowDefs
    .map((row) => ({
      category: row.name,
      minutes: Math.floor(ofKey(row.key).reduce((sum, c) => sum + slotOverlap(c.start, c.end, startMinute, endMinute - startMinute), 0))
    }))
    .filter((t) => t.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes)

  const marks: Array<{ start: number; end: number; title: string }> = []
  for (const c of list) {
    if (isDistractionCategory(c.card.category)) marks.push({ start: c.start, end: c.end, title: c.card.title })
    for (const d of c.card.distractions) {
      const range = distractionRange(d.startTime, d.endTime, c.start, c.end)
      if (range) marks.push({ ...range, title: d.title })
    }
  }
  marks.sort((a, b) => a.start - b.start)
  const distractions: Array<{ start: number; end: number; titles: string[] }> = []
  for (const m of marks) {
    const prev = distractions[distractions.length - 1]
    if (prev && m.start <= prev.end + DISTRACTION_MERGE_MIN) {
      prev.end = Math.max(prev.end, m.end)
      if (!prev.titles.includes(m.title)) prev.titles.push(m.title)
    } else distractions.push({ start: m.start, end: m.end, titles: [m.title] })
  }
  return {
    startMinute,
    slots,
    rows,
    totals,
    distractions: distractions.map((d) => ({ start: d.start, end: d.end, title: d.titles.join(', ') })),
    hasDistractionRow: categories.some((c) => isDistractionCategory(c.name))
  }
}

/** The distraction overlapping a grid slot, if any. */
export const distractionInSlot = (grid: WorkflowGrid, slot: number) => {
  const from = grid.startMinute + slot * SLOT
  return grid.distractions.find((d) => slotOverlap(d.start, d.end, from, SLOT) > 0)
}
