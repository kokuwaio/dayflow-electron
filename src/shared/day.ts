// Days run from 4 AM to 4 AM local time, like upstream, so late nights stay
// on the day they started. Times are Unix seconds; keys are "YYYY-MM-DD".

const BOUNDARY_HOUR = 4

const pad = (n: number) => String(n).padStart(2, '0')
const keyOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** The local midnight Date of a day key. */
export function parseKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y!, m! - 1, d!)
}

/** Today's key, by the 4 AM boundary. */
export const todayKey = (): string => dayKey(Math.floor(Date.now() / 1000))

export function dayKey(ts: number): string {
  const d = new Date(ts * 1000)
  if (d.getHours() < BOUNDARY_HOUR) d.setDate(d.getDate() - 1)
  return keyOf(d)
}

/** True for a real calendar date written as "YYYY-MM-DD". */
export function isDayKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && keyOf(parseKey(value)) === value
}

export function dayRange(key: string): { start: number; end: number } {
  const d = parseKey(key)
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), BOUNDARY_HOUR)
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, BOUNDARY_HOUR)
  return { start: start.getTime() / 1000, end: end.getTime() / 1000 }
}

export function shiftDay(key: string, days: number): string {
  const d = parseKey(key)
  d.setDate(d.getDate() + days)
  return keyOf(d)
}

/** "2:30 PM" in local time, like upstream's "h:mm a". */
export function formatClock(ts: number): string {
  const d = new Date(ts * 1000)
  const h = d.getHours()
  return `${h % 12 === 0 ? 12 : h % 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

/** Minutes since local midnight; times before 4 AM count as the evening before (24:00–28:00). */
export function clockMinutes(ts: number): number {
  const d = new Date(ts * 1000)
  const m = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60
  return m < BOUNDARY_HOUR * 60 ? m + 1440 : m
}

/** Minutes of [start, end) inside the slot [from, from + length), all in clock minutes. */
export const slotOverlap = (start: number, end: number, from: number, length: number): number =>
  Math.max(0, Math.min(end, from + length) - Math.max(start, from))

/** "9am", "12pm" for a clock minute, like upstream's chart axes. */
export function hourLabel(minute: number): string {
  const h = Math.floor(minute / 60) % 24
  return `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? 'am' : 'pm'}`
}
