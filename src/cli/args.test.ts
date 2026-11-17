import { describe, expect, it } from 'vitest'
import { EXIT, parseArgs } from './args'

describe('parseArgs', () => {
  it('splits positionals, switches and flag values like upstream', () => {
    const a = parseArgs(['timeline', '2026-11-17', '--json', '--category', 'Deep work', '--detailed'])
    expect(a).toEqual({
      ok: true,
      positional: ['timeline', '2026-11-17'],
      switches: new Set(['--json', '--detailed']),
      values: new Map([['--category', ['Deep work']]])
    })
  })

  it('collects repeated flags and accepts --flag=value', () => {
    const a = parseArgs(['goal', 'set', '--focus-minutes=240', '--focus-category', 'Work', '--focus-category', 'Code Review'])
    expect(a.ok && a.values.get('--focus-category')).toEqual(['Work', 'Code Review'])
    expect(a.ok && a.values.get('--focus-minutes')).toEqual(['240'])
  })

  it('takes everything after -- as positionals', () => {
    const a = parseArgs(['search', '--', '--json is text here'])
    expect(a.ok && a.positional).toEqual(['search', '--json is text here'])
    expect(a.ok && a.switches.size).toBe(0)
  })

  it('treats -h as --help', () => {
    const a = parseArgs(['-h'])
    expect(a.ok && a.switches.has('--help')).toBe(true)
  })

  it('rejects unknown flags, missing values and values on switches', () => {
    expect(parseArgs(['timeline', '--verbose'])).toEqual({ ok: false, message: 'Unknown option "--verbose". Run `dayflow-electron help`.' })
    expect(parseArgs(['timeline', '--category'])).toEqual({ ok: false, message: '--category needs a value.' })
    expect(parseArgs(['timeline', '--json=yes'])).toEqual({ ok: false, message: '--json takes no value.' })
    expect(parseArgs(['timeline', '-x'])).toEqual({ ok: false, message: 'Unknown option "-x". Run `dayflow-electron help`.' })
  })

  it('takes no option as a flag value; a value starting with a dash goes after =', () => {
    expect(parseArgs(['timeline', 'update', '42', '--title', '--category', 'Work'])).toEqual({ ok: false, message: '--title needs a value; write --title=<value> for one starting with "-".' })
    expect(parseArgs(['timeline', '--category', '--json'])).toEqual({ ok: false, message: '--category needs a value; write --category=<value> for one starting with "-".' })
    expect(parseArgs(['timeline', '--title', '--'])).toMatchObject({ ok: false })
    const ok = parseArgs(['timeline', '--title=--draft'])
    expect(ok.ok && ok.values.get('--title')).toEqual(['--draft'])
  })

  it('has upstream exit codes, with "app not running" on its own code', () => {
    expect(EXIT).toEqual({ ok: 0, unexpected: 1, usage: 2, notFound: 3, editsDisabled: 4, noData: 5, appNotRunning: 6 })
  })
})
