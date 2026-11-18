import { describe, expect, it } from 'vitest'
import { PX_PER_MIN, cardBox, mergeFailed, resolveOverlaps, weekOf } from './week'

const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime() / 1000

describe('weekOf', () => {
  it('runs from Monday to Sunday, using the 4 AM day', () => {
    expect(weekOf('2026-11-19', 'en-US')).toEqual({
      days: ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22'],
      title: 'November 16 - November 22'
    })
    expect(weekOf('2026-11-16', 'en-US').days[0]).toBe('2026-11-16') // a Monday is its own week start
    expect(weekOf('2026-11-22', 'en-US').days[0]).toBe('2026-11-16') // Sunday belongs to the week before
  })
})

describe('cardBox', () => {
  it('places cards by minutes since 4 AM and keeps short ones readable', () => {
    expect(cardBox({ start: at(17, 4, 0), end: at(17, 5, 0) }, '2026-11-17')).toEqual({ top: 1, height: 60 * PX_PER_MIN - 2 })
    expect(cardBox({ start: at(17, 13, 0), end: at(17, 13, 3) }, '2026-11-17')).toEqual({ top: 9 * 60 * PX_PER_MIN + 1, height: 16 })
    // 1 AM the next morning still belongs to this day, near the bottom.
    expect(cardBox({ start: at(18, 1, 0), end: at(18, 2, 0) }, '2026-11-17').top).toBe(21 * 60 * PX_PER_MIN + 1)
  })

  it('ends cards on the wall clock too, so cards across the spring jump stay contiguous', () => {
    // 29 March 2026, Europe/Berlin: 2:00 jumps to 3:00. A 1:55-3:10 card and the next one at 3:10 must touch.
    const t = (h: number, m: number) => new Date(2026, 2, 29, h, m).getTime() / 1000
    const first = cardBox({ start: t(1, 55), end: t(3, 10) }, '2026-03-28')
    const next = cardBox({ start: t(3, 10), end: t(3, 40) }, '2026-03-28')
    expect(first.top + first.height + 2).toBeCloseTo(next.top, 5)
  })

  it('falls back to the elapsed time when the autumn hour repeats', () => {
    // 25 October 2026: 3:00 CEST goes back to 2:00 CET. 2:50 CEST to 2:10 CET is 20 minutes.
    const start = new Date('2026-10-25T00:50:00Z').getTime() / 1000
    const box = cardBox({ start, end: start + 20 * 60 }, '2026-10-24')
    expect(box.height).toBeCloseTo(20 * PX_PER_MIN - 2, 5)
  })

  it('places cards by the clock, so a DST change does not shift them off the hour lines', () => {
    // Night of 28/29 March 2026 in Europe/Berlin: clocks jump from 2:00 to 3:00. 3:30 AM still belongs to the
    // 28 March day and sits 23.5 clock hours below 4 AM, although only 22.5 hours have passed.
    const halfPastThree = new Date(2026, 2, 29, 3, 30).getTime() / 1000
    expect(cardBox({ start: halfPastThree, end: halfPastThree + 600 }, '2026-03-28').top).toBe(23.5 * 60 * PX_PER_MIN + 1)
  })
})

describe('resolveOverlaps', () => {
  it('lets the shorter card win and trims the longer one', () => {
    const cards = [
      { id: 1, start: at(17, 9), end: at(17, 11) },
      { id: 2, start: at(17, 10, 30), end: at(17, 11, 30) }
    ]
    expect(resolveOverlaps(cards)).toEqual([
      { id: 1, start: at(17, 9), end: at(17, 10, 30) },
      { id: 2, start: at(17, 10, 30), end: at(17, 11, 30) }
    ])
  })

  it('merges failed cards less than a minute apart, like upstream', () => {
    const cards = [
      { id: 1, start: at(17, 9), end: at(17, 9, 15), category: 'System' },
      { id: 2, start: at(17, 9, 15) + 30, end: at(17, 9, 30), category: 'System' },
      { id: 3, start: at(17, 9, 30), end: at(17, 9, 45), category: 'Work' }
    ]
    expect(mergeFailed(cards).map((c) => [c.id, c.start, c.end])).toEqual([
      [1, at(17, 9), at(17, 9, 30)],
      [3, at(17, 9, 30), at(17, 9, 45)]
    ])
  })

  it('keeps the right side of a long card when a short one sits exactly in its middle', () => {
    const cards = [
      { id: 1, start: at(17, 9), end: at(17, 11) },
      { id: 2, start: at(17, 9, 50), end: at(17, 10, 10) }
    ]
    expect(resolveOverlaps(cards)).toEqual([
      { id: 2, start: at(17, 9, 50), end: at(17, 10, 10) },
      { id: 1, start: at(17, 10, 10), end: at(17, 11) }
    ])
  })

  it('keeps the bigger side of a long card around a short one inside it', () => {
    const cards = [
      { id: 1, start: at(17, 9), end: at(17, 12) },
      { id: 2, start: at(17, 9, 30), end: at(17, 10) }
    ]
    expect(resolveOverlaps(cards)).toEqual([
      { id: 2, start: at(17, 9, 30), end: at(17, 10) },
      { id: 1, start: at(17, 10), end: at(17, 12) }
    ])
  })
})
