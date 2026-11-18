// Day view geometry: a 4 AM-to-4 AM canvas, after upstream Dayflow
// (Views/UI/CanvasTimelineDataView.swift, CanvasTimelineTypes.swift,
// CanvasActivityCard.swift, MainView/TimelineActivityLoader.swift
// recordingProjectionWindow, MainView/Lifecycle.swift, MainView/Support.swift).

import { SYSTEM_CATEGORY } from './categories'
import { DAY_START_MINUTE, clockMinutes, dayKey, dayRange } from './day'

/** Upstream's TimelineScale.hourHeight. */
export const HOUR_HEIGHT = 168
export const DAY_PX_PER_MIN = HOUR_HEIGHT / 60
/** Width of the hour-label column. */
export const TIME_COLUMN_WIDTH = 60
export const DAY_HEIGHT = 24 * HOUR_HEIGHT

const START_MINUTE = DAY_START_MINUTE
/** The recording slot shown as "Generating your next card". */
const CYCLE_SECONDS = 15 * 60
const HARD_CAP_SECONDS = 40 * 60

/** Minutes since 4 AM by the wall clock, so DST nights keep times on their hour lines. */
const minutesFrom4am = (ts: number) => clockMinutes(ts) - START_MINUTE

/** Whole hours since 4 AM of the clock hour `ts` falls in. */
const hourIndex = (ts: number) => Math.floor(minutesFrom4am(ts) / 60)

/** Vertical position and height of a card: 1 px gap above and below, at least 10 px tall. */
export function dayCardBox(card: { start: number; end: number }): { top: number; height: number } {
  const minutes = Math.max(0, (card.end - card.start) / 60)
  return { top: (minutesFrom4am(card.start) * HOUR_HEIGHT) / 60 + 1, height: Math.max(10, (minutes * HOUR_HEIGHT) / 60 - 2) }
}

/** Cards under 10 minutes show no text; under 13 minutes the text is centred without padding. */
export function cardTextMode(durationMinutes: number): 'hidden' | 'compact' | 'normal' {
  if (durationMinutes < 10) return 'hidden'
  return durationMinutes < 13 ? 'compact' : 'normal'
}

export interface HourMark {
  label: string
  top: number
  /** An hour still ahead today; drawn dimmer. */
  future: boolean
}

/** The 24 hour labels of the day column, "4:00 AM" to "3:00 AM". */
export function hourMarks(day: string, now: number): HourMark[] {
  const nowIndex = dayKey(now) === day ? hourIndex(now) : Infinity
  return Array.from({ length: 24 }, (_, i) => {
    const h = (4 + i) % 24
    return { label: `${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? 'AM' : 'PM'}`, top: i * HOUR_HEIGHT, future: i > nowIndex }
  })
}

/** scrollTop that puts the hour line two hours before now a quarter of the way down the view. */
export function nowScrollTop(now: number, viewportHeight: number): number {
  const target = Math.max(0, hourIndex(now) - 2)
  return Math.max(0, target * HOUR_HEIGHT - viewportHeight * 0.25)
}

/**
 * Where the "Generating your next card" slot goes today: 15 minutes centred on
 * now, pushed past any card it overlaps and kept inside the day. Null on other
 * days or when no free slot is left.
 */
export function recordingProjection(
  day: string,
  cards: ReadonlyArray<{ start: number; end: number }>,
  now: number
): { start: number; end: number } | null {
  if (dayKey(now) !== day) return null
  const { start: dayStart, end: dayEnd } = dayRange(day)
  let start = Math.max(dayStart, now - CYCLE_SECONDS / 2)
  let end = start + CYCLE_SECONDS
  const clamp = () => {
    if (end > dayEnd) {
      end = dayEnd
      start = Math.max(dayStart, end - CYCLE_SECONDS)
    }
    end = Math.min(end, start + HARD_CAP_SECONDS)
  }
  clamp()
  if (end <= start) return null

  const sorted = [...cards].sort((a, b) => a.start - b.start)
  const maxIterations = Math.max(1, sorted.length + 2)
  for (let iterations = 0; ; ) {
    const previous = { start, end }
    const hit = sorted.find((c) => c.end > start && c.start < end)
    if (!hit) break
    start = hit.end
    end = start + CYCLE_SECONDS
    clamp()
    if (start >= dayEnd) return null
    iterations++
    if ((start === previous.start && end === previous.end) || iterations >= maxIterations) return null
  }
  return end > start ? { start, end } : null
}

/** Minutes of all cards but failed ones, for "N hours tracked this week". */
export function weekTrackedMinutes(cards: ReadonlyArray<{ start: number; end: number; category: string }>): number {
  return cards.filter((c) => c.category !== SYSTEM_CATEGORY).reduce((sum, c) => sum + (c.end - c.start) / 60, 0)
}

/** The new day key once the 4 AM boundary has passed since `lastSeen`, else null. */
export function dayChanged(lastSeen: string, now: number): string | null {
  const current = dayKey(now)
  return current === lastSeen ? null : current
}
