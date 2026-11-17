import { formatClock } from '../../shared/day'
import type { AppSites, Distraction } from '../../shared/types'

// Turns the model's reply into validated timeline cards. Follows upstream's
// tolerant parser (AgentCLISupport+Parsing.swift) and output validator
// (ClaudeOutputValidator.swift). Times are Unix seconds.

export interface Span {
  start: number
  end: number
}

export interface ParsedCard extends Span {
  startTime: string
  endTime: string
  category: string
  subcategory: string
  title: string
  summary: string
  detailedSummary: string
  distractions: Distraction[]
  appSites: AppSites
}

export interface ParseContext {
  /** The new batch's window: first frame floored to the minute, last frame + 1 minute. */
  window: Span
  /** Time covered by the previous cards the model was asked to revise. */
  previous: Span[]
  /** Allowed category names; the first is the fallback. */
  categories: string[]
  /** Check durations, gaps and coverage (default true). */
  validate?: boolean
}

export type ParseResult = { ok: true; cards: ParsedCard[] } | { ok: false; issue: string }

const CLOCK = /^(\d{1,2}):(\d{2}) ?([AaPp][Mm])$/

/** Resolves "2:30 PM" to the occurrence nearest to anchor (local time). */
export function resolveClock(label: string, anchor: number): number | null {
  const m = CLOCK.exec(label.trim())
  if (!m) return null
  const hour12 = Number(m[1])
  const minute = Number(m[2])
  if (hour12 < 1 || hour12 > 12 || minute > 59) return null
  const hour = (hour12 % 12) + (m[3]!.toLowerCase() === 'pm' ? 12 : 0)
  const base = new Date(anchor * 1000)
  let best: number | null = null
  for (const offset of [-1, 0, 1]) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + offset, hour, minute)
    const ts = d.getTime() / 1000
    if (best === null || Math.abs(ts - anchor) < Math.abs(best - anchor)) best = ts
  }
  return best
}

function extractCardArray(text: string): unknown[] | null {
  const tryParse = (s: string): unknown[] | null => {
    try {
      const v = JSON.parse(s)
      if (Array.isArray(v)) return v
      if (v && typeof v === 'object' && Array.isArray((v as { cards?: unknown }).cards)) return (v as { cards: unknown[] }).cards
    } catch {
      // not JSON
    }
    return null
  }
  const direct = tryParse(text.trim())
  if (direct) return direct
  const cleaned = text.replace(/```(?:json)?/g, '')
  const end = cleaned.lastIndexOf(']')
  if (end < 0) return null
  // Walk back from the last ']' to its matching '['.
  let depth = 0
  for (let i = end; i >= 0; i--) {
    if (cleaned[i] === ']') depth++
    else if (cleaned[i] === '[' && --depth === 0) return tryParse(cleaned.slice(i, end + 1))
  }
  return null
}

function normalizeCategory(raw: unknown, categories: string[]): string {
  const name = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  const exact = categories.find((c) => c.toLowerCase() === name)
  if (exact) return exact
  const idle = categories.find((c) => c.toLowerCase() === 'idle')
  if (idle && (name === 'idle' || name === 'idle time')) return idle
  return categories[0] ?? 'Work'
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

export function parseCards(text: string, ctx: ParseContext): ParseResult {
  const raw = extractCardArray(text)
  if (!raw) return { ok: false, issue: 'The reply contains no JSON array of cards.' }
  const evidenceStart = Math.min(ctx.window.start, ...ctx.previous.map((p) => p.start))
  const anchor = (evidenceStart + ctx.window.end) / 2

  const cards: ParsedCard[] = []
  for (const [i, item] of raw.entries()) {
    const c = (item ?? {}) as Record<string, unknown>
    const startTime = str(c.startTime ?? c.start)
    const endTime = str(c.endTime ?? c.end)
    const start = resolveClock(startTime, anchor)
    let end = resolveClock(endTime, anchor)
    if (start === null || end === null) {
      return { ok: false, issue: `Card ${i + 1} has a time that is not in "h:mm AM" format: "${startTime}" - "${endTime}".` }
    }
    if (end < start) end += 24 * 3600
    const sites = (c.appSites ?? {}) as Record<string, unknown>
    cards.push({
      start,
      end,
      startTime,
      endTime,
      category: normalizeCategory(c.category, ctx.categories),
      subcategory: str(c.subcategory),
      title: str(c.title).trim() || 'Untitled',
      summary: str(c.summary),
      detailedSummary: str(c.detailedSummary) || str(c.summary),
      distractions: Array.isArray(c.distractions)
        ? c.distractions.map((d) => {
            const o = (d ?? {}) as Record<string, unknown>
            return { startTime: str(o.startTime), endTime: str(o.endTime), title: str(o.title), summary: str(o.summary) }
          })
        : [],
      appSites: {
        ...(str(sites.primary) ? { primary: str(sites.primary) } : {}),
        ...(str(sites.secondary) ? { secondary: str(sites.secondary) } : {})
      }
    })
  }
  if (cards.length === 0) return { ok: false, issue: 'The reply contains no cards.' }
  if (ctx.validate === false) return { ok: true, cards }
  const evidence = mergeSpans([...ctx.previous, ctx.window], TOLERANCE_SEC)
  snapOuterEdges(cards, evidence)
  const issue = validate(cards, evidence)
  return issue ? { ok: false, issue } : { ok: true, cards }
}

const TOLERANCE_SEC = 60
const SNAP_SEC = 120
const MIN_CARD_SEC = 10 * 60
const MAX_CARD_SEC = 60 * 60

const minutes = (sec: number) => Math.round(sec / 60)

function mergeSpans(spans: Span[], tolerance: number): Span[] {
  const sorted = spans.filter((s) => s.end > s.start).sort((a, b) => a.start - b.start)
  const merged: Span[] = []
  for (const s of sorted) {
    const prev = merged[merged.length - 1]
    if (prev && s.start <= prev.end + tolerance) prev.end = Math.max(prev.end, s.end)
    else merged.push({ ...s })
  }
  return merged
}

/** First uncovered stretch of target longer than tolerance, if any. */
function firstHole(target: Span, cover: Span[], tolerance: number): Span | null {
  let cursor = target.start
  for (const s of [...cover].sort((a, b) => a.start - b.start)) {
    if (s.end <= cursor) continue
    if (s.start >= target.end) break
    if (s.start - cursor >= tolerance) return { start: cursor, end: s.start }
    cursor = Math.max(cursor, s.end)
  }
  return target.end - cursor >= tolerance ? { start: cursor, end: target.end } : null
}

/** Moves the first start and last end onto the evidence edges when they are close. */
function snapOuterEdges(cards: ParsedCard[], evidence: Span[]): void {
  const first = cards[0]
  const last = cards[cards.length - 1]
  const edgeStart = evidence[0]?.start
  const edgeEnd = evidence[evidence.length - 1]?.end
  const ok = (c: ParsedCard, start: number, end: number) =>
    end - start <= MAX_CARD_SEC && (c === last || end - start >= MIN_CARD_SEC || c.end - c.start < MIN_CARD_SEC)
  if (first && edgeStart !== undefined && first.start !== edgeStart && Math.abs(first.start - edgeStart) <= SNAP_SEC && ok(first, edgeStart, first.end)) {
    first.start = edgeStart
    first.startTime = formatClock(edgeStart)
  }
  if (last && edgeEnd !== undefined && last.end !== edgeEnd && Math.abs(last.end - edgeEnd) <= SNAP_SEC && ok(last, last.start, edgeEnd)) {
    last.end = edgeEnd
    last.endTime = formatClock(edgeEnd)
  }
}

function validate(cards: ParsedCard[], evidence: Span[]): string | null {
  for (const [i, c] of cards.entries()) {
    const n = i + 1
    const dur = c.end - c.start
    if (dur <= 0 || dur > MAX_CARD_SEC) {
      return `Card ${n} (${c.startTime} - ${c.endTime}) runs ${minutes(dur)} minutes; cards must be 1 to 60 minutes long.`
    }
    if (i < cards.length - 1 && dur < MIN_CARD_SEC) {
      return `Card ${n} (${c.startTime} - ${c.endTime}) is only ${minutes(dur)} minutes; every card except the last must be at least 10 minutes.`
    }
    const prev = cards[i - 1]
    if (prev && c.start < prev.end) {
      return `Cards ${n - 1} and ${n} overlap (${prev.endTime} is after ${c.startTime}).`
    }
  }
  for (let g = 1; g < evidence.length; g++) {
    const gap = { start: evidence[g - 1]!.end, end: evidence[g]!.start }
    const spanning = cards.findIndex((c) => c.start <= gap.start && c.end >= gap.end)
    if (spanning >= 0) {
      return `Card ${spanning + 1} covers the gap from ${formatClock(gap.start)} to ${formatClock(gap.end)}, where nothing was recorded. Keep that gap.`
    }
  }
  for (const [i, c] of cards.entries()) {
    const hole = firstHole(c, evidence, TOLERANCE_SEC)
    if (hole) {
      return `Card ${i + 1} (${c.startTime} - ${c.endTime}) runs past the recorded time: nothing was recorded from ${formatClock(hole.start)} to ${formatClock(hole.end)}.`
    }
  }
  for (const span of evidence) {
    const hole = firstHole(span, cards, TOLERANCE_SEC)
    if (hole) return `The time from ${formatClock(hole.start)} to ${formatClock(hole.end)} is not covered by any card.`
  }
  return null
}
