import { describe, expect, it } from 'vitest'
import { parseCards } from './cards'

const at = (h: number, m: number, day = 17) => new Date(2026, 10, day, h, m).getTime() / 1000
const CATEGORIES = ['Work', 'Personal', 'Distraction', 'Idle']

const card = (startTime: string, endTime: string, extra: Record<string, unknown> = {}) => ({
  startTime, endTime, category: 'Work', subcategory: '', title: `${startTime} card`, summary: 's', detailedSummary: 'd', ...extra
})

describe('parseCards: reading the reply', () => {
  const window = { start: at(14, 0), end: at(14, 15) }

  it('finds the JSON array inside fences and chatter and resolves clock times to timestamps', () => {
    const text = 'Here you go:\n```json\n' + JSON.stringify([card('2:00 PM', '2:15 PM')]) + '\n```\nDone.'
    const result = parseCards(text, { window, previous: [], categories: CATEGORIES })
    expect(result).toMatchObject({ ok: true, cards: [{ start: at(14, 0), end: at(14, 15), title: '2:00 PM card' }] })
  })

  it('accepts the {"cards": [...]} envelope', () => {
    const result = parseCards(JSON.stringify({ cards: [card('2:00 PM', '2:15 PM')] }), { window, previous: [], categories: CATEGORIES })
    expect(result.ok).toBe(true)
  })

  it('resolves times across midnight relative to the window', () => {
    const night = { start: at(23, 55), end: at(0, 10, 18) }
    const result = parseCards(JSON.stringify([card('11:55 PM', '12:10 AM')]), { window: night, previous: [], categories: CATEGORIES })
    expect(result).toMatchObject({ ok: true, cards: [{ start: at(23, 55), end: at(0, 10, 18) }] })
  })

  it('maps categories case-insensitively, "idle time" to Idle and unknown ones to the first category', () => {
    const cards = [
      card('2:00 PM', '2:05 PM', { category: 'personal' }),
      card('2:05 PM', '2:10 PM', { category: 'idle time' }),
      card('2:10 PM', '2:15 PM', { category: 'Gaming' })
    ]
    // Short cards are fine here: this test is about categories only.
    const result = parseCards(JSON.stringify(cards), { window, previous: [], categories: CATEGORIES, validate: false })
    expect(result.ok && result.cards.map((c) => c.category)).toEqual(['Personal', 'Idle', 'Work'])
  })
})

describe('parseCards: validation', () => {
  const window = { start: at(14, 0), end: at(14, 30) }
  const previous = [{ start: at(13, 20), end: at(13, 40) }, { start: at(13, 45), end: at(14, 0) }] // gap 13:40-13:45
  const check = (cards: unknown[]) => parseCards(JSON.stringify(cards), { window, previous, categories: CATEGORIES })

  const good = [card('1:20 PM', '1:40 PM'), card('1:45 PM', '2:10 PM'), card('2:10 PM', '2:30 PM')]

  it('accepts cards that cover the previous cards and the window, keeping the real gap', () => {
    expect(check(good).ok).toBe(true)
  })

  it('snaps the outer edges onto the evidence when they are off by up to two minutes', () => {
    const result = check([card('1:21 PM', '1:40 PM'), card('1:45 PM', '2:10 PM'), card('2:10 PM', '2:28 PM')])
    expect(result).toMatchObject({ ok: true, cards: [{ start: at(13, 20) }, {}, { end: at(14, 30) }] })
  })

  it.each([
    ['overlapping cards', [card('1:20 PM', '1:40 PM'), card('1:45 PM', '2:12 PM'), card('2:10 PM', '2:30 PM')], /overlap/i],
    ['a card over 60 minutes', [card('1:20 PM', '1:40 PM'), card('1:45 PM', '2:30 PM', { endTime: '2:50 PM' })], /60 minutes|past/i],
    ['a short card that is not the last', [card('1:20 PM', '1:40 PM'), card('1:45 PM', '1:50 PM'), card('1:50 PM', '2:30 PM')], /10 minutes/i],
    ['a hole in the window', [card('1:20 PM', '1:40 PM'), card('1:45 PM', '2:05 PM'), card('2:10 PM', '2:30 PM')], /not covered/i],
    ['a card spanning the real gap', [card('1:20 PM', '2:00 PM'), card('2:00 PM', '2:30 PM')], /gap/i],
    ['time past the window', [card('1:20 PM', '1:40 PM'), card('1:45 PM', '2:10 PM'), card('2:10 PM', '2:45 PM')], /past|outside/i]
  ])('rejects %s', (_name, cards, issue) => {
    const result = check(cards)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.issue).toMatch(issue)
  })
})
