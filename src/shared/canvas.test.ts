import { describe, expect, it } from 'vitest'
import {
  HOUR_HEIGHT,
  cardTextMode,
  dayCardBox,
  dayChanged,
  hourMarks,
  nowScrollTop,
  recordingProjection,
  weekTrackedMinutes
} from './canvas'

const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime() / 1000

describe('dayCardBox', () => {
  it('places a card by its clock time since 4 AM at 168 px per hour, 1 px below its start', () => {
    expect(HOUR_HEIGHT).toBe(168)
    expect(dayCardBox({ start: at(17, 4), end: at(17, 5) })).toEqual({ top: 1, height: 168 - 2 })
    expect(dayCardBox({ start: at(17, 9, 30), end: at(17, 9, 45) })).toEqual({ top: 5.5 * 168 + 1, height: (15 * 168) / 60 - 2 })
  })

  it('puts times after midnight at the bottom of the same day', () => {
    expect(dayCardBox({ start: at(18, 1), end: at(18, 2) }).top).toBe(21 * 168 + 1)
  })

  it('keeps very short cards 10 px tall', () => {
    expect(dayCardBox({ start: at(17, 9), end: at(17, 9, 2) }).height).toBe(10)
  })
})

describe('cardTextMode', () => {
  it('hides text under 10 minutes and centres it under 13, like upstream', () => {
    expect(cardTextMode(9.9)).toBe('hidden')
    expect(cardTextMode(10)).toBe('compact')
    expect(cardTextMode(12.9)).toBe('compact')
    expect(cardTextMode(13)).toBe('normal')
  })
})

describe('hourMarks', () => {
  it('labels the 24 hours from 4 AM like the card times and dims the hours still ahead today', () => {
    const marks = hourMarks('2026-11-17', at(17, 10, 30))
    expect(marks).toHaveLength(24)
    expect(marks[0]).toEqual({ label: '4:00 AM', top: 0, future: false })
    expect(marks[6]).toEqual({ label: '10:00 AM', top: 6 * 168, future: false })
    expect(marks[7]!.future).toBe(true)
    expect(marks[23]!.label).toBe('3:00 AM')
  })

  it('dims nothing on other days', () => {
    expect(hourMarks('2026-11-16', at(17, 10)).some((m) => m.future)).toBe(false)
  })
})

describe('nowScrollTop', () => {
  it('scrolls so the hour two hours before now sits a quarter down the view', () => {
    // 10:30 AM: hour 6 after 4 AM, so the 8 AM line (index 4) goes to 25% of an 800 px view.
    expect(nowScrollTop(at(17, 10, 30), 800)).toBe(4 * 168 - 200)
  })

  it('never scrolls above the top', () => {
    expect(nowScrollTop(at(17, 5), 800)).toBe(0)
    // 1 AM counts as hour 21 of the day before.
    expect(nowScrollTop(at(18, 1), 0)).toBe(19 * 168)
  })
})

describe('recordingProjection', () => {
  const day = '2026-11-17'

  it('is a 15-minute window centred on now', () => {
    expect(recordingProjection(day, [], at(17, 10, 30))).toEqual({ start: at(17, 10, 22) + 30, end: at(17, 10, 37) + 30 })
  })

  it('moves past cards it would overlap', () => {
    const cards = [{ start: at(17, 10, 15), end: at(17, 10, 30) }]
    expect(recordingProjection(day, cards, at(17, 10, 30))).toEqual({ start: at(17, 10, 30), end: at(17, 10, 45) })
  })

  it('stays inside the day', () => {
    expect(recordingProjection(day, [], at(17, 4, 2))).toEqual({ start: at(17, 4), end: at(17, 4, 15) })
    expect(recordingProjection(day, [], at(18, 3, 58))).toEqual({ start: at(18, 3, 45), end: at(18, 4) })
  })

  it('shows nothing on other days or when cards fill the rest of the day', () => {
    expect(recordingProjection('2026-11-16', [], at(17, 10))).toBeNull()
    expect(recordingProjection(day, [{ start: at(18, 3), end: at(18, 4) }], at(18, 3, 58))).toBeNull()
  })
})

describe('weekTrackedMinutes', () => {
  it('adds up every card but failed ones, like upstream', () => {
    const cards = [
      { start: at(17, 9), end: at(17, 10), category: 'Work' },
      { start: at(17, 10), end: at(17, 10, 30), category: 'Idle' },
      { start: at(17, 11), end: at(17, 11, 15), category: 'System' }
    ]
    expect(weekTrackedMinutes(cards)).toBe(90)
  })
})

describe('dayChanged', () => {
  it('reports the new day once the clock passes 4 AM', () => {
    expect(dayChanged('2026-11-17', at(18, 3, 59))).toBeNull()
    expect(dayChanged('2026-11-17', at(18, 4))).toBe('2026-11-18')
  })
})
