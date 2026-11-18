import { describe, expect, it } from 'vitest'
import { DEFAULT_CATEGORIES } from './categories'
import { appOf, contextShifts, donutItems, focusHeatmap, heatmapColor, sankeyLinks, trackedMinutes, treemap, workflowHeatmap } from './weekly'
import type { TimelineCard } from './types'

const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime() / 1000
let id = 0
const card = (d: number, h: number, mins: number, category: string, site?: string, extra: Partial<TimelineCard> = {}): TimelineCard => ({
  id: ++id, batchId: 1, startTime: '', endTime: '', start: at(d, 0) + h * 3600, end: at(d, 0) + h * 3600 + mins * 60, day: `2026-11-${d}`,
  title: 'x', summary: '', category, subcategory: '', detailedSummary: '', distractions: [], appSites: site ? { primary: site } : {}, ...extra
})

describe('weekly dashboard (upstream Core/Weekly)', () => {
  it('counts tracked minutes without Idle and failed cards', () => {
    expect(trackedMinutes([card(16, 9, 60, 'Work'), card(16, 10, 30, 'Idle'), card(16, 11, 15, 'System')], DEFAULT_CATEGORIES)).toBe(60)
  })

  it('names apps like upstream: known names first, else the first part of the domain, else from the card text', () => {
    expect(appOf(card(16, 9, 10, 'Work', 'docs.google.com'))).toBe('Docs')
    expect(appOf(card(16, 9, 10, 'Work', 'https://github.com/org/repo'))).toBe('GitHub')
    expect(appOf(card(16, 9, 10, 'Work', 'linear.app'))).toBe('Linear')
    expect(appOf(card(16, 9, 10, 'Work', 'https://x.com/home'))).toBe('X')
    expect(appOf(card(16, 9, 10, 'Work', 'netflix.com'))).toBe('Netflix')
    expect(appOf(card(16, 9, 10, 'Work', 'konsole'))).toBe('Konsole')
    expect(appOf(card(16, 9, 10, 'Work', undefined, { title: 'Reviewed PRs in GitHub' }))).toBe('GitHub')
    expect(appOf(card(16, 9, 10, 'Work'))).toBe('Other')
  })

  it('groups category names case-insensitively under the configured name', () => {
    expect(donutItems([card(16, 9, 30, 'work'), card(16, 10, 30, 'Work ')], DEFAULT_CATEGORIES)).toEqual([{ name: 'Work', minutes: 60, color: '#B984FF' }])
  })

  it('shows up to five categories in the donut, otherwise the top four and Other', () => {
    const extra = ['A', 'B', 'C'].map((name, i) => ({ id: name, name, color: `#11111${i}`, description: '' }))
    const cats = [...DEFAULT_CATEGORIES.slice(0, 3), ...extra, DEFAULT_CATEGORIES[3]!]
    const cards = [card(16, 9, 50, 'Work'), card(16, 10, 40, 'Personal'), card(16, 11, 30, 'Distraction'), card(16, 12, 20, 'A'), card(16, 13, 10, 'B'), card(16, 14, 5, 'C')]
    expect(donutItems(cards.slice(0, 5), cats)).toHaveLength(5) // five fit without folding
    const items = donutItems(cards, cats)
    expect(items.map((i) => [i.name, i.minutes])).toEqual([['Work', 50], ['Personal', 40], ['Distraction', 30], ['A', 20], ['Other', 15]])
    expect(items.at(-1)!.color).toBe('#BFB6AE')
  })

  it('counts context shifts and distractions per day and names the busiest day', () => {
    const cards = [
      card(16, 9, 30, 'Work'), card(16, 9.5, 30, 'Personal'), card(16, 10, 30, 'Work', undefined, { distractions: [{ startTime: '10:10 AM', endTime: '10:12 AM', title: 'feed', summary: '' }] }),
      card(17, 9, 30, 'Work'), card(17, 9.5, 30, 'Work', undefined, { title: 'Got distracted by the news' })
    ]
    const result = contextShifts(cards, DEFAULT_CATEGORIES, ['2026-11-16', '2026-11-17'])
    expect(result.days).toEqual([{ day: '2026-11-16', shifts: 2, distractions: 1 }, { day: '2026-11-17', shifts: 0, distractions: 1 }])
    expect(result.insight).toMatch(/^Monday had the most interruptions, with 2 context shifts and 1 distractions\.$/)
    expect(contextShifts([], DEFAULT_CATEGORIES, ['2026-11-16']).insight).toBe('No context shift or distraction pattern was detected in this week.')
  })

  it('colors each 15-minute slot of the week by its dominant category', () => {
    const map = workflowHeatmap([card(16, 9, 30, 'Work'), card(16, 9, 10, 'Personal')], DEFAULT_CATEGORIES, ['2026-11-16'])
    expect(map.startMinute).toBe(8 * 60 + 30)
    const row = map.rows[0]!
    expect(row.cells[2]).toMatchObject({ category: 'Work', occupancy: 1 }) // 9:00-9:15: Work 15 min, Personal 10 min
  })

  it('lists the top apps per category with the change against last week', () => {
    const now = [card(16, 9, 60, 'Work', 'github.com'), card(16, 10, 30, 'Work', 'slack.com')]
    const before = [card(9, 9, 30, 'Work', 'github.com')]
    expect(treemap(now, before, DEFAULT_CATEGORIES)).toEqual([
      { category: 'Work', color: '#B984FF', minutes: 90, apps: [{ app: 'GitHub', minutes: 60, change: 30 }, { app: 'Slack', minutes: 30, change: null }] }
    ])
  })

  it('links categories to apps for the Sankey: at most ten apps, Other included', () => {
    const cards = Array.from({ length: 12 }, (_, i) => card(16, 8 + i * 0.5, 30 - i, 'Work', `app${i}.example.com`))
    const links = sankeyLinks(cards, DEFAULT_CATEGORIES)
    expect(new Set(links.map((l) => l.target)).size).toBe(10) // nine apps plus Other
    expect(links.find((l) => l.target === 'Other apps')).toMatchObject({ source: 'Work', minutes: 21 + 20 + 19 })
    expect(sankeyLinks(cards.slice(0, 10), DEFAULT_CATEGORIES).some((l) => l.target === 'Other apps')).toBe(false) // ten fit
  })
})

describe('focus and distraction heat map (upstream WeeklyDashboardBuilder+HeatmapWorkflow)', () => {
  const week = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22']
  const monday = (cards: TimelineCard[]) => focusHeatmap(cards, DEFAULT_CATEGORIES, week).rows[1]!.values

  it('lists the days Sunday first, in 5-minute buckets over the padded activity window', () => {
    const map = focusHeatmap([card(16, 9, 60, 'Work')], DEFAULT_CATEGORIES, week)
    expect(map.rows.map((r) => r.day)).toEqual(['2026-11-22', ...week.slice(0, 6)])
    expect([map.startMinute, map.endMinute, map.bucketMinutes]).toEqual([8 * 60 + 30, 10 * 60 + 30, 5])
    expect(map.rows[1]!.values).toHaveLength(24)
  })

  it('falls back to 9 AM to 10 PM without cards, and leaves Idle and failed cards out', () => {
    const map = focusHeatmap([card(16, 9, 60, 'Idle'), card(16, 11, 30, 'System')], DEFAULT_CATEGORIES, week)
    expect([map.startMinute, map.endMinute]).toEqual([9 * 60, 22 * 60])
    expect(map.rows.every((r) => r.values.every((v) => v === 0))).toBe(true)
  })

  it('scores clean focus negative, reaching -1 after six buckets in a row', () => {
    const values = monday([card(16, 9, 60, 'Work')])
    // 9:00 is bucket 6.
    expect(values.slice(6, 18).every((v) => v === -1)).toBe(true)
    expect(values[5]).toBe(0)
    // Two clean buckets: 0.35 + 0.65 * 2/6.
    expect(monday([card(16, 9, 10, 'Work')])[6]).toBeCloseTo(-(0.35 + 0.65 * (2 / 6)))
  })

  it('scores distraction cards positive, and the distractions listed inside a focus card too', () => {
    expect(monday([card(16, 9, 15, 'Distraction')]).slice(6, 9)).toEqual([1, 1, 1])
    const values = monday([card(16, 9, 30, 'Work', undefined, { distractions: [{ startTime: '9:10 AM', endTime: '9:15 AM', title: 'feed', summary: '' }] })])
    expect(values[8]).toBe(1) // 9:10-9:15 is all distraction
    expect(values[6]).toBeLessThan(0)
  })

  it('adds switch pressure when the category or app changes within 20 minutes', () => {
    const switched = monday([card(16, 9, 30, 'Work', 'github.com'), card(16, 9.5, 30, 'Personal', 'github.com')])
    const same = monday([card(16, 9, 30, 'Work', 'github.com'), card(16, 9.5, 30, 'Work', 'github.com')])
    expect(same[12]).toBe(-1)
    // The 9:30 bucket carries one switch (0.5 * 0.22), then is smoothed with its focused neighbours.
    expect(switched[12]).toBeCloseTo(-(0.89 * 0.55 + 0.45 * (2.89 / 3)))
  })
})

describe('heat map colours (upstream WeeklyFocusHeatmapSection)', () => {
  it('leaves near-zero cells neutral and maps the extremes to the dark ends', () => {
    expect(heatmapColor([0.04], 0)).toBeNull()
    expect(heatmapColor([-1], 0)).toBe('#4276e9')
    expect(heatmapColor([1], 0)).toBe('#fc7645')
  })

  it('fades runs of four or more cells at the edges and boosts their centre', () => {
    const run = [-0.5, -0.5, -0.5, -0.5, -0.5]
    const at = (intensity: number) => {
      const p = Math.pow(intensity, 0.72)
      const mix = (a: number, b: number) => Math.round(a + (b - a) * p).toString(16).padStart(2, '0')
      return `#${mix(0xe3, 0x42)}${mix(0xdb, 0x76)}${mix(0xfd, 0xe9)}`
    }
    expect(heatmapColor(run, 2)).toBe(at(0.84)) // 0.5 + 0.34
    expect(heatmapColor(run, 0)).toBe(at(0.175)) // 0.5 * (1 - 0.65)
    expect(heatmapColor([-0.5, -0.5, -0.5], 0)).toBe(at(0.5)) // three cells are too short to fade
  })
})
