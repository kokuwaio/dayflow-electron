import { describe, expect, it } from 'vitest'
import { type ProcessRunner, type RunResult, findCli, hostAccess, hostCommand } from './host'

/** A runner that answers by matching the command line, and records every call. */
function fakeRunner(answer: (line: string) => Partial<RunResult>) {
  const calls: string[] = []
  const runner: ProcessRunner = {
    async run(command, args) {
      const line = [command, ...args].join(' ')
      calls.push(line)
      return { code: 0, stdout: '', stderr: '', timedOut: false, ...answer(line) }
    }
  }
  return { runner, calls }
}

describe('hostCommand', () => {
  it('runs host programs through flatpak-spawn inside the sandbox and directly outside', () => {
    expect(hostCommand(true, 'claude', ['-p'])).toEqual({ command: 'flatpak-spawn', args: ['--host', 'claude', '-p'] })
    expect(hostCommand(false, 'claude', ['-p'])).toEqual({ command: 'claude', args: ['-p'] })
  })
})

describe('hostAccess', () => {
  it('is always granted outside the sandbox', async () => {
    const { runner, calls } = fakeRunner(() => ({}))
    expect(await hostAccess(runner, false, 'io.example.App')).toEqual({ ok: true })
    expect(calls).toEqual([])
  })

  it('is granted when flatpak-spawn can start a host program', async () => {
    const { runner, calls } = fakeRunner(() => ({ code: 0 }))
    expect(await hostAccess(runner, true, 'io.example.App')).toEqual({ ok: true })
    expect(calls).toEqual(['flatpak-spawn --host true'])
  })

  it('explains the one-time opt-in when the sandbox may not start host programs', async () => {
    const { runner } = fakeRunner(() => ({ code: 1, stderr: 'Portal call failed: org.freedesktop.DBus.Error.ServiceUnknown' }))
    const result = await hostAccess(runner, true, 'io.example.App')
    expect(result.ok).toBe(false)
    expect(!result.ok && result.reason).toContain('flatpak override --user --talk-name=org.freedesktop.Flatpak io.example.App')
  })
})

describe('findCli', () => {
  const env = { inFlatpak: true, home: '/home/me' }

  it('uses a configured path when it is executable', async () => {
    const { runner, calls } = fakeRunner((l) => (l.includes('test -x /opt/claude') ? { code: 0 } : { code: 1 }))
    expect(await findCli(runner, 'claude', { ...env, configuredPath: '/opt/claude' })).toEqual({ path: '/opt/claude', shell: ['sh', '-lc'] })
    expect(calls).toEqual(['flatpak-spawn --host test -x /opt/claude'])
  })

  it('asks the login shells, and starts the CLI later through the shell that found it', async () => {
    const { runner } = fakeRunner((l) =>
      l.includes("zsh -lic") ? { code: 0, stdout: 'some motd\n/home/me/.local/share/mise/installs/claude-code/latest/claude\n' } : { code: 1 }
    )
    expect(await findCli(runner, 'claude', env)).toEqual({
      path: '/home/me/.local/share/mise/installs/claude-code/latest/claude',
      shell: ['zsh', '-lic']
    })
  })

  it('falls back to well-known install locations', async () => {
    const { runner } = fakeRunner((l) => (l.endsWith('test -x /home/me/.claude/local/claude') ? { code: 0 } : { code: 1 }))
    expect(await findCli(runner, 'claude', env)).toEqual({ path: '/home/me/.claude/local/claude', shell: ['sh', '-lc'] })
  })

  it('returns null when the CLI is nowhere', async () => {
    const { runner } = fakeRunner(() => ({ code: 1 }))
    expect(await findCli(runner, 'codex', env)).toBeNull()
  })
})
