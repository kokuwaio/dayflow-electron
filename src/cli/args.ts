// Argument parsing for the `dayflow` CLI, after upstream Dayflow
// (tools/dayflow-cli/Sources/dayflow/main.swift). Unlike upstream, unknown
// options are errors instead of being ignored.

/**
 * Exit codes. Upstream: 0 success, 1 unexpected, 2 bad arguments, 3 not
 * found, 4 edits disabled, 5 no Dayflow data. Upstream also used 5 for "app
 * not running"; that gets 6 here (upstream had reserved it).
 */
export const EXIT = { ok: 0, unexpected: 1, usage: 2, notFound: 3, editsDisabled: 4, noData: 5, appNotRunning: 6 } as const

/** Options that take a value (upstream valueTakingFlags). */
const VALUE_FLAGS = new Set([
  '--category',
  '--from',
  '--to',
  '--color',
  '--title',
  '--focus-minutes',
  '--distraction-limit-minutes',
  '--focus-category',
  '--distraction-category'
])
const SWITCHES = new Set(['--json', '--summary', '--detailed', '--force', '--yes', '--help'])

export type ParsedArgs =
  | { ok: true; positional: string[]; switches: Set<string>; values: Map<string, string[]> }
  | { ok: false; message: string }

export function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = []
  const switches = new Set<string>()
  const values = new Map<string, string[]>()
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === '--') {
      positional.push(...argv.slice(i + 1))
      break
    }
    if (arg === '-h') {
      switches.add('--help')
      continue
    }
    if (!arg.startsWith('-') || arg === '-') {
      positional.push(arg)
      continue
    }
    const eq = arg.indexOf('=')
    const name = eq > 0 ? arg.slice(0, eq) : arg
    if (SWITCHES.has(name)) {
      if (eq > 0) return { ok: false, message: `${name} takes no value.` }
      switches.add(name)
    } else if (VALUE_FLAGS.has(name)) {
      let value: string
      if (eq > 0) value = arg.slice(eq + 1)
      else if (i + 1 < argv.length) value = argv[++i]!
      else return { ok: false, message: `${name} needs a value.` }
      values.set(name, [...(values.get(name) ?? []), value])
    } else {
      return { ok: false, message: `Unknown option "${name}". Run \`dayflow help\`.` }
    }
  }
  return { ok: true, positional, switches, values }
}
