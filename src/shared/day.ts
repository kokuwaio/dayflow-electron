// Days run from 4 AM to 4 AM local time, like upstream, so late nights stay
// on the day they started. Times are Unix seconds; keys are "YYYY-MM-DD".

const BOUNDARY_HOUR = 4

const pad = (n: number) => String(n).padStart(2, '0')
const keyOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

function parseKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y!, m! - 1, d!)
}

export function dayKey(ts: number): string {
  const d = new Date(ts * 1000)
  if (d.getHours() < BOUNDARY_HOUR) d.setDate(d.getDate() - 1)
  return keyOf(d)
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
