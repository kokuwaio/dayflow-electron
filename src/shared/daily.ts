// The Daily tab's pure parts, after upstream Dayflow: access thresholds
// (Core/Access), the workflow grid (Views/UI/DailyWorkflowComputation.swift)
// and the standup (Core/AI/DailyRecap*.swift).

import { type Category, SYSTEM_CATEGORY } from './categories'
import { shiftDay } from './day'
import type { TimelineCard } from './types'

// ---------------------------------------------------------------- access

/** Each analyzed batch counts as 15 minutes of timeline data. */
const BATCH_MINUTES = 15
export const UNLOCK_HOURS = { daily: 5, chat: 10, weekly: 30 } as const
export type Feature = keyof typeof UNLOCK_HOURS

const hm = (minutes: number) => {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h && m ? `${h}h ${m}m` : h ? `${h}h` : `${m}m`
}

export function accessProgress(analyzedBatches: number): Record<Feature, { unlocked: boolean; label: string }> {
  const minutes = analyzedBatches * BATCH_MINUTES
  const entry = (hours: number) => ({
    unlocked: minutes >= hours * 60,
    label: `${minutes === 0 ? '0h' : hm(Math.min(minutes, hours * 60))} / ${hours}h`
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

/** Reads the model's {"done": [...], "next": ...} answer like upstream. */
export function parseRecap(reply: string): { highlights: string[]; next: string | null } {
  const text = (reply.includes('---END_THINKING---') ? reply.slice(reply.lastIndexOf('---END_THINKING---') + 18) : reply).replace(/```(?:json)?/g, '')
  const start = text.indexOf('{')
  if (start < 0) throw new Error('The recap answer contains no JSON object.')
  let depth = 0
  let end = -1
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}' && --depth === 0) {
      end = i
      break
    }
  }
  const obj = JSON.parse(text.slice(start, end + 1)) as { done?: unknown; next?: unknown }
  const seen = new Set<string>()
  const highlights = (Array.isArray(obj.done) ? obj.done : [])
    .map((d) => (typeof d === 'string' ? d.trim() : ''))
    .filter((d) => d && d.toLowerCase() !== 'null' && !seen.has(d) && seen.add(d))
    .slice(0, 5)
  const next = typeof obj.next === 'string' && obj.next.trim() && obj.next.trim().toLowerCase() !== 'null' ? obj.next.trim() : null
  if (highlights.length === 0 && !next) throw new Error('The recap answer is empty.')
  return { highlights, next }
}

/** Copy format (upstream DailyView+Standup.swift): titles, "- item" lines, a blank line between sections. */
export function standupText(d: StandupDraft): string {
  const section = (title: string, items: string[]) =>
    [title, ...(items.length ? items.map((i) => `- ${i}`) : ['- None right now'])].join('\n')
  const blockers = d.blockersBody
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  return [section(d.highlightsTitle, d.highlights), section(d.tasksTitle, d.tasks), section(d.blockersTitle, blockers)].join('\n\n')
}

// ---------------------------------------------------------------- workflow grid

const SLOT = 15
const DISTRACTION_MERGE_MIN = 2

/** Minutes since local midnight; times before 4 AM belong to the evening before. */
function clockMinutes(ts: number): number {
  const d = new Date(ts * 1000)
  const m = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60
  return m < 240 ? m + 1440 : m
}

/** "11:10 AM" relative to a card, in clock minutes. */
function labelMinutes(label: string, near: number): number | null {
  const m = /^(\d{1,2}):(\d{2}) ?([AaPp][Mm])$/.exec(label.trim())
  if (!m) return null
  let minutes = ((Number(m[1]) % 12) + (m[3]!.toLowerCase() === 'pm' ? 12 : 0)) * 60 + Number(m[2])
  if (minutes < 240 && near >= 240 * 2) minutes += 1440
  return minutes
}

export interface WorkflowGrid {
  /** Clock minutes of the first slot. */
  startMinute: number
  slots: number
  rows: Array<{ category: string; color: string; cells: number[] }>
  totals: Array<{ category: string; minutes: number }>
  distractions: Array<{ start: number; end: number; title: string }>
}

export function workflowGrid(cards: TimelineCard[], categories: Category[]): WorkflowGrid {
  const list = cards
    .filter((c) => c.category !== SYSTEM_CATEGORY)
    .map((c) => ({ card: c, start: clockMinutes(c.start), end: clockMinutes(c.start) + (c.end - c.start) / 60 }))
    .sort((a, b) => a.start - b.start)
  const first = list[0]
  const startMinute = first ? Math.floor(first.start / 60) * 60 : 9 * 60
  const lastEnd = Math.max(...list.map((c) => c.end), 0)
  const endMinute = first ? Math.max(startMinute + 720, Math.ceil(lastEnd / 60) * 60) : 21 * 60
  const slots = Math.round((endMinute - startMinute) / SLOT)

  const known = categories.map((c) => c.name)
  const unknown = [...new Set(list.map((c) => c.card.category).filter((n) => !known.includes(n)))].sort()
  const used = new Set(list.map((c) => c.card.category))
  const rowNames = [...known.filter((n) => used.has(n)), ...unknown]
  const rows = rowNames.map((category) => {
    const cells = Array.from({ length: slots }, (_, i) => {
      const from = startMinute + i * SLOT
      const overlap = list
        .filter((c) => c.card.category === category)
        .reduce((sum, c) => sum + Math.max(0, Math.min(c.end, from + SLOT) - Math.max(c.start, from)), 0)
      return Math.min(1, overlap / SLOT)
    })
    return { category, color: categories.find((c) => c.name === category)?.color ?? '#E5E7EB', cells }
  })
  const totals = rowNames
    .map((category) => ({
      category,
      minutes: Math.floor(
        list
          .filter((c) => c.card.category === category)
          .reduce((sum, c) => sum + Math.max(0, Math.min(c.end, endMinute) - Math.max(c.start, startMinute)), 0)
      )
    }))
    .filter((t) => t.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes)

  const marks: Array<{ start: number; end: number; title: string }> = []
  for (const c of list) {
    if (c.card.category.trim().toLowerCase() === 'distraction') marks.push({ start: c.start, end: c.end, title: c.card.title })
    for (const d of c.card.distractions) {
      const s = labelMinutes(d.startTime, c.start)
      const e = labelMinutes(d.endTime, c.start)
      if (s !== null && e !== null && e > s) marks.push({ start: s, end: e, title: d.title })
    }
  }
  marks.sort((a, b) => a.start - b.start)
  const distractions: typeof marks = []
  for (const m of marks) {
    const prev = distractions[distractions.length - 1]
    if (prev && m.start <= prev.end + DISTRACTION_MERGE_MIN) {
      prev.end = Math.max(prev.end, m.end)
      prev.title = `${prev.title}, ${m.title}`
    } else distractions.push({ ...m })
  }
  return { startMinute, slots, rows, totals, distractions }
}
