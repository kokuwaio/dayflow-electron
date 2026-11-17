// Weekly dashboard numbers, after upstream Dayflow (Core/Weekly/*). No AI:
// everything comes from the week's timeline cards.

import { type Category, FALLBACK_COLOR, SYSTEM_CATEGORY } from './categories'
import { clockMinutes, parseKey, slotOverlap } from './day'
import { parseClockLabel } from './daily'
import type { TimelineCard } from './types'

/** Weeks with less tracked time show a gate instead of charts (upstream: 15 h). */
export const WEEKLY_MIN_TRACKED_MINUTES = 15 * 60
const OTHER_COLOR = '#BFB6AE'
const DISTRACTION_COLOR = '#FF5950'

/** Whole minutes per card, rounded like upstream. */
const minutesOf = (c: TimelineCard) => Math.max(0, Math.round((c.end - c.start) / 60))
/** Category and app names match case-insensitively, like upstream's normalized keys. */
const normalized = (s: string) => s.trim().toLowerCase()

/** Cards that count: everything but Idle and failed ("System") cards. */
function counted(cards: TimelineCard[], categories: Category[]): TimelineCard[] {
  const idle = new Set(categories.filter((c) => c.isIdle).map((c) => normalized(c.name)))
  return cards.filter((c) => {
    const name = normalized(c.category)
    return !idle.has(name) && name !== normalized(SYSTEM_CATEGORY) && name !== 'idle'
  })
}

/** The category's name as configured, so "work" and "Work" land in one group. */
const categoryName = (name: string, categories: Category[]) => categories.find((c) => normalized(c.name) === normalized(name))?.name ?? name.trim()
const colorOf = (name: string, categories: Category[]) => categories.find((c) => normalized(c.name) === normalized(name))?.color ?? FALLBACK_COLOR

/** Adds `minutes` under `name` to a running total. */
const add = (m: Map<string, number>, name: string, minutes: number) => m.set(name, (m.get(name) ?? 0) + minutes)

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
  const needle = APP_NEEDLES.find(([n]) => source.toLowerCase().includes(n))
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
  const clamp = (m: number) => Math.min(28 * 60, Math.max(4 * 60, m))
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
