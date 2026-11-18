// Weekly dashboard numbers, after upstream Dayflow (Core/Weekly/*). No AI:
// everything comes from the week's timeline cards.

import { type Category, FALLBACK_COLOR, SYSTEM_CATEGORY } from './categories'
import { DAY_END_MINUTE, DAY_START_MINUTE, clockMinutes, parseKey, slotOverlap } from './day'
import { parseClockLabel } from './daily'
import type { TimelineCard } from './types'

/** Weeks with less tracked time show a gate instead of charts (upstream: 15 h). */
export const WEEKLY_MIN_TRACKED_MINUTES = 15 * 60
export const OTHER_COLOR = '#BFB6AE'
const DISTRACTION_COLOR = '#FF5950'

/** Whole minutes per card, rounded like upstream. */
export const minutesOf = (c: TimelineCard) => Math.max(0, Math.round((c.end - c.start) / 60))
/** Category and app names match case-insensitively, like upstream's normalized keys. */
export const normalized = (s: string) => s.trim().toLowerCase()

/** Cards that count: everything but Idle and failed ("System") cards. */
export function counted(cards: TimelineCard[], categories: Category[]): TimelineCard[] {
  const idle = new Set(categories.filter((c) => c.isIdle).map((c) => normalized(c.name)))
  return cards.filter((c) => {
    const name = normalized(c.category)
    return !idle.has(name) && name !== normalized(SYSTEM_CATEGORY) && name !== 'idle'
  })
}

/** The category's name as configured, so "work" and "Work" land in one group. */
export const categoryName = (name: string, categories: Category[]) => categories.find((c) => normalized(c.name) === normalized(name))?.name ?? name.trim()
export const colorOf = (name: string, categories: Category[]) => categories.find((c) => normalized(c.name) === normalized(name))?.color ?? FALLBACK_COLOR

/** Adds `minutes` under `name` to a running total. */
export const add = (m: Map<string, number>, name: string, minutes: number) => m.set(name, (m.get(name) ?? 0) + minutes)

export function trackedMinutes(cards: TimelineCard[], categories: Category[]): number {
  return counted(cards, categories).reduce((sum, c) => sum + minutesOf(c), 0)
}

/** Upstream's needles: the first one the app name contains wins. */
const APP_NEEDLES: Array<[string, string]> = [
  ['chatgpt', 'ChatGPT'], ['claude', 'Claude'], ['codex', 'Codex'], ['cursor', 'Cursor'], ['xcode', 'Xcode'],
  ['dayflow', 'Dayflow'], ['figma', 'Figma'], ['slack', 'Slack'], ['zoom', 'Zoom'], ['meet.google', 'Meet'],
  ['google meet', 'Meet'], ['youtube', 'YouTube'], ['reddit', 'Reddit'], ['twitter', 'X'], ['x.com', 'X'],
  ['substack', 'Substack'], ['notion', 'Notion'], ['linear', 'Linear'], ['github', 'GitHub'], ['safari', 'Safari'],
  ['chrome', 'Chrome'], ['calendar', 'Calendar'], ['mail', 'Mail'], ['messages', 'Messages'], ['maps', 'Maps'],
  ['clickup', 'ClickUp'], ['runway', 'Runway'], ['flora', 'Flora']
]
/** Apps upstream looks for in the title and summary when the card names none. */
const FALLBACK_APPS = ['ChatGPT', 'Claude', 'Codex', 'Cursor', 'Xcode', 'Dayflow', 'Figma', 'Slack', 'Zoom', 'YouTube', 'Reddit', 'Substack', 'Notion', 'Linear', 'GitHub', 'Safari', 'Chrome', 'Calendar', 'Mail', 'Messages']

const titleCase = (s: string) => s.split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')

/** The app or site a card was mostly in (upstream prettyAppName). */
export function appOf(card: TimelineCard): string {
  const raw = [card.appSites.primary, card.appSites.secondary].map((s) => s?.trim()).find(Boolean)
  const text = `${card.title} ${card.summary}`.toLowerCase()
  const source = raw ?? FALLBACK_APPS.find((a) => text.includes(a.toLowerCase())) ?? 'Other'
  const lower = source.toLowerCase()
  // "x.com" only as a whole domain, so netflix.com stays Netflix.
  const needle = APP_NEEDLES.find(([n]) => (n === 'x.com' ? /(^|[^a-z0-9-])x\.com\b/.test(lower) : lower.includes(n)))
  if (needle) return needle[1]
  const cleaned = (source.split(/[,;|\n]/)[0] ?? source)
    .replace('https://', '')
    .replace('http://', '')
    .replace('www.', '')
    .replace('com.apple.', '')
    .trim()
  if (cleaned.includes('.') && !cleaned.includes(' ')) return titleCase(cleaned.split('.')[0] ?? cleaned)
  return titleCase(cleaned || 'Other')
}

/** The `max` largest names, or the `max - 1` largest plus an "Other" bucket when there are more (upstream). */
function visibleNames(totals: Map<string, number>, max: number): Set<string> | null {
  const sorted = [...totals].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([n]) => n)
  return sorted.length > max ? new Set(sorted.slice(0, max - 1)) : null
}

export interface DonutItem {
  name: string
  minutes: number
  color: string
}

/** Minutes per category: up to five, otherwise the top four plus "Other". */
export function donutItems(cards: TimelineCard[], categories: Category[]): DonutItem[] {
  const totals = new Map<string, number>()
  for (const c of counted(cards, categories)) add(totals, categoryName(c.category, categories), minutesOf(c))
  const order = (name: string) => {
    const i = categories.findIndex((c) => c.name === name)
    return i < 0 ? 999 : i
  }
  const sorted = [...totals]
    .map(([name, minutes]) => ({ name, minutes, color: colorOf(name, categories) }))
    .filter((i) => i.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes || order(a.name) - order(b.name) || a.name.localeCompare(b.name))
  if (sorted.length <= 5) return sorted
  const rest = sorted.slice(4).reduce((sum, i) => sum + i.minutes, 0)
  return [...sorted.slice(0, 4), { name: 'Other', minutes: rest, color: OTHER_COLOR }]
}

/** Upstream isDistractionCard: the card lists distractions, or its texts talk about being distracted. */
function isDistraction(card: TimelineCard): boolean {
  if (card.distractions.length) return true
  const text = `${card.category} ${card.subcategory} ${card.title} ${card.summary}`.toLowerCase()
  return text.includes('distraction') || text.includes('distracted')
}

/** Distractions in a card: each listed one with a readable start time, else 1 for a distraction card. */
const distractionCount = (card: TimelineCard) =>
  card.distractions.length ? card.distractions.filter((d) => parseClockLabel(d.startTime) !== null).length : isDistraction(card) ? 1 : 0

/** Category changes between consecutive cards and distractions, per day. */
export function contextShifts(cards: TimelineCard[], categories: Category[], days: string[]) {
  const list = counted(cards, categories)
  const perDay = days.map((day) => {
    const ofDay = list.filter((c) => c.day === day).sort((a, b) => a.start - b.start)
    let shifts = 0
    for (let i = 1; i < ofDay.length; i++) if (normalized(ofDay[i]!.category) !== normalized(ofDay[i - 1]!.category)) shifts++
    const distractions = ofDay.reduce((n, c) => n + distractionCount(c), 0)
    return { day, shifts, distractions }
  })
  const busiest = [...perDay].sort((a, b) => b.shifts + b.distractions - (a.shifts + a.distractions))[0]
  const insight =
    !busiest || busiest.shifts + busiest.distractions === 0
      ? 'No context shift or distraction pattern was detected in this week.'
      : `${parseKey(busiest.day).toLocaleDateString('en-US', { weekday: 'long' })} had the most interruptions, with ${busiest.shifts} context shifts and ${busiest.distractions} distractions.`
  return { days: perDay, insight }
}

export interface HeatmapCell {
  category: string | null
  color: string
  occupancy: number
}

const SLOT = 15

/** The week's 15-minute slots per day, colored by the dominant category (upstream Weekly workflow). */
export function workflowHeatmap(cards: TimelineCard[], categories: Category[], days: string[]) {
  const list = counted(cards, categories).map((c) => ({ c, start: clockMinutes(c.start), end: clockMinutes(c.start) + (c.end - c.start) / 60 }))
  const clamp = (m: number) => Math.min(DAY_END_MINUTE, Math.max(DAY_START_MINUTE, m))
  const startMinute = list.length ? clamp(Math.floor((Math.min(...list.map((x) => x.start)) - 30) / SLOT) * SLOT) : 9 * 60
  const endMinute = list.length ? clamp(Math.ceil((Math.max(...list.map((x) => x.end)) + 30) / SLOT) * SLOT) : 22 * 60
  const slots = Math.max(1, Math.round((endMinute - startMinute) / SLOT))
  const rows = days.map((day) => {
    const ofDay = list.filter((x) => x.c.day === day)
    const cells: HeatmapCell[] = Array.from({ length: slots }, (_, i) => {
      const from = startMinute + i * SLOT
      const byCategory = new Map<string, number>()
      for (const x of ofDay) {
        const overlap = slotOverlap(x.start, x.end, from, SLOT)
        if (!overlap) continue
        add(byCategory, normalized(x.c.category).includes('distraction') ? 'Distraction' : categoryName(x.c.category, categories), overlap)
      }
      const top = [...byCategory].sort((a, b) => b[1] - a[1])[0]
      const total = [...byCategory.values()].reduce((a, b) => a + b, 0)
      return top
        ? { category: top[0], color: top[0] === 'Distraction' ? DISTRACTION_COLOR : colorOf(top[0], categories), occupancy: Math.min(1, total / SLOT) }
        : { category: null, color: 'transparent', occupancy: 0 }
    })
    return { day, cells }
  })
  return { startMinute, slots, rows }
}

export interface TreemapCategory {
  category: string
  color: string
  minutes: number
  apps: Array<{ app: string; minutes: number; change: number | null }>
}

/** Most used apps per category (top 5 categories, top 8 apps each), with the change against last week. */
export function treemap(cards: TimelineCard[], previous: TimelineCard[], categories: Category[]): TreemapCategory[] {
  const tally = (list: TimelineCard[]) => {
    const m = new Map<string, Map<string, number>>()
    for (const c of counted(list, categories)) {
      const name = categoryName(c.category, categories)
      const apps = m.get(name) ?? new Map<string, number>()
      add(apps, appOf(c), minutesOf(c))
      m.set(name, apps)
    }
    return m
  }
  const now = tally(cards)
  const before = tally(previous)
  return [...now]
    .map(([category, apps]) => ({
      category,
      color: colorOf(category, categories),
      minutes: [...apps.values()].reduce((a, b) => a + b, 0),
      apps: [...apps]
        .map(([app, minutes]) => {
          const last = before.get(category)?.get(app) ?? 0
          return { app, minutes, change: last > 0 ? minutes - last : null }
        })
        .sort((a, b) => b.minutes - a.minutes)
        .slice(0, 8)
    }))
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, 5)
}

/** Category → app flows for the Sankey: at most 6 categories and 10 apps, "Other" included (upstream). */
export function sankeyLinks(cards: TimelineCard[], categories: Category[]): Array<{ source: string; target: string; minutes: number }> {
  const list = counted(cards, categories).map((c) => ({ category: categoryName(c.category, categories), app: appOf(c), minutes: minutesOf(c) }))
  const byCategory = new Map<string, number>()
  const byApp = new Map<string, number>()
  for (const x of list) {
    add(byCategory, x.category, x.minutes)
    add(byApp, x.app, x.minutes)
  }
  const shownCategories = visibleNames(byCategory, 6)
  const shownApps = visibleNames(byApp, 10)
  const links = new Map<string, { source: string; target: string; minutes: number }>()
  for (const x of list) {
    const source = !shownCategories || shownCategories.has(x.category) ? x.category : 'Other categories'
    const target = !shownApps || shownApps.has(x.app) ? x.app : 'Other apps'
    const link = links.get(`${source}\u0000${target}`) ?? { source, target, minutes: 0 }
    link.minutes += x.minutes
    links.set(`${source}\u0000${target}`, link)
  }
  return [...links.values()]
}

// ---- Focus and distraction heat map (upstream WeeklyDashboardBuilder+HeatmapWorkflow.swift,
// Views/UI/Weekly/Sections/WeeklyFocusHeatmapSection.swift)

const BUCKET = 5

/** A card in clock minutes (24:00-28:00 for the hours after midnight). */
interface Fact {
  card: TimelineCard
  start: number
  end: number
}

/** The week's activity, padded by 30 minutes and snapped to 15 (upstream weeklyActivityWindow). */
function activityWindow(facts: Fact[]): { start: number; end: number } {
  if (!facts.length) return { start: 9 * 60, end: 22 * 60 }
  const start = Math.floor(Math.max(DAY_START_MINUTE, Math.min(...facts.map((f) => f.start)) - 30) / 15) * 15
  let end = Math.ceil(Math.min(DAY_END_MINUTE, Math.max(...facts.map((f) => f.end)) + 30) / 15) * 15
  if (end === 24 * 60) end = DAY_END_MINUTE
  return end > start ? { start, end } : { start: 9 * 60, end: 22 * 60 }
}

/** A whole distraction card: its category says so, or it lists no distractions but its texts do. */
export function isFullDistraction(card: TimelineCard): boolean {
  const text = `${card.category} ${card.subcategory}`.toLowerCase()
  if (text.includes('distraction') || text.includes('distracted')) return true
  return card.distractions.length ? false : isDistraction(card)
}

/** Clock-minute range, moving times before 4 AM past midnight (upstream normalizedMinuteRange). */
function normalizedRange(start: number, end: number): { start: number; end: number } {
  const s = start < 240 ? start + 1440 : start
  let e = end < 240 ? end + 1440 : end
  if (e <= s) e += 1440
  return { start: s, end: e }
}

/** The distractions listed in a card, placed inside it (upstream alignedDistractionRange). */
function embeddedDistractions(f: Fact): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = []
  for (const d of f.card.distractions) {
    const s = parseClockLabel(d.startTime)
    const e = parseClockLabel(d.endTime)
    if (s === null || e === null) continue
    const n = normalizedRange(s, e)
    const best = [n, { start: n.start - 1440, end: n.end - 1440 }, { start: n.start + 1440, end: n.end + 1440 }]
      .filter((c) => c.start >= f.start - 2 && c.end <= f.end + 2 && c.end > c.start)
      .sort((a, b) => Math.abs(a.start - f.start) + Math.abs(f.end - a.end) * 0.1 - (Math.abs(b.start - f.start) + Math.abs(f.end - b.end) * 0.1))[0]
    if (best) out.push(best)
  }
  return out
}

/** Adds the minutes of [start, end) to each bucket they touch. */
function addInterval(values: number[], from: number, start: number, end: number, weight = 1): void {
  for (let i = 0; i < values.length; i++) values[i]! += slotOverlap(start, end, from + i * BUCKET, BUCKET) * weight
}

/** For each cell, the length of the run of true cells it belongs to. */
function runLengths(flags: boolean[]): number[] {
  const out = flags.map(() => 0)
  for (let i = 0; i < flags.length; ) {
    if (!flags[i]) {
      i++
      continue
    }
    let j = i
    while (j < flags.length && flags[j]) j++
    for (let k = i; k < j; k++) out[k] = j - i
    i = j
  }
  return out
}

const clamp1 = (v: number) => Math.max(-1, Math.min(1, v))

/** One day's scores: -1 deep focus … +1 distracted (upstream heatmapValues and heatmapScores). */
function dayScores(facts: Fact[], from: number, count: number): number[] {
  const focus = new Array<number>(count).fill(0)
  const distraction = new Array<number>(count).fill(0)
  const switches = new Array<number>(count).fill(0)
  const signature = (f: Fact) => `${normalized(f.card.category)}|${appOf(f.card).toLowerCase()}`
  let previous: Fact | null = null
  for (const f of [...facts].sort((a, b) => a.start - b.start)) {
    if (previous && f.start - previous.end <= 20 && signature(f) !== signature(previous)) {
      const i = Math.floor((f.start - from) / BUCKET)
      if (f.start >= from && i < count) switches[i]! += 1
    }
    if (isFullDistraction(f.card)) addInterval(distraction, from, f.start, f.end)
    else {
      addInterval(focus, from, f.start, f.end)
      for (const d of embeddedDistractions(f)) {
        addInterval(distraction, from, d.start, d.end)
        addInterval(focus, from, d.start, d.end, -1)
      }
    }
    previous = f
  }
  const runs = runLengths(focus.map((m, i) => m >= BUCKET * 0.6 && distraction[i]! < 1))
  const raw = focus.map((m, i) => {
    const focusStrength = Math.max(0, Math.min(1, m / BUCKET)) * (0.35 + 0.65 * Math.min(1, runs[i]! / 6))
    const distractionStrength = Math.min(1, Math.max(0, Math.min(1, distraction[i]! / BUCKET)) * 1.25)
    const switchStrength = Math.min(1, switches[i]! / 2) * 0.22
    return clamp1(distractionStrength + switchStrength - focusStrength)
  })
  if (raw.length <= 2) return raw
  // Focused cells are smoothed with their focused neighbours (upstream smoothFocusedHeatmapScores).
  return raw.map((v, i) => {
    if (v >= 0) return v
    const near = raw.slice(Math.max(0, i - 1), i + 2).filter((x) => x < 0)
    if (near.length <= 1) return v
    return clamp1(v * 0.55 + (near.reduce((a, b) => a + b, 0) / near.length) * 0.45)
  })
}

export interface FocusHeatmap {
  startMinute: number
  endMinute: number
  bucketMinutes: number
  /** Sunday first, like upstream; `values` run from -1 (focused) to +1 (distracted). */
  rows: Array<{ day: string; values: number[] }>
}

/** The week's focus and distraction scores in 5-minute buckets. `days` run Monday to Sunday. */
export function focusHeatmap(cards: TimelineCard[], categories: Category[], days: string[]): FocusHeatmap {
  const facts = counted(cards, categories).map((c) => {
    const start = clockMinutes(c.start)
    return { card: c, start, end: start + (c.end - c.start) / 60 }
  })
  const window = activityWindow(facts)
  const count = Math.max(1, Math.ceil((window.end - window.start) / BUCKET))
  const order = days.length === 7 ? [days[6]!, ...days.slice(0, 6)] : days
  return {
    startMinute: window.start,
    endMinute: window.start + count * BUCKET,
    bucketMinutes: BUCKET,
    rows: order.map((day) => ({ day, values: dayScores(facts.filter((f) => f.card.day === day), window.start, count) }))
  }
}

const NEUTRAL_THRESHOLD = 0.045
const FOCUS_SOFT = [0xe3, 0xdb, 0xfd]
const FOCUS_DARK = [0x42, 0x76, 0xe9]
const DISTRACTION_SOFT = [0xf8, 0xd1, 0xca]
const DISTRACTION_DARK = [0xfc, 0x76, 0x45]

/** A cell's score after fading the edges of runs of 4+ same-signed cells and boosting their centre. */
function adjusted(values: number[], index: number): number {
  const value = values[index]!
  if (Math.abs(value) < NEUTRAL_THRESHOLD) return value
  const sign = value < 0 ? -1 : 1
  const same = (v: number) => Math.abs(v) >= NEUTRAL_THRESHOLD && (v < 0 ? -1 : 1) === sign
  let start = index
  let end = index
  while (start > 0 && same(values[start - 1]!)) start--
  while (end < values.length - 1 && same(values[end + 1]!)) end++
  const length = end - start + 1
  if (length < 4) return value
  const center = (length - 1) / 2
  const linear = Math.max(0, Math.min(1, 1 - Math.abs(index - start - center) / Math.max(center, 1)))
  const progress = linear * linear * (3 - 2 * linear)
  const edge = Math.max(NEUTRAL_THRESHOLD, Math.abs(value) * (1 - 0.65))
  const centre = Math.min(1, Math.abs(value) + 0.34)
  return sign * (edge + (centre - edge) * progress)
}

/** The cell colour: blue for focus, peach for distraction, null for the neutral empty cell. */
export function heatmapColor(values: number[], index: number): string | null {
  const v = adjusted(values, index)
  if (Math.abs(v) < NEUTRAL_THRESHOLD) return null
  const p = Math.pow(Math.max(0, Math.min(1, Math.abs(v))), 0.72)
  const [from, to] = v < 0 ? [FOCUS_SOFT, FOCUS_DARK] : [DISTRACTION_SOFT, DISTRACTION_DARK]
  return `#${from.map((a, i) => Math.round(a + (to[i]! - a) * p).toString(16).padStart(2, '0')).join('')}`
}
