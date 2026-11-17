import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { terminalCommand } from './link'

const home = mkdtempSync(join(tmpdir(), 'dayflow-link-'))
afterEach(() => rmSync(join(home, '.local'), { recursive: true, force: true }))
const env = (platform: NodeJS.Platform) => ({
  platform,
  inFlatpak: false,
  home,
  path: '',
  invocation: { command: '/opt/Dayflow/dayflow', args: ['cli.js'], env: { ELECTRON_RUN_AS_NODE: '1' } }
})

describe('dayflow link', () => {
  it('writes the POSIX wrapper on Linux', () => {
    expect(terminalCommand(false, env('linux')).at(-1)).toContain('not on your PATH')
    expect(existsSync(join(home, '.local/bin/dayflow'))).toBe(true)
  })

  it('refuses on Windows, where a shell script is no command', () => {
    expect(() => terminalCommand(false, env('win32'))).toThrow(/Linux and macOS/)
    expect(() => terminalCommand(true, env('win32'))).toThrow(/Linux and macOS/)
    expect(existsSync(join(home, '.local'))).toBe(false)
  })
})
