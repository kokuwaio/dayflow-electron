// Human output of the `dayflow-electron` CLI, after upstream Dayflow
// (tools/dayflow-cli/Sources/dayflow/Render.swift, main.swift). ANSI styling
// only when stdout is a terminal, so piped output stays clean.

import type { Category } from '../shared/categories'
import { dayKey, formatClock, parseKey } from '../shared/day'
import { formatMinutes } from '../shared/day-summary'
import { standupTitles } from '../shared/daily'
import type { StandupEntry, TimelineCard } from '../shared/types'
import { MAX_RANGE_DAYS_FOR_ACTIVITIES, appsOf, categoryTotals, durationMinutes, timeZone } from './payloads'

export interface Style {
  bold: string
  dim: string
  reset: string
}

export const style = (color: boolean): Style => (color ? { bold: '\x1b[1m', dim: '\x1b[2m', reset: '\x1b[0m' } : { bold: '', dim: '', reset: '' })

/** Word wrap per paragraph (upstream wrap). */
export function wrap(text: string, width: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    let current = ''
    for (const word of paragraph.split(' ').filter(Boolean)) {
      if (!current) current = word
      else if (current.length + 1 + word.length <= width) current += ` ${word}`
      else {
        lines.push(current)
        current = word
      }
    }
    lines.push(current)
  }
  return lines
}

/** "Tuesday, November 17" (upstream "EEEE, MMMM d"). */
const headerDay = (ts: number) => new Date(ts * 1000).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

export type TimelineDetail = 'compact' | 'summary' | 'detailed'

export function renderTimeline(day: string, cards: TimelineCard[], detail: TimelineDetail, s: Style): string[] {
  if (cards.length === 0) return [`No activities recorded for ${day}.`]
  const tracked = cards.reduce((n, c) => n + durationMinutes(c), 0)
  const out = [`${s.bold}${headerDay(parseKey(day).getTime() / 1000)}${s.reset}  ${s.dim}${formatMinutes(tracked)} tracked${s.reset}`, '']
  const idWidth = Math.max(...cards.map((c) => String(c.id).length))
  for (const c of cards) {
    const id = String(c.id).padEnd(idWidth)
    const time = (`${formatClock(c.start)} – ${formatClock(c.end)}`).padEnd(20)
    if (detail === 'compact') {
      out.push(`  ${s.dim}${id}${s.reset}  ${time}  ${c.title.padEnd(44)}  ${c.category}`)
      continue
    }
    out.push(`  ${s.dim}${id}${s.reset}  ${time}  ${s.bold}${c.title}${s.reset}  ${s.dim}${c.category}${s.reset}`)
    const body = detail === 'detailed' && c.detailedSummary ? c.detailedSummary : c.summary
    for (const line of wrap(body, 68)) out.push(`  ${' '.repeat(idWidth)}  ${line}`)
    out.push('')
  }
  if (detail === 'compact') {
    // Upstream lists every category here, failed cards included.
    const totals = new Map<string, number>()
    for (const c of cards) totals.set(c.category, (totals.get(c.category) ?? 0) + durationMinutes(c))
    const parts = [...totals].sort((a, b) => b[1] - a[1]).map(([name, minutes]) => `${name} ${formatMinutes(minutes)}`)
    out.push('', `  ${parts.join(' · ')}`, '', `  ${s.dim}${cards.length} activities · dayflow-electron timeline --summary for descriptions${s.reset}`)
  }
  return out
}

/** "  2026-11-17 9:00 AM   Title   Category" rows for ranges and search results. */
function listRow(c: TimelineCard, s: Style, gap: string): string {
  return `  ${s.dim}${dayKey(c.start)}${gap}${formatClock(c.start).padEnd(9)}${s.reset} ${c.title.padEnd(44)}  ${c.category}`
}

export function renderRangeListing(from: string, to: string, cards: TimelineCard[], s: Style): string[] {
  return [`${s.bold}${cards.length} activities · ${from} → ${to}${s.reset}`, '', ...cards.map((c) => listRow(c, s, ' '))]
}

function bars(totals: Array<{ name: string; minutes: number }>, tracked: number, durationWidth: number, s: Style): string[] {
  const nameWidth = Math.max(0, ...totals.map((t) => t.name.length))
  const max = totals[0]?.minutes || 1
  return totals.map((t) => {
    const bar = '█'.repeat(Math.max(1, Math.floor((t.minutes * 20) / max)))
    const percent = tracked > 0 ? Math.floor((t.minutes * 100) / tracked) : 0
    return `  ${t.name.padEnd(nameWidth)}  ${formatMinutes(t.minutes).padEnd(durationWidth)}  ${s.dim}${bar}${s.reset}  ${percent}%`
  })
}

export function renderRangeAggregate(from: string, to: string, days: number, cards: TimelineCard[], s: Style): string[] {
  const totals = categoryTotals(cards)
  const tracked = totals.reduce((n, t) => n + t.minutes, 0)
  return [
    `${s.bold}${from} → ${to}${s.reset}  ${s.dim}${days} days · ${cards.length} activities · ${formatMinutes(tracked)} tracked${s.reset}`,
    '',
    ...bars(totals, tracked, 9, s),
    '',
    `  ${s.dim}Showing totals — ${days} days is too many to list.${s.reset}`,
    `  ${s.dim}Use a range of ${MAX_RANGE_DAYS_FOR_ACTIVITIES} days or fewer, or --force to list all ${cards.length}.${s.reset}`
  ]
}

export function renderCard(c: TimelineCard, s: Style): string[] {
  const out = [
    `${s.bold}${c.title}${s.reset}`,
    `${s.dim}${headerDay(c.start)} · ${formatClock(c.start)} – ${formatClock(c.end)} · ${formatMinutes(durationMinutes(c))}${s.reset}`
  ]
  let context = c.category
  if (c.subcategory) context += ` › ${c.subcategory}`
  const apps = appsOf(c)
  if (apps.length) context += ` · ${apps.join(', ')}`
  out.push(`${s.dim}${context}${s.reset}`, '')
  if (c.summary) out.push(...wrap(c.summary, 72), '')
  if (c.detailedSummary) out.push(...wrap(c.detailedSummary, 72))
  return out
}

export function renderDaily(day: string, entry: StandupEntry, today: string, s: Style): string[] {
  // Titles from the current date, like the Daily tab, so "Yesterday" never goes stale.
  const titles = standupTitles(day, entry.sourceDay, today)
  const d = entry.draft
  return [
    `${s.bold}${titles.highlights}${s.reset}`,
    ...d.highlights.map((i) => `- ${i}`),
    '',
    `${s.bold}${titles.tasks}${s.reset}`,
    ...d.tasks.map((i) => `- ${i}`),
    '',
    `${s.bold}${titles.blockers}${s.reset}`,
    `- ${d.blockersBody.trim() ? d.blockersBody.trim() : 'None'}`
  ]
}

export function renderWeekly(days: string[], cards: TimelineCard[], categories: Category[], s: Style): string[] {
  const label = (d: string) => parseKey(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '')
  const totals = categoryTotals(cards)
  const tracked = totals.reduce((n, t) => n + t.minutes, 0)
  const idle = (name: string) => name.toLowerCase() === 'idle' || categories.some((c) => c.isIdle && c.name.toLowerCase() === name.toLowerCase())
  const focus = totals.filter((t) => !idle(t.name)).reduce((n, t) => n + t.minutes, 0)
  const out = [
    `${s.bold}${label(days[0]!)} – ${label(days[6]!)}${s.reset}  ${s.dim}Tracked ${formatMinutes(tracked)} · Focus ${formatMinutes(focus)}${s.reset}`,
    ''
  ]
  if (tracked === 0) return [...out, '  Nothing recorded this week.']
  return [...out, ...bars(totals, tracked, 8, s)]
}

export function renderCategories(categories: Category[], s: Style): string[] {
  const width = Math.max(0, ...categories.map((c) => c.name.length))
  return categories.map((c) => `  ■ ${c.name.padEnd(width)}  ${s.dim}${c.color}${s.reset}${c.isIdle ? `  ${s.dim}system${s.reset}` : ''}`)
}

export function renderSearch(text: string, cards: TimelineCard[], s: Style): string[] {
  if (cards.length === 0) return [`No activities matching "${text}".`]
  return [`${cards.length} match${cards.length === 1 ? '' : 'es'}`, '', ...cards.map((c) => listRow(c, s, '  '))]
}

export interface StatusView {
  today: string
  lastCaptureAt: number | null
  pendingBatches: number
  editsEnabled: boolean
  appRunning: boolean
  now: number
}

export function renderStatus(v: StatusView, s: Style): string[] {
  let capture = 'no captures found'
  if (v.lastCaptureAt !== null) {
    const minutes = Math.floor((v.now - v.lastCaptureAt) / 60)
    capture = minutes < 2 ? 'last capture just now' : `last capture ${formatMinutes(minutes)} ago`
  }
  const out = [`  Dayflow Electron · ${capture}`, `  Today: ${v.today} (day starts 4:00 AM, ${timeZone()})`]
  if (v.pendingBatches > 0) out.push(`  Analysis backlog: ${v.pendingBatches} batch${v.pendingBatches === 1 ? '' : 'es'}`)
  out.push(
    v.editsEnabled
      ? `  Edits: on ${s.dim}(${v.appRunning ? 'Dayflow Electron is listening' : 'needs Dayflow Electron running'})${s.reset}`
      : `  Edits: off ${s.dim}(turn on in Settings → MCP / CLI)${s.reset}`
  )
  return out
}
