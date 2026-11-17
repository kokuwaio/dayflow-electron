import { describe, expect, it } from 'vitest'
import type { ProcessRunner, RunResult } from '../providers/cli/host'
import { clientStatus, connectClient, disconnectClient } from './clients'
import { cliInvocation } from './invocation'

const APP = 'io.github.kokuwaio.DayflowElectron'
const invocation = cliInvocation({ flatpakId: APP, execPath: '', script: '' })

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

const env = (runner: ProcessRunner) => ({ runner, inFlatpak: true, appId: APP, home: '/home/me', configuredPath: '/home/me/.local/bin/codex', invocation })
const CLI = 'flatpak-spawn --host sh -lc exec "$0" "$@" /home/me/.local/bin/codex'

describe('MCP client registration', () => {
  it('shows the command to copy when the sandbox may not run host programs', async () => {
    const { runner, calls } = fakeRunner((line) => (line === 'flatpak-spawn --host true' ? { code: 1 } : {}))
    const state = await connectClient('claude', env(runner))
    expect(state).toMatchObject({
      state: 'manual',
      command: `claude mcp add --scope user dayflow -- flatpak run --command=dayflow-cli ${APP} mcp`
    })
    expect(calls).toEqual(['flatpak-spawn --host true'])
  })

  it('reports a missing CLI', async () => {
    const { runner } = fakeRunner((line) => (line.includes('test -x') ? { code: 1 } : {}))
    expect(await clientStatus('codex', env(runner))).toEqual({ state: 'notFound', message: 'Not found' })
  })

  it('replaces the dayflow entry with codex mcp add and checks that it stuck', async () => {
    const entry = JSON.stringify({ name: 'dayflow', transport: { type: 'stdio', command: 'flatpak', args: ['run', '--command=dayflow-cli', APP, 'mcp'] } })
    const { runner, calls } = fakeRunner((line) => (line.endsWith('mcp get dayflow --json') ? { stdout: entry } : {}))
    expect(await connectClient('codex', env(runner))).toEqual({ state: 'connected' })
    expect(calls.filter((c) => c.startsWith(CLI)).map((c) => c.slice(CLI.length + 1))).toEqual([
      'mcp remove dayflow',
      `mcp add dayflow -- flatpak run --command=dayflow-cli ${APP} mcp`,
      'mcp get dayflow --json'
    ])
  })

  it('treats a Codex entry pointing elsewhere as not connected', async () => {
    const stale = JSON.stringify({ transport: { command: '/old/dayflow', args: ['mcp'] } })
    const { runner } = fakeRunner((line) => (line.endsWith('--json') ? { stdout: stale } : {}))
    expect(await clientStatus('codex', env(runner))).toEqual({ state: 'available' })
  })

  it('passes the client error on when adding fails, and disconnects', async () => {
    const failing = fakeRunner((line) => (line.includes('mcp add') ? { code: 1, stderr: 'warn\nError: config is read-only' } : {}))
    expect(await connectClient('claude', env(failing.runner))).toEqual({ state: 'failed', message: 'Error: config is read-only' })
    const gone = fakeRunner((line) => (line.includes('mcp get') ? { code: 1 } : {}))
    expect(await disconnectClient('claude', env(gone.runner))).toEqual({ state: 'available' })
  })
})
