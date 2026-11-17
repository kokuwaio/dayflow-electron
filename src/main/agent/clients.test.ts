import { describe, expect, it } from 'vitest'
import type { ProcessRunner, RunResult } from '../providers/cli/host'
import { type ClientEnv, type HostFiles, clientStatus, connectClient, disconnectClient, hostFiles, repairStaleRegistrations } from './clients'
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

const env = (runner: ProcessRunner): ClientEnv => ({
  runner,
  inFlatpak: true,
  appId: APP,
  home: '/home/me',
  configuredPath: '/home/me/.local/bin/codex',
  invocation,
  places: { platform: 'linux', home: '/home/me' },
  openExternal: async () => {}
})

/** Files in memory. */
function memoryFiles(initial: Record<string, string>, dirs: string[] = []) {
  const files = { ...initial }
  const host: HostFiles = {
    exists: async (path) => path in files || dirs.includes(path),
    read: async (path) => files[path] ?? null,
    write: async (path, text) => void (files[path] = text)
  }
  return { host, files }
}
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

  it('counts a Codex entry as connected only with the environment the CLI needs', async () => {
    const plain = cliInvocation({ execPath: '/opt/app/dayflow-electron', script: '/opt/app/cli.js' })
    const outside = (runner: ProcessRunner) => ({ ...env(runner), inFlatpak: false, invocation: plain })
    const transport = { type: 'stdio', command: '/opt/app/dayflow-electron', args: ['/opt/app/cli.js', 'mcp'] }
    const withEnv = fakeRunner((line) => (line.endsWith('--json') ? { stdout: JSON.stringify({ transport: { ...transport, env: { ELECTRON_RUN_AS_NODE: '1' } } }) } : {}))
    expect(await clientStatus('codex', outside(withEnv.runner))).toEqual({ state: 'connected' })
    const without = fakeRunner((line) => (line.endsWith('--json') ? { stdout: JSON.stringify({ transport }) } : {}))
    expect(await clientStatus('codex', outside(without.runner))).toEqual({ state: 'available' })
  })

  it('passes the client error on when adding fails, and disconnects', async () => {
    const failing = fakeRunner((line) => (line.includes('mcp add') ? { code: 1, stderr: 'warn\nError: config is read-only' } : {}))
    expect(await connectClient('claude', env(failing.runner))).toEqual({ state: 'failed', message: 'Error: config is read-only' })
    const gone = fakeRunner((line) => (line.includes('mcp get') ? { code: 1 } : {}))
    expect(await disconnectClient('claude', env(gone.runner))).toEqual({ state: 'available' })
  })
})

const DESKTOP = '/home/me/.config/Claude/claude_desktop_config.json'
const plain = cliInvocation({ execPath: '/opt/app/dayflow-electron', script: '/opt/app/cli.js' })
const PLAIN_ENTRY = { type: 'stdio', command: '/opt/app/dayflow-electron', args: ['/opt/app/cli.js', 'mcp'], env: { ELECTRON_RUN_AS_NODE: '1' } }
const ok = fakeRunner(() => ({}))
const outside = (files: HostFiles, runner: ProcessRunner = ok.runner): ClientEnv => ({ ...env(runner), inFlatpak: false, invocation: plain, files })

describe('Claude Desktop', () => {
  it('is not found without its config folder', async () => {
    expect(await clientStatus('claude-desktop', outside(memoryFiles({}).host))).toEqual({ state: 'notFound', message: 'Not found' })
  })

  it('merges the dayflow entry into its config and keeps the other servers', async () => {
    const { host, files } = memoryFiles({ [DESKTOP]: JSON.stringify({ mcpServers: { other: { command: 'x' } } }) }, ['/home/me/.config/Claude'])
    expect(await clientStatus('claude-desktop', outside(host))).toEqual({ state: 'available' })
    expect(await connectClient('claude-desktop', outside(host))).toEqual({ state: 'connected' })
    expect(JSON.parse(files[DESKTOP] ?? '')).toEqual({ mcpServers: { other: { command: 'x' }, dayflow: PLAIN_ENTRY } })
    expect(await clientStatus('claude-desktop', outside(host))).toEqual({ state: 'connected' })
    expect(await disconnectClient('claude-desktop', outside(host))).toEqual({ state: 'available' })
    expect(JSON.parse(files[DESKTOP] ?? '')).toEqual({ mcpServers: { other: { command: 'x' } } })
  })

  it('reports a config it cannot parse and leaves it alone', async () => {
    const { host, files } = memoryFiles({ [DESKTOP]: '{ broken' }, ['/home/me/.config/Claude'])
    expect(await clientStatus('claude-desktop', outside(host))).toMatchObject({ state: 'failed', message: expect.stringContaining("isn't valid JSON") })
    expect(await connectClient('claude-desktop', outside(host))).toMatchObject({ state: 'failed' })
    expect(files[DESKTOP]).toBe('{ broken')
  })

  it('shows the snippet to paste when the Flatpak may not reach the host', async () => {
    const { runner } = fakeRunner((line) => (line === 'flatpak-spawn --host true' ? { code: 1 } : {}))
    const state = await connectClient('claude-desktop', env(runner))
    expect(state).toMatchObject({ state: 'manual', message: expect.stringContaining(DESKTOP) })
    expect(state.state === 'manual' && JSON.parse(`{${state.command}}`).dayflow.command).toBe('flatpak')
  })

  it('reads and writes host files through flatpak-spawn inside the Flatpak', async () => {
    const { runner, calls } = fakeRunner((line) => (line.includes('exit 3') ? { stdout: '{}' } : {}))
    const files = hostFiles(runner, true)
    expect(await files.read(DESKTOP)).toBe('{}')
    await files.write(DESKTOP, '{"a":1}\n')
    expect(calls[0]).toBe(`flatpak-spawn --host sh -c [ -e "$1" ] || exit 3; cat "$1" sh ${DESKTOP}`)
    expect(calls[1]).toContain(`mv "$1.dayflow-tmp" "$1" sh ${DESKTOP}`)
    const missing = fakeRunner(() => ({ code: 3 }))
    expect(await hostFiles(missing.runner, true).read(DESKTOP)).toBeNull()
  })
})

describe('Cursor and VS Code', () => {
  it('detects them by their user folder and opens the install link', async () => {
    const opened: string[] = []
    const e = { ...outside(memoryFiles({}, ['/home/me/.cursor']).host), openExternal: async (url: string) => void opened.push(url) }
    expect(await clientStatus('cursor', e)).toEqual({ state: 'available' })
    expect(await clientStatus('vscode', e)).toEqual({ state: 'notFound', message: 'Not found' })
    expect(await connectClient('cursor', e)).toEqual({ state: 'openedInstaller' })
    expect(opened[0]).toMatch(/^cursor:\/\/anysphere\.cursor-deeplink\/mcp\/install\?name=dayflow&config=/)
    await connectClient('vscode', e)
    expect(opened[1]).toMatch(/^vscode:mcp\/install\?/)
  })

  it('offers the link inside the Flatpak even when it cannot look', async () => {
    const { runner } = fakeRunner((line) => (line === 'flatpak-spawn --host true' ? { code: 1 } : {}))
    expect(await clientStatus('vscode', env(runner))).toEqual({ state: 'available' })
  })

  it('reports a link the desktop could not open', async () => {
    const e = { ...env(ok.runner), openExternal: async () => Promise.reject(new Error('no handler')) }
    expect(await connectClient('vscode', e)).toEqual({ state: 'failed', message: 'Could not open VS Code: no handler' })
  })
})

describe('stale registrations at launch', () => {
  it('rewrites Claude Desktop and re-adds Claude Code and Codex entries that point at an old copy', async () => {
    const old = { command: 'env', args: ['ELECTRON_RUN_AS_NODE=1', '/old/electron', '/old/cli.js', 'mcp'] }
    const { host, files } = memoryFiles({
      [DESKTOP]: JSON.stringify({ mcpServers: { dayflow: old, other: { command: 'x' } } }),
      '/home/me/.claude.json': JSON.stringify({ mcpServers: { dayflow: old } })
    })
    let codexAdded = false
    const { runner, calls } = fakeRunner((line) => {
      if (line.includes('codex mcp add')) codexAdded = true
      if (line.endsWith('codex mcp get dayflow --json')) return { stdout: JSON.stringify({ transport: codexAdded ? PLAIN_ENTRY : old }) }
      return {}
    })
    const report = await repairStaleRegistrations((client) => ({ ...outside(host, runner), configuredPath: `/usr/bin/${client === 'codex' ? 'codex' : 'claude'}` }))
    expect(JSON.parse(files[DESKTOP] ?? '')).toEqual({ mcpServers: { dayflow: PLAIN_ENTRY, other: { command: 'x' } } })
    expect(calls.some((c) => c.includes('claude mcp add --scope user dayflow -e ELECTRON_RUN_AS_NODE=1 -- /opt/app/dayflow-electron /opt/app/cli.js mcp'))).toBe(true)
    expect(calls.some((c) => c.includes('codex mcp add dayflow --env ELECTRON_RUN_AS_NODE=1 -- /opt/app/dayflow-electron'))).toBe(true)
    expect(report).toEqual([
      'repaired the stale Claude Desktop registration',
      'repaired the stale Claude Code registration',
      'repaired the stale Codex registration'
    ])
  })

  it('leaves current, missing and unparsable entries alone, and skips the Flatpak', async () => {
    const { host, files } = memoryFiles({ [DESKTOP]: JSON.stringify({ mcpServers: { dayflow: PLAIN_ENTRY } }), '/home/me/.claude.json': '{ broken' })
    const { runner, calls } = fakeRunner((line) => (line.includes('mcp get') ? { code: 1 } : {}))
    expect(await repairStaleRegistrations(() => outside(host, runner))).toEqual([])
    expect(calls.some((c) => c.includes('mcp add'))).toBe(false)
    expect(files['/home/me/.claude.json']).toBe('{ broken')
    const inside = fakeRunner(() => ({}))
    expect(await repairStaleRegistrations(() => env(inside.runner))).toEqual([])
    expect(inside.calls).toEqual([])
  })
})
