import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_CATEGORIES } from '../shared/categories'
import { todayKey } from '../shared/day'
import { Store } from '../main/db/store'
import { BridgeError } from './bridge-client'
import { type CliContext, runCli } from './run'
import { NoDataError, type ReadSource } from './source'

const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime() / 1000
const card = (start: number, end: number, title: string, category = 'Work', extra: Record<string, unknown> = {}) => ({
  start, end, title, category, subcategory: '', summary: `${title} summary`, detailedSummary: '', distractions: [], appSites: {}, ...extra
})

let store: Store
let edits: boolean
let sent: Array<{ operation: string; args: Record<string, unknown> }>
let reply: () => Record<string, unknown>
let answers: string[]
let interactive: boolean

beforeEach(() => {
  store = Store.open(':memory:')
  const b = store.createBatch({ start: at(17, 9), end: at(17, 12), shotIds: [] })
  store.addCards(b, [
    card(at(17, 9), at(17, 10, 30), 'Fixed the login bug', 'Work', {
      detailedSummary: 'Long write-up',
      subcategory: 'Coding',
      appSites: { primary: 'github.com' },
      distractions: [{ startTime: '9:10 AM', endTime: '9:12 AM', title: 'News', summary: '' }]
    }),
    card(at(17, 10, 30), at(17, 11), 'Read the news', 'Distraction'),
    card(at(17, 11), at(17, 11, 15), 'Processing failed', 'System'),
    card(at(10, 9), at(10, 10), 'Last week', 'Personal')
  ])
  store.saveStandup('2026-11-17', {
    draft: { highlightsTitle: 'x', highlights: ['Shipped login fix'], tasksTitle: 'y', tasks: ['Review PRs'], blockersTitle: 'Blockers', blockersBody: '' },
    sourceDay: '2026-11-16',
    provider: 'anthropic',
    model: 'm',
    generatedAt: 1
  })
  edits = false
  sent = []
  reply = () => ({ message: 'Done' })
  answers = []
  interactive = false
})

const source = (): ReadSource => ({
  store: () => store,
  categories: () => DEFAULT_CATEGORIES,
  editsEnabled: () => edits,
  appRunning: async () => edits
})

async function run(...argv: string[]) {
  const out: string[] = []
  const err: string[] = []
  const ctx: CliContext = {
    out: (t) => out.push(t),
    err: (t) => err.push(t),
    color: false,
    interactive,
    ask: async () => answers.shift() ?? '',
    source: source(),
    send: async (operation, args) => {
      sent.push({ operation, args })
      return reply()
    },
    terminalCommand: async (remove) => [remove ? 'removed' : 'linked'],
    mcp: async () => {}
  }
  const code = await runCli(argv, ctx)
  return { code, out: out.join('\n'), err: err.join('\n') }
}

const json = (text: string) => JSON.parse(text)

describe('dayflow-electron CLI: arguments and exit codes', () => {
  it('prints help without a command', async () => {
    const r = await run()
    expect(r.code).toBe(0)
    expect(r.out).toContain('dayflow-electron <command> [arguments] [--json]')
  })

  it('exits 2 on unknown commands, bad options and bad dates', async () => {
    expect((await run('frobnicate')).code).toBe(2)
    expect((await run('timeline', '--nope')).code).toBe(2)
    const bad = await run('timeline', '2026-02-30')
    expect(bad).toMatchObject({ code: 2, err: '"2026-02-30" is not a date. Use YYYY-MM-DD, e.g. 2026-03-11.' })
    expect((await run('card', 'abc')).code).toBe(2)
    expect((await run('timeline', '--from', '2026-11-17', '--to', '2026-11-10')).code).toBe(2)
  })

  it('writes JSON errors to stderr with schema_version', async () => {
    const r = await run('card', '999', '--json')
    expect(r.code).toBe(3)
    expect(r.out).toBe('')
    expect(json(r.err)).toEqual({ schema_version: 1, error: { code: 'not_found', message: 'No activity with ID 999.' } })
  })

  it('exits 5 when there is no data yet', async () => {
    store.close()
    const ctxSource = source()
    ctxSource.store = () => {
      throw new NoDataError()
    }
    const r = await runCli(['today'], {
      out: () => {},
      err: () => {},
      color: false,
      interactive: false,
      ask: async () => '',
      source: ctxSource,
      send: async () => ({}),
      terminalCommand: async () => [],
      mcp: async () => {}
    })
    expect(r).toBe(5)
  })
})

describe('dayflow-electron CLI: reads', () => {
  it('lists a day like upstream, with totals and record IDs', async () => {
    const r = await run('timeline', '2026-11-17')
    expect(r.code).toBe(0)
    const lines = r.out.split('\n')
    expect(lines[0]).toBe('Tuesday, November 17  2h 15m tracked')
    expect(lines[2]).toMatch(/^ {2}1 {2}9:00 AM – 10:30 AM {4}Fixed the login bug {25} {2}Work$/)
    expect(r.out).toContain('Work 1h 30m · Distraction 30m · System 15m')
    expect(r.out).toContain('3 activities · dayflow-electron timeline --summary for descriptions')
  })

  it('filters by category, case-insensitively', async () => {
    const r = await run('timeline', '2026-11-17', '--category', 'distraction', '--json')
    expect(json(r.out).cards.map((c: { title: string }) => c.title)).toEqual(['Read the news'])
  })

  it('returns the day envelope as JSON with upstream keys', async () => {
    const r = await run('timeline', '2026-11-17', '--json')
    const body = json(r.out)
    expect(body).toMatchObject({ schema_version: 1, date: '2026-11-17', time_zone: 'Europe/Berlin', day_boundary_hour: 4, detail_available: true })
    expect(body.cards[0]).toEqual({
      record_id: 1,
      start: '2026-11-17T09:00:00+01:00',
      end: '2026-11-17T10:30:00+01:00',
      duration_minutes: 90,
      title: 'Fixed the login bug',
      summary: 'Fixed the login bug summary',
      category: 'Work',
      subcategory: 'Coding',
      apps: ['github.com'],
      distraction_count: 1
    })
    // Keys are sorted, so output is stable.
    expect(Object.keys(body)).toEqual([...Object.keys(body)].sort())
  })

  it('includes the write-up with --detailed', async () => {
    const r = await run('timeline', '2026-11-17', '--json', '--detailed')
    expect(json(r.out)).toMatchObject({ detail_available: false, hint: '' })
    expect(json(r.out).cards[0].detailed_summary).toBe('Long write-up')
  })

  it('aggregates ranges over 7 days unless forced', async () => {
    const agg = json((await run('timeline', '--from', '2026-11-10', '--to', '2026-11-17', '--json')).out)
    expect(agg).toMatchObject({ granularity: 'aggregate', cards_omitted: 4, range: { from: '2026-11-10', to: '2026-11-17', days: 8 }, tracked_minutes: 180 })
    expect(agg.categories[0]).toEqual({ name: 'Work', minutes: 90, share: 0.5 })
    const forced = json((await run('timeline', '--from', '2026-11-10', '--to', '2026-11-17', '--json', '--force')).out)
    expect(forced.cards).toHaveLength(4)
    const text = await run('timeline', '--from', '2026-11-10', '--to', '2026-11-17')
    expect(text.out).toContain('Showing totals — 8 days is too many to list.')
  })

  it('shows one card in full', async () => {
    const r = await run('card', '1')
    expect(r.out.split('\n').slice(0, 3)).toEqual(['Fixed the login bug', 'Tuesday, November 17 · 9:00 AM – 10:30 AM · 1h 30m', 'Work › Coding · github.com'])
    expect(json((await run('card', '1', '--json')).out).detailed_summary).toBe('Long write-up')
  })

  it('reads the Daily standup', async () => {
    expect(json((await run('daily', '2026-11-17', '--json')).out)).toEqual({
      schema_version: 1,
      date: '2026-11-17',
      highlights: ['Shipped login fix'],
      tasks: ['Review PRs'],
      blockers: ''
    })
    const text = (await run('daily', '2026-11-17')).out
    expect(text).toContain('- Shipped login fix')
    expect(text.endsWith('Blockers\n- None')).toBe(true)
    expect((await run('daily', '2026-11-16')).code).toBe(3)
  })

  it('sums the week without failed cards; focus leaves Idle out', async () => {
    const body = json((await run('weekly', '2026-11-18', '--json')).out)
    expect(body).toMatchObject({ week_start: '2026-11-16T04:00:00+01:00', week_end: '2026-11-23T04:00:00+01:00', tracked_minutes: 120, focus_minutes: 120 })
    expect((await run('weekly', '2026-11-18')).out.split('\n')[0]).toBe('Mon Nov 16 – Sun Nov 22  Tracked 2h · Focus 2h')
  })

  it('lists categories from the settings', async () => {
    const body = json((await run('categories', '--json')).out)
    expect(body.categories.at(-1)).toMatchObject({ name: 'Idle', color_hex: '#A0AEC0', is_system: true, is_idle: true })
    expect((await run('categories')).out).toContain('  ■ Idle         #A0AEC0  system')
  })

  it('searches titles and summaries', async () => {
    const r = json((await run('search', 'login', '--json')).out)
    expect(r.query).toBe('login')
    expect(r.matches.map((m: { record_id: number }) => m.record_id)).toEqual([1])
    expect((await run('search', 'nothing here')).out).toBe('No activities matching "nothing here".')
    expect((await run('search')).code).toBe(2)
  })

  it('reports status with the real edits switch', async () => {
    edits = true
    const body = json((await run('status', '--json')).out)
    expect(body).toMatchObject({ today: todayKey(), edits_enabled: true, app_running: true, pending_batches: 1, failed_batches: 0 })
    expect((await run('status')).out).toContain('  Analysis backlog: 1 batch\n  Edits: on')
  })
})

describe('dayflow-electron CLI: writes', () => {
  it('refuses with exit 4 while edits are off, without contacting the app', async () => {
    const r = await run('categories', 'add', 'Reading')
    expect(r).toMatchObject({ code: 4, err: 'Editing is off. Turn on "Allow edits" in Dayflow Electron → Settings → MCP / CLI.' })
    expect(sent).toEqual([])
  })

  it('sends category edits as upstream operations', async () => {
    edits = true
    await run('categories', 'add', 'Reading', '--color', '#00ff00')
    await run('categories', 'rename', 'Work', 'Deep work')
    await run('categories', 'color', 'Work', 'F96E00')
    await run('categories', 'describe', 'Work', 'Coding', 'and', 'reviews')
    expect(sent).toEqual([
      { operation: 'category_add', args: { name: 'Reading', color: '#00ff00' } },
      { operation: 'category_update', args: { name: 'Work', new_name: 'Deep work' } },
      { operation: 'category_update', args: { name: 'Work', color: 'F96E00' } },
      { operation: 'category_update', args: { name: 'Work', description: 'Coding and reviews' } }
    ])
  })

  it('prints the app\'s message, or the data as JSON', async () => {
    edits = true
    expect((await run('categories', 'add', 'Reading')).out).toBe('✓ Done')
    expect(json((await run('categories', 'add', 'Reading', '--json')).out)).toEqual({ schema_version: 1, message: 'Done' })
  })

  it('asks before deleting; without a terminal it needs --yes', async () => {
    edits = true
    expect((await run('timeline', 'delete', '1')).code).toBe(2)
    interactive = true
    answers = ['n']
    expect(await run('timeline', 'delete', '1')).toMatchObject({ code: 0, out: 'Cancelled.' })
    expect(sent).toEqual([])
    answers = ['y']
    await run('timeline', 'delete', '1')
    await run('categories', 'remove', 'Work', '--yes')
    expect(sent).toEqual([
      { operation: 'activity_delete', args: { record_id: 1 } },
      { operation: 'category_remove', args: { name: 'Work' } }
    ])
  })

  it('updates an activity and sets a goal', async () => {
    edits = true
    expect((await run('timeline', 'update', '1')).code).toBe(2)
    await run('timeline', 'update', '1', '--title', 'Login fix', '--category', 'work')
    await run('goal', 'set', '2026-11-17', '--focus-minutes', '240', '--focus-category', 'Work', '--focus-category', 'Personal')
    expect(sent).toEqual([
      { operation: 'activity_update', args: { record_id: 1, title: 'Login fix', category: 'work' } },
      { operation: 'goal_set', args: { date: '2026-11-17', focus_minutes: 240, focus_categories: ['Work', 'Personal'] } }
    ])
    expect((await run('goal', 'set', '--focus-minutes', 'lots')).code).toBe(2)
    expect((await run('goal', 'set', 'tomorrow', '--focus-minutes', '60')).code).toBe(2)
  })

  it('maps bridge errors to exit codes: 6 when the app is not running', async () => {
    edits = true
    reply = () => {
      throw new BridgeError('app_not_running', "Dayflow Electron isn't running. Reads work offline; edits need the app open.")
    }
    expect((await run('categories', 'add', 'Reading')).code).toBe(6)
    reply = () => {
      throw new BridgeError('not_found', 'No category named "Nope".')
    }
    expect((await run('categories', 'rename', 'Nope', 'Yes')).code).toBe(3)
  })
})
