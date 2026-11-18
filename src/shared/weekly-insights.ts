// Weekly overview, top highlights and application interactions, after upstream
// Dayflow's Core/Weekly/WeeklyOverviewBuilder.swift, WeeklyDashboardBuilder.swift
// (buildHighlights, cardNarrative) and WeeklyDashboardBuilder+Interactions.swift.
// No AI: everything comes from the week's timeline cards.

import { type Category, SYSTEM_CATEGORY } from './categories'
import { DAY_END_MINUTE, DAY_START_MINUTE, clockMinutes } from './day'
import type { TimelineCard } from './types'
import { OTHER_COLOR, add, appOf, categoryName, colorOf, contextShifts, counted, isFullDistraction, minutesOf, normalized } from './weekly'

/** A card in clock minutes (24:00-28:00 for the hours after midnight). */
const clockRange = (c: TimelineCard) => {
  const start = clockMinutes(c.start)
  return { start, end: start + (c.end - c.start) / 60 }
}
const isSystem = (c: TimelineCard) => normalized(c.category) === normalized(SYSTEM_CATEGORY)
const isIdle = (c: TimelineCard, categories: Category[]) =>
  normalized(c.category) === 'idle' || categories.some((k) => k.isIdle && normalized(k.name) === normalized(c.category))
const nameOf = (c: TimelineCard, categories: Category[]) => categoryName(c.category, categories) || 'Uncategorized'

// ---- Overview ("Time distribution", upstream WeeklyOverviewBuilder and WeeklyOverviewSection)

export interface OverviewSegment {
  category: string
  color: string
  /** Clock minutes, clipped to the overview's window. */
  start: number
  end: number
}

export interface OverviewRow {
  day: string
  segments: OverviewSegment[]
  switches: number
  /** Minutes of the day's longest focus stretch. */
  longestFocus: number
}

export interface WeeklyOverview {
  startMinute: number
  endMinute: number
  rows: OverviewRow[]
  legend: Array<{ name: string; color: string }>
  switchTotal: number
  switchAverage: number
  focusMinutes: number
  longestFocus: { day: string; start: number; end: number; minutes: number } | null
  primaryFocus: { name: string; minutes: number; color: string } | null
}

const MAX_LEGEND = 5
/** Upstream merges focus stretches with gaps under 5 minutes, and bar segments of one category 1 minute apart. */
const FOCUS_MERGE_GAP = 5
const SEGMENT_MERGE_GAP = 1

/** Upstream's fixed 9 AM to 6 PM, widened to whole hours when the week has earlier or later cards. */
function overviewWindow(ranges: Array<{ start: number; end: number }>): { start: number; end: number } {
  if (!ranges.length) return { start: 9 * 60, end: 18 * 60 }
  const start = Math.max(DAY_START_MINUTE, Math.min(9 * 60, Math.floor(Math.min(...ranges.map((r) => r.start)) / 60) * 60))
  const end = Math.min(DAY_END_MINUTE, Math.max(18 * 60, Math.ceil(Math.max(...ranges.map((r) => r.end)) / 60) * 60))
  return { start, end }
}

/** Ranges sorted by start, joined when the next one starts less than `gap` minutes after. */
function mergeRanges(ranges: Array<{ start: number; end: number }>, gap: number): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = []
  for (const r of [...ranges].sort((a, b) => a.start - b.start)) {
    const last = out.at(-1)
    if (last && r.start - last.end < gap) last.end = Math.max(last.end, r.end)
    else out.push({ ...r })
  }
  return out
}

/** The week at a glance: each day's cards as bars, context switches and focus totals. `days` run Monday to Sunday. */
export function weeklyOverview(cards: TimelineCard[], categories: Category[], days: string[]): WeeklyOverview {
  const inWeek = cards.filter((c) => days.includes(c.day) && !isSystem(c) && c.end > c.start)
  const order = (name: string) => {
    const i = categories.findIndex((c) => c.name === name)
    return i < 0 ? Number.MAX_SAFE_INTEGER : i
  }
  // Bars and legend keep Idle like upstream; switches and focus leave it out.
  const totals = new Map<string, number>()
  for (const c of inWeek) add(totals, nameOf(c, categories), (c.end - c.start) / 60)
  const byUsage = [...totals].sort((a, b) => b[1] - a[1] || order(a[0]) - order(b[0]) || a[0].localeCompare(b[0])).map(([n]) => n)
  const visible = new Set(byUsage.length > MAX_LEGEND ? byUsage.slice(0, MAX_LEGEND - 1) : byUsage)
  const legend = [...visible]
    .sort((a, b) => order(a) - order(b) || a.localeCompare(b))
    .map((name) => ({ name, color: colorOf(name, categories) }))
  if (byUsage.length > MAX_LEGEND) legend.push({ name: 'Other', color: OTHER_COLOR })

  const window = overviewWindow(inWeek.map(clockRange))
  const shifts = contextShifts(cards, categories, days).days
  const focusCards = counted(inWeek, categories).filter((c) => !isFullDistraction(c))
  let longestFocus: WeeklyOverview['longestFocus'] = null

  const rows = days.map((day, i) => {
    const segments: OverviewSegment[] = []
    const ofDay = inWeek.filter((c) => c.day === day).map((c) => ({ c, ...clockRange(c) }))
    for (const x of ofDay.sort((a, b) => a.start - b.start || a.end - b.end)) {
      const start = Math.max(x.start, window.start)
      const end = Math.min(x.end, window.end)
      if (end <= start) continue
      const name = nameOf(x.c, categories)
      const category = visible.has(name) ? name : 'Other'
      const last = segments.at(-1)
      if (last && last.category === category && start - last.end <= SEGMENT_MERGE_GAP) last.end = Math.max(last.end, end)
      else segments.push({ category, color: category === 'Other' ? OTHER_COLOR : colorOf(name, categories), start, end })
    }
    const stretches = mergeRanges(focusCards.filter((c) => c.day === day).map(clockRange), FOCUS_MERGE_GAP)
    let best = 0
    for (const s of stretches) {
      const minutes = Math.round(s.end - s.start)
      best = Math.max(best, minutes)
      if (minutes > 0 && minutes > (longestFocus?.minutes ?? 0)) longestFocus = { day, start: s.start, end: s.end, minutes }
    }
    return { day, segments, switches: shifts[i]?.shifts ?? 0, longestFocus: best }
  })

  const focusByCategory = new Map<string, number>()
  for (const c of focusCards) add(focusByCategory, nameOf(c, categories), minutesOf(c))
  const primary = [...focusByCategory].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]
  const switchTotal = rows.reduce((n, r) => n + r.switches, 0)
  return {
    startMinute: window.start,
    endMinute: window.end,
    rows,
    legend,
    switchTotal,
    switchAverage: days.length ? Math.round(switchTotal / days.length) : 0,
    focusMinutes: focusCards.reduce((n, c) => n + minutesOf(c), 0),
    longestFocus,
    primaryFocus: primary ? { name: primary[0], minutes: primary[1], color: colorOf(primary[0], categories) } : null
  }
}

/** The overview's tabs (upstream WeeklyOverviewTabStrip). */
export type OverviewTab = 'all' | 'longest' | 'least' | 'most'

/** The days a tab points at, or null for all days. Days without cards never count as "least context shifts". */
export function overviewFocusDays(overview: WeeklyOverview, tab: OverviewTab): string[] | null {
  if (tab === 'all') return null
  if (tab === 'longest') return overview.longestFocus ? [overview.longestFocus.day] : []
  const active = overview.rows.filter((r) => r.segments.length)
  if (!active.length) return []
  const pick = tab === 'least' ? Math.min(...active.map((r) => r.switches)) : Math.max(...active.map((r) => r.switches))
  return active.filter((r) => r.switches === pick).map((r) => r.day)
}

// ---- Top highlights (upstream buildHighlights, cardNarrative)

export interface WeeklyHighlight {
  id: number
  day: string
  minutes: number
  /** The category in capitals, at most 18 characters, and its colour. */
  tag: string
  color: string
  text: string
}

/** `value` cut to `max` characters with "..." like upstream's shortened(). */
function shortened(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(max - 3, 1)).trim()}...`
}

/** Bold, italics and code marks out, lines joined. */
const plain = (text: string) => text.replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ').trim()

/** The first sentence of the first non-empty text, ending at ". ", "! " or "? " so "v2.9" stays whole. */
function firstSentence(values: string[]): string {
  const text = values.map(plain).find(Boolean)
  if (!text) return 'No summary available.'
  return /^.*?[.!?](?=\s|$)/.exec(text)?.[0] ?? `${text}.`
}

/** "Title: first sentence.", or the sentence alone when it already names the title (upstream cardNarrative). */
function narrative(card: TimelineCard, max: number): string {
  const title = shortened(card.title.trim() || 'Untitled', 54)
  // Upstream reads the detailed summary first; ours is a minute-by-minute log, so the summary leads.
  const body = firstSentence([card.summary, card.detailedSummary, card.title])
  if (title === 'Untitled' || body.toLowerCase().includes(title.toLowerCase())) return shortened(body, max)
  return shortened(`${title}: ${body}`, max)
}

/** The week's three longest cards, without Idle, failed and distraction cards. */
export function weeklyHighlights(cards: TimelineCard[], categories: Category[]): WeeklyHighlight[] {
  return counted(cards, categories)
    .filter((c) => !isFullDistraction(c))
    .sort((a, b) => minutesOf(b) - minutesOf(a) || a.start - b.start)
    .slice(0, 3)
    .map((c) => ({ id: c.id, day: c.day, minutes: minutesOf(c), tag: shortened(nameOf(c, categories).toUpperCase(), 18), color: colorOf(nameOf(c, categories), categories), text: narrative(c, 170) }))
}

// ---- Application interactions (upstream buildApplicationInteractions, WeeklyApplicationInteractionsSection)

export type AppKind = 'work' | 'personal' | 'distraction'

export interface InteractionNode {
  id: string
  name: string
  kind: AppKind
  /** Upstream's fixed spot in a 565 × 561 pane, and the circle's diameter. */
  x: number
  y: number
  size: number
  mark: string
  minutes: number
  visits: number
  primary: boolean
  muted: boolean
}

export interface InteractionEdge {
  from: string
  to: string
  kind: AppKind
  count: number
  /** count / the most frequent switch. */
  weight: number
  /** Upstream's bend in pixels of the pane. */
  curve: number
}

export interface PatternApp {
  id: string
  name: string
  initial: string
  color: string
  /** Minutes per visit. */
  average: number
}

export interface WorkPattern {
  from: PatternApp
  to: PatternApp
  perDay: number
  text: string
}

export interface AppInteractions {
  subtitle: string
  nodes: InteractionNode[]
  edges: InteractionEdge[]
  patterns: WorkPattern[]
  /** The work app that leads into distractions, or null when the week had none. */
  rabbitHole: { from: PatternApp; targets: PatternApp[]; average: number } | null
}

const MAX_APPS = 14
const MAX_EDGES = 18
const POSITIONS: Array<[number, number]> = [
  [256.5, 253.3], [106.5, 411.3], [134, 154.3], [220, 136.8], [308.5, 167.8], [342.5, 108.8], [436.1, 142.8],
  [501.5, 255.8], [391.1, 310.8], [391.5, 415.8], [296, 380.3], [62, 304.8], [111, 233.8], [179.5, 343.3]
]
const CURVES = [-42, 24, -55, -22, 52, -14, 30, -30, 18, -62]

/** Upstream's app colours; "x" matches only the app called X, not every name with an x in it. */
const APP_COLORS: Array<[string, string]> = [
  ['chatgpt', '333333'], ['claude', 'D97757'], ['codex', '111111'], ['cursor', '111111'], ['xcode', '4085FD'],
  ['dayflow', 'FF7A2F'], ['figma', 'FF7262'], ['slack', '36C5F0'], ['zoom', '4085FD'], ['meet', '34A853'],
  ['youtube', 'FF0000'], ['reddit', 'FF613C'], ['substack', 'FF6E3E'], ['notion', '111111'], ['linear', '5E6AD2'],
  ['github', '24292F'], ['safari', '2E8BFF'], ['chrome', '4285F4'], ['calendar', 'A29993'], ['mail', '4F8EF7'], ['messages', '38D06E']
]
const FALLBACK_COLORS = ['93BCFF', 'DE9DFC', '6CDACD', 'FFA189', 'FFC6B7', 'BFB6AE']

function appColor(name: string): string {
  const lower = name.toLowerCase()
  if (lower === 'x') return '#111111'
  const hit = APP_COLORS.find(([needle]) => lower.includes(needle))
  if (hit) return `#${hit[1]}`
  let hash = 5381
  for (const byte of new TextEncoder().encode(lower)) hash = ((hash << 5) + hash + byte) | 0
  return `#${FALLBACK_COLORS[Math.abs(hash) % FALLBACK_COLORS.length]}`
}

const DISTRACTION_WORDS = /\b(youtube|reddit|x|twitter|tiktok|netflix|game|games|gaming)\b/
const PERSONAL_WORDS = /personal|shopping|maps|messages|photos|music/

/** Upstream appKind, with whole words for the distraction needles (so "Firefox" is not "x"). */
function cardKind(card: TimelineCard, app: string, category: string): AppKind {
  if (isFullDistraction(card)) return 'distraction'
  const text = `${app} ${category}`.toLowerCase()
  if (DISTRACTION_WORDS.test(text)) return 'distraction'
  if (PERSONAL_WORDS.test(text)) return 'personal'
  return 'work'
}

interface AppTotal {
  id: string
  name: string
  kind: AppKind
  minutes: number
  visits: number
}

const patternApp = (a: AppTotal): PatternApp => ({
  id: a.id,
  name: a.name,
  initial: a.name.trim().charAt(0).toUpperCase() || '-',
  color: appColor(a.name),
  average: Math.max(1, Math.round(a.minutes / Math.max(a.visits, 1)))
})

const edgeKind = (a: AppKind, b: AppKind): AppKind => (a === 'distraction' || b === 'distraction' ? 'distraction' : a === 'personal' || b === 'personal' ? 'personal' : 'work')

/** Which apps the week moved between, its most common work patterns and its distraction detours. */
export function appInteractions(cards: TimelineCard[], categories: Category[]): AppInteractions {
  const facts = counted(cards, categories)
    .map((c) => ({ c, app: appOf(c) }))
    .filter((f) => f.app !== 'Other' && minutesOf(f.c) > 0)
  if (!facts.length) return { subtitle: 'No recorded app interactions for this week yet.', nodes: [], edges: [], patterns: [], rabbitHole: null }

  const apps = new Map<string, AppTotal & { byKind: Map<AppKind, number> }>()
  for (const { c, app } of facts) {
    const id = normalized(app)
    const total = apps.get(id) ?? { id, name: app, kind: 'work' as AppKind, minutes: 0, visits: 0, byKind: new Map<AppKind, number>() }
    total.minutes += minutesOf(c)
    total.visits += 1
    add(total.byKind as Map<string, number>, cardKind(c, app, nameOf(c, categories)), minutesOf(c))
    apps.set(id, total)
  }
  // An app is what most of its time was; ties lean towards distraction, then personal (upstream's order).
  for (const a of apps.values()) {
    a.kind = (['distraction', 'personal', 'work'] as AppKind[]).reduce((best, k) => ((a.byKind.get(k) ?? 0) > (a.byKind.get(best) ?? 0) ? k : best), 'distraction')
  }
  const sorted = [...apps.values()].sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name))
  const shown = sorted.slice(0, MAX_APPS)
  const byId = new Map(shown.map((a) => [a.id, a]))
  const maxMinutes = Math.max(1, ...shown.map((a) => a.minutes))
  const nodes: InteractionNode[] = shown.map((a, i) => {
    const [x, y] = POSITIONS[i % POSITIONS.length]!
    return {
      id: a.id,
      name: a.name,
      kind: a.kind,
      x,
      y,
      size: i === 0 ? 76 : Math.round(30 + Math.sqrt(a.minutes / maxMinutes) * 28),
      mark: a.name.trim().charAt(0).toUpperCase() || '-',
      minutes: a.minutes,
      visits: a.visits,
      primary: i === 0,
      muted: i > 5
    }
  })

  // Switches between consecutive shown apps within a day.
  const counts = new Map<string, number>()
  const days = [...new Set(facts.map((f) => f.c.day))]
  for (const day of days) {
    let previous: string | null = null
    for (const f of facts.filter((x) => x.c.day === day).sort((a, b) => a.c.start - b.c.start)) {
      const id = normalized(f.app)
      if (!byId.has(id)) continue
      if (previous && previous !== id) add(counts, `${previous}|${id}`, 1)
      previous = id
    }
  }
  const transitions = [...counts]
    .map(([key, count]) => {
      const [from, to] = key.split('|') as [string, string]
      return { from, to, count }
    })
    .sort((a, b) => b.count - a.count || `${a.from}-${a.to}`.localeCompare(`${b.from}-${b.to}`))
  const maxCount = Math.max(1, ...transitions.map((t) => t.count))
  const edges = transitions.slice(0, MAX_EDGES).map((t, i) => ({
    from: t.from,
    to: t.to,
    kind: edgeKind(byId.get(t.from)!.kind, byId.get(t.to)!.kind),
    count: t.count,
    weight: t.count / maxCount,
    curve: CURVES[i % CURVES.length]!
  }))

  const patterns = transitions
    .filter((t) => byId.get(t.from)!.kind !== 'distraction' && byId.get(t.to)!.kind !== 'distraction')
    .slice(0, 2)
    .map((t) => {
      const from = byId.get(t.from)!
      const to = byId.get(t.to)!
      const perDay = Math.max(1, Math.round(t.count / days.length))
      return { from: patternApp(from), to: patternApp(to), perDay, text: `Moves from ${from.name} to ${to.name} an average of ${perDay} ${perDay === 1 ? 'time' : 'times'} per active day.` }
    })

  const detours = transitions.filter((t) => byId.get(t.from)!.kind !== 'distraction' && byId.get(t.to)!.kind === 'distraction')
  const source = detours[0] ? byId.get(detours[0].from)! : shown[0]!
  const targets = detours[0]
    ? detours.filter((t) => t.from === source.id).map((t) => byId.get(t.to)!).slice(0, 4)
    : shown.filter((a) => a.kind === 'distraction').slice(0, 4)
  const visits = targets.reduce((n, a) => n + a.visits, 0)
  const rabbitHole = targets.length
    ? { from: patternApp(source), targets: targets.map(patternApp), average: Math.max(1, Math.round(targets.reduce((n, a) => n + a.minutes, 0) / Math.max(visits, 1))) }
    : null

  const total = facts.reduce((n, f) => n + minutesOf(f.c), 0)
  const coverage = Math.round((shown.reduce((n, a) => n + a.minutes, 0) / Math.max(total, 1)) * 100)
  return { subtitle: `About ${coverage}% of recorded app time was spent using these applications.`, nodes, edges, patterns, rabbitHole }
}
