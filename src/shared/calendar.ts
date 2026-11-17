// The month grid of the timeline's calendar popover, after upstream Dayflow
// (Views/UI/MainView/TimelineCalendarPopover.swift): Monday first, padded with
// the neighbouring months' days to whole weeks.

import { pad, shiftDay } from './day'

export interface Month {
  year: number
  /** 0 = January. */
  month: number
}

/** The weeks (Monday to Sunday, as day keys) that show `month`. */
export function monthGrid(year: number, month: number): string[][] {
  const first = `${year}-${pad(month + 1)}-01`
  const lead = (new Date(year, month, 1).getDay() + 6) % 7
  const length = new Date(year, month + 1, 0).getDate()
  const weeks = Math.ceil((lead + length) / 7)
  const start = shiftDay(first, -lead)
  return Array.from({ length: weeks }, (_, w) => Array.from({ length: 7 }, (_, d) => shiftDay(start, w * 7 + d)))
}

export function shiftMonth(m: Month, delta: number): Month {
  const total = m.year * 12 + m.month + delta
  return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 }
}
