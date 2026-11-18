// Command dispatch of the `dayflow-electron` CLI, after upstream Dayflow
// (tools/dayflow-cli/Sources/dayflow/main.swift, WriteCommands.swift). Reads
// work with the app closed and go straight to the database; writes go to the
// running app over the bridge and need "Allow edits".

import { dayCount, dayRange, isDayKey, shiftDay, todayKey } from '../shared/day'
import { weekOf } from '../shared/week'
import { EXIT, parseArgs } from './args'
import { BridgeError } from './bridge-client'
import * as P from './payloads'
import * as R from './render'
import { NoDataError, type ReadSource } from './source'
import { errorMessage } from '../shared/errors'

type Exit = (typeof EXIT)[keyof typeof EXIT]


export interface CliContext {
  /** Writes one line (or several joined by newlines) to stdout. */
  out(text: string): void
  err(text: string): void
  /** stdout is a terminal (ANSI styling). */
  color: boolean
  /** stdin is a terminal (destructive commands may ask). */
  interactive: boolean
  ask(prompt: string): Promise<string>
  source: ReadSource
  /** Sends one write to the running app; throws BridgeError. */
  send(operation: string, args: Record<string, unknown>): Promise<Record<string, unknown>>
  /** `dayflow-electron link` / `unlink`; returns the lines to print. */
  terminalCommand(remove: boolean): Promise<string[]>
  /** Runs the MCP server until stdin closes. */
  mcp(): Promise<void>
}

class Failure extends Error {
  constructor(
    message: string,
    readonly exit: Exit,
    readonly code: string
  ) {
    super(message)
  }
}

const usage = (message: string) => new Failure(message, EXIT.usage, 'invalid_arguments')
const notFound = (message: string) => new Failure(message, EXIT.notFound, 'not_found')

export const HELP_TEXT = `dayflow-electron — your Dayflow Electron timeline, in the terminal

Usage
  dayflow-electron <command> [arguments] [--json]

Reading (works even when Dayflow Electron is closed)
  status                     Recording state and today's date
  timeline [YYYY-MM-DD]      A day's activities (aliases: today, yesterday)
    --summary                Include one-line descriptions
    --detailed               Include full write-ups
    --category <name>        Only one category
    --from/--to <date>       A range; over 7 days returns totals
  card <id>                  One activity in full detail
  daily [YYYY-MM-DD]         The Daily standup document
  weekly [YYYY-MM-DD]        The week containing that date
  categories                 Category names and colors
  search <text>              Find activities by title or summary

Editing (needs Dayflow Electron running, with edits enabled in Settings → MCP / CLI)
  timeline update <id> --title <text> | --category <name>
  timeline delete <id>       Asks first
  categories add <name> [--color <hex>]
  categories rename <old> <new>
  categories color <name> <hex>
  categories describe <name> <text>
  categories remove <name>   Asks first; past activities keep the label
  goal set [YYYY-MM-DD] --focus-minutes <n> [--distraction-limit-minutes <n>]
           [--focus-category <name>]... [--distraction-category <name>]...

Setup
  link                       Add \`dayflow-electron\` to ~/.local/bin
  unlink                     Remove it
  mcp                        Run the MCP server (stdio)

All commands accept --json for stable, scriptable output.`

export async function runCli(argv: string[], ctx: CliContext): Promise<number> {
  const parsed = parseArgs(argv)
  const wantsJSON = argv.includes('--json')
  const fail = (f: Failure): number => {
    if (wantsJSON) ctx.err(P.stableJson({ schema_version: P.SCHEMA_VERSION, error: { code: f.code, message: f.message } }))
    else ctx.err(f.message)
    return f.exit
  }
  if (!parsed.ok) return fail(usage(parsed.message))

  const { positional, switches, values } = parsed
  const json = switches.has('--json')
  const s = R.style(ctx.color)
  const value = (name: string) => values.get(name)?.at(-1)
  const print = (lines: string[]) => ctx.out(lines.join('\n'))
  const printJSON = (payload: P.Json) => ctx.out(P.stableJson(P.withSchema(payload), true))
  const store = () => ctx.source.store()

  const day = (key: string | undefined): string => {
    if (key === undefined) return todayKey()
    if (!isDayKey(key)) throw usage(`"${key}" is not a date. Use YYYY-MM-DD, e.g. 2026-03-11.`)
    return key
  }

  // ---------------------------------------------------------------- reads

  const timeline = (key: string | undefined) => {
    if (values.has('--from') || values.has('--to')) return timelineRange()
    const d = day(key)
    let cards = store().cardsForDay(d)
    const category = value('--category')
    if (category !== undefined) cards = cards.filter((c) => c.category.toLowerCase() === category.toLowerCase())
    if (json) printJSON(P.timelineEnvelope(d, cards, switches.has('--detailed')))
    else print(R.renderTimeline(d, cards, switches.has('--detailed') ? 'detailed' : switches.has('--summary') ? 'summary' : 'compact', s))
  }

  const timelineRange = () => {
    const from = value('--from')
    const to = value('--to')
    if (!from || !to || !isDayKey(from) || !isDayKey(to) || from > to) {
      throw usage('Ranges need --from and --to as YYYY-MM-DD, with --from first.')
    }
    const cards = store().cardsOverlapping(dayRange(from).start, dayRange(to).end)
    const days = dayCount(from, to)
    // Long ranges aggregate instead of listing; --force overrides for humans.
    if (days > P.MAX_RANGE_DAYS_FOR_ACTIVITIES && !switches.has('--force')) {
      if (json) printJSON(P.rangeAggregate(from, to, cards))
      else print(R.renderRangeAggregate(from, to, days, cards, s))
    } else if (json) printJSON(P.rangeListing(from, to, cards, switches.has('--detailed')))
    else print(R.renderRangeListing(from, to, cards, s))
  }

  const card = (idText: string | undefined) => {
    const id = recordId(idText)
    if (id === null) throw usage('Usage: dayflow-electron card <record-id>   (IDs come from `dayflow-electron timeline`)')
    const c = store().card(id)
    if (!c) throw notFound(`No activity with ID ${id}.`)
    if (json) printJSON(P.activityJson(c, true))
    else print(R.renderCard(c, s))
  }

  const daily = (key: string | undefined) => {
    // Standups are keyed by the 4 AM day, like the app's Daily tab.
    const d = day(key)
    const entry = store().standup(d)
    if (!entry) throw notFound(`No Daily for ${d}. Dayflow Electron generates one after a day with enough activity.`)
    if (json) printJSON(P.daily(d, entry))
    else print(R.renderDaily(d, entry, todayKey(), s))
  }

  const weekly = (key: string | undefined) => {
    const d = day(key)
    const span = P.weekSpan(d)
    const cards = store().cardsOverlapping(span.start, span.end)
    const categories = ctx.source.categories()
    if (json) printJSON(P.weekly(d, cards, categories))
    else print(R.renderWeekly(weekOf(d).days, cards, categories, s))
  }

  const categories = () => {
    const list = ctx.source.categories()
    if (json) printJSON(P.categoriesJson(list))
    else print(R.renderCategories(list, s))
  }

  const search = (text: string) => {
    if (!text) throw usage('Usage: dayflow-electron search <text>')
    const matches = store().searchCards(text, P.SEARCH_LIMIT)
    if (json) printJSON({ query: text, matches: matches.map((c) => P.activityJson(c, false)) })
    else print(R.renderSearch(text, matches, s))
  }

  const status = async () => {
    const capture = store().captureStatus()
    const editsEnabled = ctx.source.editsEnabled()
    const appRunning = await ctx.source.appRunning()
    const today = todayKey()
    if (json) printJSON(P.status({ today, ...capture, editsEnabled, appRunning }))
    else print(R.renderStatus({ today, ...capture, editsEnabled, appRunning, now: Math.floor(Date.now() / 1000) }, s))
  }

  // ---------------------------------------------------------------- writes

  const requireEdits = () => {
    if (!ctx.source.editsEnabled()) {
      throw new Failure('Editing is off. Turn on "Allow edits" in Dayflow Electron → Settings → MCP / CLI.', EXIT.editsDisabled, 'edits_disabled')
    }
  }

  const send = async (operation: string, args: Record<string, unknown>) => {
    requireEdits()
    try {
      return await ctx.send(operation, args)
    } catch (err) {
      if (err instanceof BridgeError) {
        const exit = err.code === 'app_not_running' ? EXIT.appNotRunning : err.code === 'edits_disabled' ? EXIT.editsDisabled : err.code === 'not_found' ? EXIT.notFound : err.code === 'invalid_argument' || err.code === 'already_exists' || err.code === 'permission_denied' ? EXIT.usage : EXIT.unexpected
        throw new Failure(err.message, exit, err.code)
      }
      throw new Failure(`Write failed: ${errorMessage(err)}`, EXIT.unexpected, 'write_failed')
    }
  }

  /** Asks before a destructive operation. Non-interactive callers must pass --yes. */
  const confirm = async (prompt: string): Promise<boolean> => {
    if (switches.has('--yes')) return true
    if (!ctx.interactive) throw usage('This is destructive. Re-run with --yes to confirm.')
    const answer = (await ctx.ask(`${prompt} [y/N] `)).trim().toLowerCase()
    if (answer === 'y' || answer === 'yes') return true
    ctx.out('Cancelled.')
    return false
  }

  const report = (data: Record<string, unknown>, fallback: string) => {
    if (json) printJSON(Object.keys(data).length ? data : { ok: true })
    else ctx.out(`✓ ${typeof data.message === 'string' ? data.message : fallback}`)
  }

  const categoriesWrite = async (sub: string, rest: string[]) => {
    switch (sub) {
      case 'add': {
        const name = rest[0]
        if (!name) throw usage('Usage: dayflow-electron categories add <name> [--color <hex>]')
        const args: Record<string, unknown> = { name }
        const color = value('--color')
        if (color !== undefined) args.color = color
        return report(await send('category_add', args), `Created ${name}`)
      }
      case 'rename':
        if (rest.length < 2) throw usage('Usage: dayflow-electron categories rename <old-name> <new-name>')
        return report(await send('category_update', { name: rest[0], new_name: rest[1] }), `Renamed ${rest[0]} to ${rest[1]}`)
      case 'color':
        if (rest.length < 2) throw usage('Usage: dayflow-electron categories color <name> <hex>')
        return report(await send('category_update', { name: rest[0], color: rest[1] }), `${rest[0]} is now ${rest[1]}`)
      case 'describe':
        if (rest.length < 2) throw usage('Usage: dayflow-electron categories describe <name> <text>')
        return report(await send('category_update', { name: rest[0], description: rest.slice(1).join(' ') }), `Updated description for ${rest[0]}`)
      case 'remove': {
        const name = rest[0]
        if (!name) throw usage('Usage: dayflow-electron categories remove <name>')
        requireEdits()
        if (!(await confirm(`Delete the category "${name}"? Past activities keep the label but lose the color.`))) return
        return report(await send('category_remove', { name }), `Removed ${name}`)
      }
      default:
        throw usage(`Unknown subcommand "${sub}". Use add, rename, color, describe, or remove.`)
    }
  }

  const timelineWrite = async (sub: 'update' | 'delete', rest: string[]) => {
    const id = recordId(rest[0])
    if (id === null) throw usage(`Usage: dayflow-electron timeline ${sub} <record-id>`)
    if (sub === 'update') {
      const args: Record<string, unknown> = { record_id: id }
      const title = value('--title')
      const category = value('--category')
      if (title !== undefined) args.title = title
      if (category !== undefined) args.category = category
      if (Object.keys(args).length === 1) throw usage('Nothing to change. Pass --title and/or --category.')
      return report(await send('activity_update', args), `Updated ${id}`)
    }
    requireEdits()
    if (!(await confirm(`Delete activity ${id}? It disappears from your timeline.`))) return
    return report(await send('activity_delete', { record_id: id }), `Deleted ${id}`)
  }

  const goalSet = async (key: string | undefined) => {
    const minutes = (name: string) => {
      const text = value(name)
      if (text === undefined) return undefined
      if (!/^\d+$/.test(text)) throw usage(`${name} needs a whole number of minutes.`)
      return Number(text)
    }
    const focus = minutes('--focus-minutes')
    if (focus === undefined) {
      throw usage(
        'Usage: dayflow-electron goal set [YYYY-MM-DD] --focus-minutes <n> [--distraction-limit-minutes <n>] [--focus-category <name>]... [--distraction-category <name>]...'
      )
    }
    const args: Record<string, unknown> = { date: day(key), focus_minutes: focus }
    const limit = minutes('--distraction-limit-minutes')
    if (limit !== undefined) args.distraction_limit_minutes = limit
    const focusCategories = values.get('--focus-category')
    const distractionCategories = values.get('--distraction-category')
    if (focusCategories) args.focus_categories = focusCategories
    if (distractionCategories) args.distraction_categories = distractionCategories
    return report(await send('goal_set', args), 'Goal saved')
  }

  // ---------------------------------------------------------------- dispatch

  const [command, ...rest] = positional
  try {
    if (switches.has('--help') || command === undefined || command === 'help') {
      ctx.out(HELP_TEXT)
      return EXIT.ok
    }
    switch (command) {
      case 'status':
        await status()
        break
      case 'timeline':
        if (rest[0] === 'update' || rest[0] === 'delete') await timelineWrite(rest[0], rest.slice(1))
        else timeline(rest[0])
        break
      case 'today':
        timeline(undefined)
        break
      case 'yesterday':
        timeline(shiftDay(todayKey(), -1))
        break
      case 'card':
        card(rest[0])
        break
      case 'daily':
        daily(rest[0])
        break
      case 'weekly':
        weekly(rest[0])
        break
      case 'categories':
        if (rest.length > 0) await categoriesWrite(rest[0]!, rest.slice(1))
        else categories()
        break
      case 'goal':
        if (rest[0] !== 'set') throw usage('Usage: dayflow-electron goal set [YYYY-MM-DD] --focus-minutes <n> ...')
        await goalSet(rest[1])
        break
      case 'search':
        search(rest.join(' '))
        break
      case 'link':
      case 'unlink':
        try {
          print(await ctx.terminalCommand(command === 'unlink'))
        } catch (err) {
          throw new Failure(errorMessage(err), EXIT.unexpected, 'link_failed')
        }
        break
      case 'mcp':
        await ctx.mcp()
        break
      default:
        throw usage(`Unknown command "${command}". Run \`dayflow-electron help\`.`)
    }
    return EXIT.ok
  } catch (err) {
    if (err instanceof Failure) return fail(err)
    if (err instanceof NoDataError) return fail(new Failure(err.message, EXIT.noData, 'no_data'))
    return fail(new Failure(`Query failed: ${errorMessage(err)}`, EXIT.unexpected, 'query_failed'))
  }
}

/** A positive whole record ID, or null. */
export function recordId(text: string | undefined): number | null {
  if (text === undefined || !/^\d{1,15}$/.test(text)) return null
  const id = Number(text)
  return id > 0 ? id : null
}
