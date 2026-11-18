// JSON payloads shared by `dayflow-electron --json` and the MCP tools, after upstream
// Dayflow (tools/dayflow-cli/Sources/dayflow/JSONOut.swift, main.swift,
// MCPServer.swift). Keys are snake_case like upstream; every top-level
// object gets schema_version when it is printed.

import { type Category, SYSTEM_CATEGORY } from '../shared/categories'
import { BOUNDARY_HOUR, dayCount, dayRange, pad } from '../shared/day'
import type { StandupEntry, TimelineCard } from '../shared/types'
import { weekOf } from '../shared/week'

export const SCHEMA_VERSION = 1
/** Upstream: ranges longer than this return totals instead of activities. */
export const MAX_RANGE_DAYS_FOR_ACTIVITIES = 7
/** Upstream search limit. */
export const SEARCH_LIMIT = 50

export type Json = Record<string, unknown>

export const durationMinutes = (c: { start: number; end: number }) => Math.max(0, Math.floor((c.end - c.start) / 60))

export const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone


/** Local time with its offset, like upstream's "yyyy-MM-dd'T'HH:mm:ssZZZZZ". */
export function isoLocal(ts: number): string {
  const d = new Date(ts * 1000)
  const offset = -d.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const abs = Math.abs(offset)
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  )
}

/** Apps the card names (upstream reads metadata.appSites). */
export const appsOf = (c: TimelineCard) => [c.appSites.primary, c.appSites.secondary].filter((a): a is string => !!a)

export function activityJson(c: TimelineCard, detailed: boolean): Json {
  const o: Json = {
    record_id: c.id,
    start: isoLocal(c.start),
    end: isoLocal(c.end),
    duration_minutes: durationMinutes(c),
    title: c.title,
    summary: c.summary,
    category: c.category
  }
  if (c.subcategory) o.subcategory = c.subcategory
  const apps = appsOf(c)
  if (apps.length) o.apps = apps
  if (c.distractions.length) o.distraction_count = c.distractions.length
  if (detailed && c.detailedSummary) o.detailed_summary = c.detailedSummary
  return o
}

export function timelineEnvelope(day: string, cards: TimelineCard[], detailed: boolean): Json {
  return {
    date: day,
    time_zone: timeZone(),
    day_boundary_hour: BOUNDARY_HOUR,
    cards: cards.map((c) => activityJson(c, detailed)),
    detail_available: !detailed,
    hint: detailed ? '' : 'Summaries are abbreviated. Use `dayflow-electron card <record_id>` for the full write-up of a specific activity.'
  }
}

/** Minutes per category without failed ("System") cards, biggest first. */
export function categoryTotals(cards: TimelineCard[]): Array<{ name: string; minutes: number }> {
  const totals = new Map<string, number>()
  for (const c of cards) {
    if (c.category === SYSTEM_CATEGORY) continue
    totals.set(c.category, (totals.get(c.category) ?? 0) + durationMinutes(c))
  }
  return [...totals].map(([name, minutes]) => ({ name, minutes })).sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name))
}

const sum = (list: Array<{ minutes: number }>) => list.reduce((n, t) => n + t.minutes, 0)
const shares = (totals: Array<{ name: string; minutes: number }>, tracked: number) =>
  totals.map((t) => ({ name: t.name, minutes: t.minutes, share: tracked > 0 ? t.minutes / tracked : 0 }))

export function rangeListing(from: string, to: string, cards: TimelineCard[], detailed: boolean): Json {
  return { from, to, cards: cards.map((c) => activityJson(c, detailed)) }
}

export function rangeAggregate(from: string, to: string, cards: TimelineCard[]): Json {
  const totals = categoryTotals(cards)
  const tracked = sum(totals)
  return {
    range: { from, to, days: dayCount(from, to) },
    granularity: 'aggregate',
    cards_omitted: cards.length,
    reason: `Range exceeds ${MAX_RANGE_DAYS_FOR_ACTIVITIES} days. Returning totals instead of individual activities.`,
    tracked_minutes: tracked,
    categories: shares(totals, tracked),
    hint: `Request ${MAX_RANGE_DAYS_FOR_ACTIVITIES} days or fewer to get individual activities.`
  }
}

export function timeBreakdown(from: string, to: string, cards: TimelineCard[]): Json {
  const totals = categoryTotals(cards)
  const tracked = sum(totals)
  return {
    range: { from, to },
    tracked_minutes: tracked,
    categories: shares(totals, tracked),
    hint: 'For individual activities, call get_timeline for a specific day.'
  }
}

/** The 4 AM-to-4 AM span of the Monday-to-Sunday week containing `day`. */
export function weekSpan(day: string): { start: number; end: number } {
  const days = weekOf(day).days
  return { start: dayRange(days[0]!).start, end: dayRange(days[6]!).end }
}

const isIdle = (name: string, categories: Category[]) =>
  name.toLowerCase() === 'idle' || categories.some((c) => c.isIdle && c.name.toLowerCase() === name.toLowerCase())

export function weekly(day: string, cards: TimelineCard[], categories: Category[]): Json {
  const span = weekSpan(day)
  const totals = categoryTotals(cards)
  const tracked = sum(totals)
  return {
    week_start: isoLocal(span.start),
    week_end: isoLocal(span.end),
    tracked_minutes: tracked,
    focus_minutes: sum(totals.filter((t) => !isIdle(t.name, categories))),
    categories: shares(totals, tracked)
  }
}

export function daily(day: string, entry: StandupEntry): Json {
  return { date: day, highlights: entry.draft.highlights, tasks: entry.draft.tasks, blockers: entry.draft.blockersBody }
}

export function categoriesJson(categories: Category[]): Json {
  return {
    categories: categories.map((c) => ({
      name: c.name,
      color_hex: c.color,
      description: c.description,
      is_system: !!c.isIdle,
      is_idle: !!c.isIdle
    }))
  }
}

export interface StatusInput {
  today: string
  lastCaptureAt: number | null
  pendingBatches: number
  failedBatches: number
  editsEnabled: boolean
  appRunning: boolean
}

export function status(s: StatusInput): Json {
  const o: Json = {
    today: s.today,
    time_zone: timeZone(),
    day_boundary_hour: BOUNDARY_HOUR,
    pending_batches: s.pendingBatches,
    failed_batches: s.failedBatches,
    edits_enabled: s.editsEnabled,
    app_running: s.appRunning
  }
  if (s.lastCaptureAt !== null) o.last_capture_at = isoLocal(s.lastCaptureAt)
  return o
}

/** JSON with sorted keys (upstream .sortedKeys), so output is stable. */
export function stableJson(value: unknown, pretty = false): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort)
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.keys(v)
          .sort()
          .map((k) => [k, sort((v as Json)[k])])
      )
    }
    return v
  }
  return JSON.stringify(sort(value), null, pretty ? 2 : undefined)
}

export const withSchema = (payload: Json): Json => ({ ...payload, schema_version: SCHEMA_VERSION })
