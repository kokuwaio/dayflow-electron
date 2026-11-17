// The day summary panel's numbers, after upstream Dayflow
// (Views/Components/DaySummaryStats.swift, Models/DayGoalPlan.swift).

import { type Category, FALLBACK_COLOR, PRIVATE_CATEGORY, SYSTEM_CATEGORY } from './categories'
import { dayRange } from './day'
import type { TimelineCard } from './types'

export interface GoalPlan {
  focusTargetMinutes: number
  distractionLimitMinutes: number
  /** Category names counted as focus. */
  focusCategories: string[]
  /** Category names counted as distraction. */
  distractionCategories: string[]
  /** The user chose not to set goals for this day. */
  skipped: boolean
}

const isDistractionName = (name: string) => ['distraction', 'distractions'].includes(name.trim().toLowerCase())

/** Upstream's default plan: 4.5 h focus, 2 h distraction budget. */
export function defaultGoalPlan(categories: Category[]): GoalPlan {
  const regular = categories.filter((c) => !c.isIdle)
  return {
    focusTargetMinutes: 270,
    distractionLimitMinutes: 120,
    focusCategories: regular.filter((c) => !isDistractionName(c.name)).map((c) => c.name),
    distractionCategories: regular.filter((c) => isDistractionName(c.name)).map((c) => c.name),
    skipped: false
  }
}

export interface CategoryTotal {
  category: string
  minutes: number
  color: string
}

export interface DaySummary {
  totals: CategoryTotal[]
  capturedMinutes: number
  focusMinutes: number
  distractedMinutes: number
  longestFocusMinutes: number
  /** Where the longest focus block lies (Unix seconds), or null without focus time. */
  longestFocus: { start: number; end: number } | null
}

type Interval = { start: number; end: number; category: string }

/**
 * Cards without the time they share with earlier cards, so each minute counts
 * once (sorted by start; at equal starts the longer card wins).
 */
function deOverlap(cards: TimelineCard[]): Interval[] {
  const sorted = [...cards].sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start) || a.id - b.id)
  const out: Interval[] = []
  let coveredUntil = -Infinity
  for (const c of sorted) {
    const start = Math.max(c.start, coveredUntil)
    if (c.end > start) out.push({ start, end: c.end, category: c.category })
    coveredUntil = Math.max(coveredUntil, c.end)
  }
  return out
}

const FOCUS_GAP_SEC = 5 * 60

/** Category names compared like upstream: trimmed, any case. */
const key = (name: string) => name.trim().toLowerCase()

/**
 * The day's numbers. Idle, System (failed) and Private (blocked app) time is
 * left out: nothing is known about what happened then. With `day`, cards are
 * clipped to its 4 AM to 4 AM window.
 */
export function summarizeDay(cards: TimelineCard[], categories: Category[], plan: GoalPlan, day?: string): DaySummary {
  const left = new Set([...categories.filter((c) => c.isIdle).map((c) => key(c.name)), key(SYSTEM_CATEGORY), key(PRIVATE_CATEGORY)])
  const window = day ? dayRange(day) : { start: -Infinity, end: Infinity }
  const counted = cards
    .filter((c) => !left.has(key(c.category)))
    .map((c) => ({ ...c, category: categories.find((x) => key(x.name) === key(c.category))?.name ?? c.category.trim(), start: Math.max(c.start, window.start), end: Math.min(c.end, window.end) }))
    .filter((c) => c.end > c.start)
  const intervals = deOverlap(counted)
  const minutes = (list: Interval[]) => Math.floor(list.reduce((sum, i) => sum + (i.end - i.start), 0) / 60)

  const byCategory = new Map<string, number>()
  for (const i of intervals) byCategory.set(i.category, (byCategory.get(i.category) ?? 0) + (i.end - i.start))
  const order = (name: string) => {
    const index = categories.findIndex((c) => c.name === name)
    return index < 0 ? Number.MAX_SAFE_INTEGER : index
  }
  const totals = [...byCategory]
    .map(([category, sec]) => ({ category, minutes: Math.floor(sec / 60), color: categories.find((c) => c.name === category)?.color ?? FALLBACK_COLOR }))
    .filter((t) => t.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes || order(a.category) - order(b.category) || a.category.localeCompare(b.category))

  const inList = (list: string[]) => (i: Interval) => list.some((n) => key(n) === key(i.category))
  const focus = intervals.filter(inList(plan.focusCategories))
  let longest: { start: number; end: number } | null = null
  let block: { start: number; end: number } | null = null
  for (const i of [...focus].sort((a, b) => a.start - b.start)) {
    if (block && i.start - block.end < FOCUS_GAP_SEC) block.end = Math.max(block.end, i.end)
    else block = { start: i.start, end: i.end }
    if (!longest || block.end - block.start > longest.end - longest.start) longest = { ...block }
  }

  return {
    totals,
    capturedMinutes: minutes(intervals),
    focusMinutes: minutes(focus),
    distractedMinutes: minutes(intervals.filter(inList(plan.distractionCategories))),
    longestFocusMinutes: longest ? Math.floor((longest.end - longest.start) / 60) : 0,
    longestFocus: longest
  }
}

/** "2h 15m", "2h", "45m" like upstream's durations. */
export function formatMinutes(total: number): string {
  const h = Math.floor(total / 60)
  const m = Math.floor(total % 60)
  return h && m ? `${h}h ${m}m` : h ? `${h}h` : `${m}m`
}
