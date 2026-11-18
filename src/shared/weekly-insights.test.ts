import { describe, expect, it } from 'vitest'
import { type Category, DEFAULT_CATEGORIES } from './categories'
import type { TimelineCard } from './types'
import { appInteractions, overviewFocusDays, weeklyHighlights, weeklyOverview } from './weekly-insights'

const week = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22']
let id = 0
/** A card on November `d`, 2026 from h:m to h2:m2 local time. */
const card = (d: number, from: string, to: string, category: string, extra: Partial<TimelineCard> = {}): TimelineCard => {
  const at = (hm: string) => {
    const [h, m] = hm.split(':').map(Number)
    return new Date(2026, 10, d, h!, m!).getTime() / 1000
  }
  return {
    id: ++id, batchId: 1, startTime: '', endTime: '', start: at(from), end: at(to), day: `2026-11-${d}`,
    title: 'x', summary: '', category, subcategory: '', detailedSummary: '', distractions: [], appSites: {}, ...extra
  }
}
const site = (primary: string) => ({ appSites: { primary } })

describe('weekly overview (upstream WeeklyOverviewBuilder)', () => {
  const cards = [
    card(16, '8:30', '9:15', 'Personal'),
    card(16, '9:15', '10:45', 'Work'),
    card(16, '10:45', '11:00', 'Distraction'),
    card(16, '11:00', '12:30', 'Work'),
    card(16, '12:30', '13:15', 'Idle'),
    card(16, '13:15', '13:30', 'System'),
    card(16, '13:30', '15:00', 'Work'),
    card(17, '9:00', '10:00', 'Work'),
    card(17, '10:04', '11:00', 'Work'),
    card(17, '11:05', '12:00', 'Work'),
    card(17, '12:00', '13:00', 'work')
  ]
  const overview = weeklyOverview(cards, DEFAULT_CATEGORIES, week)

  it('draws each day as clock-minute segments, Idle included, failed cards left out, touching cards of one category merged', () => {
    expect(overview.rows.map((r) => r.day)).toEqual(week)
    const seg = (day: number) => overview.rows[day]!.segments.map((s) => [s.category, s.start, s.end])
    expect(seg(0)).toEqual([
      ['Personal', 510, 555],
      ['Work', 555, 645],
      ['Distraction', 645, 660],
      ['Work', 660, 750],
      ['Idle', 750, 795],
      ['Work', 810, 900]
    ])
    // 10:04 is 4 minutes after 10:00, more than upstream's 1-minute merge gap; 12:00 touches 12:00.
    expect(seg(1)).toEqual([
      ['Work', 540, 600],
      ['Work', 604, 660],
      ['Work', 665, 780]
    ])
    expect(overview.rows[2]!.segments).toEqual([])
    expect(overview.rows[0]!.segments[0]!.color).toBe('#6AADFF')
  })

  it("shows upstream's 9 AM to 6 PM, widened to whole hours around earlier or later cards", () => {
    expect([overview.startMinute, overview.endMinute]).toEqual([8 * 60, 18 * 60])
    const late = weeklyOverview([card(16, '10:00', '11:00', 'Work'), card(17, '19:00', '21:15', 'Work')], DEFAULT_CATEGORIES, week)
    expect([late.startMinute, late.endMinute]).toEqual([9 * 60, 22 * 60])
    // A card after midnight belongs to the day before and sits past 24:00.
    const night = weeklyOverview([card(17, '0:30', '1:10', 'Work', { day: '2026-11-16' })], DEFAULT_CATEGORIES, week)
    expect([night.startMinute, night.endMinute]).toEqual([9 * 60, 26 * 60])
    expect(night.rows[0]!.segments.map((s) => [s.start, s.end])).toEqual([[1470, 1510]])
  })

  it('lists the categories in their configured order', () => {
    expect(overview.legend.map((l) => l.name)).toEqual(['Work', 'Personal', 'Distraction', 'Idle'])
  })

  it('folds categories beyond the top four into Other when there are more than five', () => {
    const extra: Category[] = ['A', 'B', 'C'].map((name) => ({ id: name, name, color: '#123456', description: '' }))
    const cats = [...DEFAULT_CATEGORIES, ...extra]
    const many = [
      card(16, '9:00', '11:00', 'Work'),
      card(16, '11:00', '12:30', 'Personal'),
      card(16, '12:30', '13:30', 'A'),
      card(16, '13:30', '14:20', 'B'),
      card(16, '14:20', '14:40', 'C'),
      card(16, '14:40', '14:50', 'Distraction')
    ]
    const result = weeklyOverview(many, cats, week)
    expect(result.legend).toEqual([
      { name: 'Work', color: '#B984FF' },
      { name: 'Personal', color: '#6AADFF' },
      { name: 'A', color: '#123456' },
      { name: 'B', color: '#123456' },
      { name: 'Other', color: '#BFB6AE' }
    ])
    // C and Distraction both become Other and touch, so they merge.
    expect(result.rows[0]!.segments.at(-1)).toEqual({ category: 'Other', color: '#BFB6AE', start: 860, end: 890 })
  })

  it('counts context switches like the context-shift chart: per day, without Idle and failed cards', () => {
    expect(overview.rows.slice(0, 2).map((r) => r.switches)).toEqual([3, 0])
    expect(overview.switchTotal).toBe(3)
    expect(overview.switchAverage).toBe(0) // 3 over 7 days, rounded
  })

  it('sums focus without Idle and distraction, finds the longest stretch with gaps under 5 minutes, and the primary category', () => {
    expect(overview.focusMinutes).toBe(45 + 90 + 90 + 90 + 60 + 56 + 55 + 60)
    // Monday 8:30-10:45 runs across Personal and Work; the Distraction card ends it.
    expect(overview.longestFocus).toEqual({ day: '2026-11-16', start: 510, end: 645, minutes: 135 })
    expect(overview.rows.slice(0, 2).map((r) => r.longestFocus)).toEqual([135, 120])
    expect(overview.primaryFocus).toEqual({ name: 'Work', minutes: 270 + 231, color: '#B984FF' })
  })

  it('has nothing to say about an empty week', () => {
    const empty = weeklyOverview([], DEFAULT_CATEGORIES, week)
    expect([empty.startMinute, empty.endMinute, empty.switchTotal, empty.focusMinutes]).toEqual([540, 1080, 0, 0])
    expect(empty.longestFocus).toBeNull()
    expect(empty.primaryFocus).toBeNull()
    expect(empty.legend).toEqual([])
  })

  it("picks the days each tab of the overview points at, ties included and days without cards left out", () => {
    expect(overviewFocusDays(overview, 'all')).toBeNull()
    expect(overviewFocusDays(overview, 'longest')).toEqual(['2026-11-16'])
    expect(overviewFocusDays(overview, 'least')).toEqual(['2026-11-17'])
    expect(overviewFocusDays(overview, 'most')).toEqual(['2026-11-16'])
    const tie = weeklyOverview([card(16, '9:00', '10:00', 'Work'), card(18, '9:00', '10:00', 'Work')], DEFAULT_CATEGORIES, week)
    expect(overviewFocusDays(tie, 'least')).toEqual(['2026-11-16', '2026-11-18'])
  })
})

describe('top highlights (upstream WeeklyDashboardBuilder.buildHighlights)', () => {
  it('takes the three longest cards, not Idle, failed or distraction ones', () => {
    const cards = [
      card(16, '9:00', '10:00', 'Work', { title: 'Short' }),
      card(16, '10:00', '13:00', 'Idle', { title: 'Away' }),
      card(16, '13:00', '15:00', 'Distraction', { title: 'Videos' }),
      card(17, '9:00', '11:30', 'Work', { title: 'Longest', summary: 'Rewrote the parser. Then lunch.' }),
      card(18, '9:00', '10:30', 'Personal', { title: 'Taxes' }),
      card(19, '9:00', '10:30', 'Work', { title: 'Same length, later' }),
      card(20, '9:00', '12:00', 'System', { title: 'Failed' })
    ]
    expect(weeklyHighlights(cards, DEFAULT_CATEGORIES).map((h) => [h.day, h.tag, h.minutes, h.text])).toEqual([
      ['2026-11-17', 'WORK', 150, 'Longest: Rewrote the parser.'],
      ['2026-11-18', 'PERSONAL', 90, 'Taxes.'],
      ['2026-11-19', 'WORK', 90, 'Same length, later.']
    ])
  })

  it("writes the title and the summary's first sentence, without the title twice or Markdown, cut at 170 characters", () => {
    const one = (extra: Partial<TimelineCard>, category = 'Work') => weeklyHighlights([card(16, '9:00', '10:00', category, extra)], DEFAULT_CATEGORIES)[0]!
    expect(one({ title: 'Code review', summary: 'Code review of the **canvas** PR.\nLeft comments.' }).text).toBe('Code review of the canvas PR.')
    expect(one({ title: 'Release', summary: 'Bumped v2.9.4 and wrote notes! Then lunch.' }).text).toBe('Release: Bumped v2.9.4 and wrote notes!')
    expect(one({ title: '  ', summary: '', detailedSummary: 'Opened the PR\nread the tests' }).text).toBe('Opened the PR read the tests.')
    expect(one({ title: '', summary: '' }).text).toBe('No summary available.')
    const long = one({ title: 'T', summary: `${'word '.repeat(50)}end.` }).text
    expect(long).toHaveLength(170)
    expect(long.endsWith('word word...')).toBe(true)
    expect(one({}, 'A rather long category name').tag).toBe('A RATHER LONG C...')
  })
})

describe('application interactions (upstream WeeklyDashboardBuilder+Interactions)', () => {
  const cards = [
    card(16, '9:00', '10:00', 'Work', site('github.com')),
    card(16, '10:00', '10:30', 'Work', site('slack.com')),
    card(16, '10:30', '11:30', 'Work', site('github.com')),
    card(16, '11:30', '11:45', 'Distraction', site('youtube.com')),
    card(16, '11:45', '12:45', 'Work', site('github.com')),
    card(16, '12:45', '13:00', 'Idle', site('github.com')),
    card(17, '9:00', '9:20', 'Work', site('slack.com')),
    card(17, '9:20', '10:20', 'Work', site('github.com')),
    card(17, '10:20', '10:30', 'Distraction', site('reddit.com')),
    card(17, '10:30', '11:00', 'Personal', site('mail.google.com')),
    card(17, '11:00', '11:40', 'Work') // names no app: "Other" is left out
  ]
  const result = appInteractions(cards, DEFAULT_CATEGORIES)

  it('places the most used apps on upstream\'s fixed spots, sized by time, the top one largest', () => {
    expect(result.nodes.map((n) => [n.name, n.kind, n.size, n.minutes, n.visits, n.primary, n.muted])).toEqual([
      ['GitHub', 'work', 76, 240, 4, true, false],
      ['Slack', 'work', 43, 50, 2, false, false],
      ['Mail', 'personal', 40, 30, 1, false, false],
      ['YouTube', 'distraction', 37, 15, 1, false, false],
      ['Reddit', 'distraction', 36, 10, 1, false, false]
    ])
    expect(result.nodes.slice(0, 2).map((n) => [n.x, n.y, n.mark])).toEqual([[256.5, 253.3, 'G'], [106.5, 411.3, 'S']])
    expect(result.subtitle).toBe('About 100% of recorded app time was spent using these applications.')
  })

  it('links apps used one after another on the same day, most frequent first', () => {
    expect(result.edges.map((e) => [e.from, e.to, e.kind, e.count, e.weight, e.curve])).toEqual([
      ['slack', 'github', 'work', 2, 1, -42],
      ['github', 'reddit', 'distraction', 1, 0.5, 24],
      ['github', 'slack', 'work', 1, 0.5, -55],
      ['github', 'youtube', 'distraction', 1, 0.5, -22],
      ['reddit', 'mail', 'distraction', 1, 0.5, 52],
      ['youtube', 'github', 'distraction', 1, 0.5, -14]
    ])
  })

  it('names the two most common work patterns per active day', () => {
    expect(result.patterns.map((p) => [p.from.name, p.from.average, p.to.name, p.to.average, p.perDay, p.text])).toEqual([
      ['Slack', 25, 'GitHub', 60, 1, 'Moves from Slack to GitHub an average of 1 time per active day.'],
      ['GitHub', 60, 'Slack', 25, 1, 'Moves from GitHub to Slack an average of 1 time per active day.']
    ])
  })

  it('follows the first work app that leads into distractions, with their average visit', () => {
    expect(result.rabbitHole).toEqual({
      from: { id: 'github', name: 'GitHub', initial: 'G', color: '#24292F', average: 60 },
      targets: [
        { id: 'reddit', name: 'Reddit', initial: 'R', color: '#FF613C', average: 10 },
        { id: 'youtube', name: 'YouTube', initial: 'Y', color: '#FF0000', average: 15 }
      ],
      average: 13 // 25 minutes over 2 visits
    })
  })

  it('tells distraction apps by whole words and an app by most of its time', () => {
    const kinds = appInteractions(
      [
        card(16, '9:00', '10:00', 'Work', site('firefox')),
        card(16, '10:00', '10:30', 'Work', site('x.com')),
        card(16, '10:30', '11:00', 'Work', site('netflix.com')),
        card(16, '11:00', '11:20', 'Distraction', site('firefox')),
        card(16, '11:20', '11:30', 'Work', site('maps.google.com'))
      ],
      DEFAULT_CATEGORIES
    ).nodes.map((n) => [n.name, n.kind])
    expect(kinds).toEqual([['Firefox', 'work'], ['Netflix', 'distraction'], ['X', 'distraction'], ['Maps', 'personal']])
  })

  it('keeps 14 apps and mutes all but the top six', () => {
    const many = Array.from({ length: 16 }, (_, i) => card(16, `${8 + Math.floor(i / 2)}:${i % 2 ? '30' : '00'}`, `${8 + Math.floor((i + 1) / 2)}:${(i + 1) % 2 ? '30' : '00'}`, 'Work', site(`app${String(i).padStart(2, '0')}.example.com`)))
    const out = appInteractions(many, DEFAULT_CATEGORIES)
    expect(out.nodes).toHaveLength(14)
    expect(out.nodes.map((n) => n.muted).indexOf(true)).toBe(6)
    expect(out.subtitle).toBe('About 88% of recorded app time was spent using these applications.') // 14 of 16 half hours
    expect(out.edges).toHaveLength(13) // transitions to the two dropped apps are not drawn
  })

  it('says so when the week has no apps', () => {
    const empty = appInteractions([card(16, '9:00', '10:00', 'Work')], DEFAULT_CATEGORIES)
    expect(empty).toEqual({ subtitle: 'No recorded app interactions for this week yet.', nodes: [], edges: [], patterns: [], rabbitHole: null })
  })
})
