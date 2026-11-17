// The chat's two read-only tools, after upstream Dayflow
// (Core/AI/GeminiDirectProvider+DashboardTools.swift): the model asks for
// timeline cards or observations of a day or a date range and gets JSON back.

import { dayKey, dayRange, formatClock, parseKey } from '../../shared/day'
import type { TimelineCard } from '../../shared/types'
import type { Observation } from '../analysis/observations'
import type { ToolSpec } from '../providers/types'

/** Above this, detailed summaries are left out (upstream dashboardChatTimelinePayloadSoftLimitBytes). */
const TIMELINE_SOFT_LIMIT_BYTES = 800_000

/** Upstream's declarations, as provider-neutral JSON Schema. */
export const CHAT_TOOLS: ToolSpec[] = [
  {
    name: 'fetchTimeline',
    description:
      'Fetch timeline cards for a single day or date range. Returns structured JSON cards including day, time range, title, summary, category, and optional detailed summaries.',
    parameters: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Single day in YYYY-MM-DD format.' },
        startDate: { type: 'string', description: 'Range start date in YYYY-MM-DD.' },
        endDate: { type: 'string', description: 'Range end date in YYYY-MM-DD.' },
        includeDetailedSummary: { type: 'boolean', description: 'When true (default), include detailedSummary. Set false for very large windows.' },
        limit: { type: 'number', description: 'Optional row cap. If omitted, returns all matching rows.' }
      }
    }
  },
  {
    name: 'fetchObservations',
    description:
      "Fetch raw observations for a single day or date range. Returns structured JSON grouped by day, with each day's observations ordered chronologically.",
    parameters: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Single day in YYYY-MM-DD format.' },
        startDate: { type: 'string', description: 'Range start date in YYYY-MM-DD.' },
        endDate: { type: 'string', description: 'Range end date in YYYY-MM-DD.' },
        limit: { type: 'number', description: 'Optional row cap. If omitted, returns all matching rows.' }
      }
    }
  }
]

/** What the tools read; the store provides it, tests fake it. */
export interface ChatData {
  cardsBetween(from: number, to: number): TimelineCard[]
  observationsBetween(from: number, to: number): Observation[]
}

export type ToolResult = Record<string, unknown> & { summary: string }

class ToolArgError extends Error {}

const stringArg = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

function boolArg(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  if (typeof v === 'string') {
    const s = v.toLowerCase()
    if (['true', '1', 'yes'].includes(s)) return true
    if (['false', '0', 'no'].includes(s)) return false
  }
  return null
}

function positiveIntArg(v: unknown): number | null {
  const n = typeof v === 'number' ? Math.trunc(v) : typeof v === 'string' && /^\s*-?\d+\s*$/.test(v) ? Number(v) : NaN
  return Number.isFinite(n) && n > 0 ? n : null
}

/** A real calendar day in YYYY-MM-DD, or a validation error. */
function checkedDay(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || dayKey(parseKey(value).getTime() / 1000 + 12 * 3600) !== value) {
    throw new ToolArgError(`Invalid date format '${value}'. Use YYYY-MM-DD.`)
  }
  return value
}

interface DateRequest {
  mode: 'date' | 'range'
  date: string | null
  startDate: string | null
  endDate: string | null
  from: number
  to: number
}

function dateRequest(args: Record<string, unknown>): DateRequest {
  const date = stringArg(args.date)
  const startDate = stringArg(args.startDate)
  const endDate = stringArg(args.endDate)
  if (date) {
    if (startDate || endDate) throw new ToolArgError('Provide either {date} OR {startDate, endDate}.')
    const { start, end } = dayRange(checkedDay(date))
    return { mode: 'date', date, startDate: null, endDate: null, from: start, to: end }
  }
  if (!startDate || !endDate) throw new ToolArgError('Provide either {date} OR {startDate, endDate}.')
  const from = dayRange(checkedDay(startDate)).start
  const last = dayRange(checkedDay(endDate))
  if (from > last.start) throw new ToolArgError('startDate must be less than or equal to endDate.')
  return { mode: 'range', date: null, startDate, endDate, from, to: last.end }
}

const singleDay = (day: string) => parseKey(day).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
const rangeDay = (day: string) => parseKey(day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

function describeDates(r: DateRequest): string {
  if (r.mode === 'date' && r.date) return singleDay(r.date)
  const from = rangeDay(r.startDate!)
  const to = rangeDay(r.endDate!)
  return from === to ? from : `${from} to ${to}`
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

function fetchTimeline(args: Record<string, unknown>, data: ChatData): ToolResult {
  const detailed = boolArg(args.includeDetailedSummary) ?? true
  const limit = positiveIntArg(args.limit)
  const request = dateRequest(args)
  const cards = data.cardsBetween(request.from, request.to)
  let items: Array<Record<string, unknown>> = (limit ? cards.slice(0, limit) : cards).map((c) => ({
    day: c.day,
    startTime: c.startTime,
    endTime: c.endTime,
    title: c.title,
    summary: c.summary,
    category: c.category,
    subcategory: c.subcategory,
    distractionsCount: c.distractions.length,
    appSites: { primary: c.appSites.primary ?? null, secondary: c.appSites.secondary ?? null },
    ...(detailed && c.detailedSummary ? { detailedSummary: c.detailedSummary } : {})
  }))
  let truncated = false
  if (detailed && Buffer.byteLength(JSON.stringify(items)) > TIMELINE_SOFT_LIMIT_BYTES) {
    truncated = true
    items = items.map(({ detailedSummary: _drop, ...rest }) => rest)
  }
  let summary = `Fetched ${plural(items.length, 'timeline card')} for ${describeDates(request)}.`
  if (truncated) summary += ' Detailed summaries were omitted due to payload size.'
  return {
    request: { mode: request.mode, date: request.date, startDate: request.startDate, endDate: request.endDate, includeDetailedSummary: detailed, limit },
    summary,
    itemCount: items.length,
    truncated,
    items
  }
}

function fetchObservations(args: Record<string, unknown>, data: ChatData): ToolResult {
  const limit = positiveIntArg(args.limit)
  const request = dateRequest(args)
  const all = data.observationsBetween(request.from, request.to)
  const observations = limit ? all.slice(0, limit) : all
  const groups: Array<{ day: string; observations: Array<{ startTime: string; endTime: string; observation: string }> }> = []
  for (const o of observations) {
    const day = dayKey(o.start)
    const item = { startTime: formatClock(o.start), endTime: formatClock(o.end), observation: o.text }
    const last = groups[groups.length - 1]
    if (last?.day === day) last.observations.push(item)
    else groups.push({ day, observations: [item] })
  }
  let summary = `Fetched ${plural(observations.length, 'observation')} for ${describeDates(request)}`
  if (groups.length) summary += ` across ${plural(groups.length, 'day')}`
  return {
    request: { mode: request.mode, date: request.date, startDate: request.startDate, endDate: request.endDate, limit },
    summary: `${summary}.`,
    dayCount: groups.length,
    itemCount: observations.length,
    truncated: false,
    items: groups
  }
}

/** Runs a tool call from the model; problems come back as an error object for the model to read. */
export function runChatTool(name: string, args: Record<string, unknown>, data: ChatData): ToolResult {
  try {
    if (name === 'fetchTimeline') return fetchTimeline(args ?? {}, data)
    if (name === 'fetchObservations') return fetchObservations(args ?? {}, data)
  } catch (err) {
    if (!(err instanceof ToolArgError)) throw err
    return { summary: err.message, error: { code: 'validation_error', message: err.message } }
  }
  const message = `Unknown tool '${name}'.`
  return { summary: message, error: { code: 'unknown_tool', message } }
}
