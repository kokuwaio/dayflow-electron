import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
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

describe('dayflow-electron link', () => {
  it('writes the POSIX wrapper on Linux', () => {
    expect(terminalCommand(false, env('linux')).at(-1)).toContain('not on your PATH')
    expect(existsSync(join(home, '.local/bin/dayflow-electron'))).toBe(true)
  })

  it.skipIf(process.platform === 'win32')('writes to /usr/local/bin on macOS when it may, else shows the sudo command', () => {
    const bin = join(home, 'usr-local-bin')
    expect(terminalCommand(false, { ...env('darwin'), path: bin, binDir: bin }).at(-1)).toContain('Installed')
    expect(existsSync(join(bin, 'dayflow-electron'))).toBe(true)
    rmSync(bin, { recursive: true, force: true })

    // A folder only root may write to, like /usr/local/bin without Homebrew.
    const lockedDir = join(home, 'locked')
    mkdirSync(lockedDir, { mode: 0o555 })
    const locked = { ...env('darwin'), binDir: join(lockedDir, 'bin') }
    const lines = terminalCommand(false, locked)
    expect(lines.join('\n')).toMatch(/administrator/)
    expect(lines.join('\n')).toContain('sudo mkdir -p /usr/local/bin')
    chmodSync(lockedDir, 0o755)

    // Installed earlier through sudo: removing it needs sudo too.
    const installed = join(home, 'installed')
    terminalCommand(false, { ...env('darwin'), binDir: installed })
    chmodSync(installed, 0o555)
    expect(terminalCommand(true, { ...env('darwin'), binDir: installed }).join('\n')).toContain('sudo rm -f /usr/local/bin/dayflow-electron')
    chmodSync(installed, 0o755)
  })

  it('refuses on Windows, where a shell script is no command', () => {
    expect(() => terminalCommand(false, env('win32'))).toThrow(/Linux and macOS/)
    expect(() => terminalCommand(true, env('win32'))).toThrow(/Linux and macOS/)
    expect(existsSync(join(home, '.local'))).toBe(false)
  })
})
