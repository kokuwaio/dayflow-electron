// Week grid geometry, after upstream Dayflow
// (Views/UI/MainView/WeekTimelineGridView.swift, TimelineShellModels.swift).

import { SYSTEM_CATEGORY } from './categories'
import { parseKey, shiftDay } from './day'
import type { TimelineCard } from './types'

/** A day column of the week view. */
export interface DayCards {
  day: string
  cards: TimelineCard[]
}

export interface Week {
  days: string[]
  title: string
}

/** Pixels per minute: upstream's 111 pt per hour. */
export const PX_PER_MIN = 1.85
export const MIN_CARD_HEIGHT = 16

/** The Monday-to-Sunday week (4 AM days) containing `day`. */
export function weekOf(day: string, locale?: string): Week {
  const weekday = (parseKey(day).getDay() + 6) % 7 // Monday = 0
  const monday = shiftDay(day, -weekday)
  const days = Array.from({ length: 7 }, (_, i) => shiftDay(monday, i))
  const fmt = (d: string) => parseKey(d).toLocaleDateString(locale, { month: 'long', day: 'numeric' })
  return { days, title: `${fmt(days[0]!)} - ${fmt(days[6]!)}` }
}

/** Vertical position and height of a card in its day column (the column starts at 4 AM). */
export function cardBox(card: { start: number; end: number }, day: string): { top: number; height: number } {
  // By the wall clock, like upstream, so DST nights keep cards on their hour lines.
  const start = new Date(card.start * 1000)
  const dayNumber = Math.round((parseKey(dayKeyOf(start)).getTime() - parseKey(day).getTime()) / 86_400_000)
  const startMin = (start.getHours() + dayNumber * 24) * 60 + start.getMinutes() - 4 * 60
  const minutes = (card.end - card.start) / 60
  return { top: startMin * PX_PER_MIN + 1, height: Math.max(MIN_CARD_HEIGHT, minutes * PX_PER_MIN - 2) }
}

/**
 * Cards of one column without overlaps: the shorter card keeps its time and
 * the longer one is trimmed; a long card around a short one keeps its bigger
 * side. Repeats until stable (at most 8 passes, like upstream).
 */
export function resolveOverlaps<T extends { start: number; end: number }>(cards: T[]): T[] {
  let list = cards.map((c) => ({ ...c }))
  for (let pass = 0; pass < 8; pass++) {
    list.sort((a, b) => a.start - b.start || a.end - b.end)
    let changed = false
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!
        const b = list[j]!
        if (b.start >= a.end || a.start >= b.end) continue
        const [short, long] = a.end - a.start <= b.end - b.start ? [a, b] : [b, a]
        if (long.start < short.start && long.end > short.end) {
          // The short card sits inside: keep the long card's bigger side (the right one on a tie).
          if (short.start - long.start > long.end - short.end) long.end = short.start
          else long.start = short.end
        } else if (long.start < short.start) {
          long.end = short.start
        } else {
          long.start = short.end
        }
        changed = true
      }
    }
    list = list.filter((c) => c.end > c.start)
    if (!changed) break
  }
  return list.sort((a, b) => a.start - b.start)
}

/** The calendar date (not the 4 AM day) of a moment, as a key. */
function dayKeyOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Joins "Processing failed" cards less than a minute apart into one (upstream resolveDisplaySegments). */
export function mergeFailed<T extends { start: number; end: number; category: string }>(cards: T[]): T[] {
  const out: T[] = []
  for (const c of [...cards].sort((a, b) => a.start - b.start)) {
    const prev = out[out.length - 1]
    if (prev && prev.category === SYSTEM_CATEGORY && c.category === SYSTEM_CATEGORY && c.start - prev.end < 60) {
      out[out.length - 1] = { ...prev, end: Math.max(prev.end, c.end) }
    } else out.push(c)
  }
  return out
}
