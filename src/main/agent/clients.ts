// Connects AI tools to the MCP server, after upstream Dayflow
// (Core/AgentAccess/AgentClientRegistration.swift, CodexMCPRegistration.swift).
// - Claude Code and Codex: their own `mcp add` command on the host. Upstream
//   edits ~/.claude.json directly; the CLI keeps Claude Code's own writes safe.
// - Claude Desktop: the "dayflow" entry merged into claude_desktop_config.json,
//   like upstream. A config that does not parse is reported, never rewritten.
// - Cursor and VS Code: install deep links; they write their own config after
//   their own consent dialog, so whether they are connected is unknown.
// The Flatpak has no home access: files and CLIs are reached through
// `flatpak-spawn --host`, and without that permission the window shows the
// command or snippet to copy instead. Install links go through the portal.

import { access, chmod, mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { AgentClient, AgentClientState, CliName } from '../../shared/types'
import { type ProcessRunner, findCli, hostAccess, hostCommand } from '../providers/cli/host'
import { AGENT_CLIENT_NAMES } from '../../shared/agent-clients'
import { type ClientPlaces, type DeepLinkClient, claudeDesktopConfigPath, cursorInstallUrl, deepLinkMarkers, entryMatches, mergeServerEntry, readServerEntry, removeServerEntry, vscodeInstallUrl, pathFor } from './client-config'
import { type Invocation, manualConfigSnippet, mcpRegistration, shellLine } from './invocation'
import { errorMessage } from '../../shared/errors'

/** Files on the host: directly outside the Flatpak, through `flatpak-spawn --host` inside it. */
export interface HostFiles {
  exists(path: string): Promise<boolean>
  /** The file's text, or null when it does not exist. */
  read(path: string): Promise<string | null>
  /** Replaces the file atomically, creating its folder. */
  write(path: string, text: string): Promise<void>
}

export interface ClientEnv {
  runner: ProcessRunner
  inFlatpak: boolean
  appId: string
  home: string
  /** The CLI path from Settings → AI provider, if any. */
  configuredPath: string
  invocation: Invocation
  /** Where the clients keep their files on this OS. */
  places: ClientPlaces
  /** Opens an install link (Electron's shell.openExternal; the OpenURI portal in the Flatpak). */
  openExternal: (url: string) => Promise<void>
  /** Defaults to hostFiles(runner, inFlatpak). */
  files?: HostFiles
}

export function hostFiles(runner: ProcessRunner, inFlatpak: boolean): HostFiles {
  if (!inFlatpak) {
    return {
      exists: (path) => access(path).then(() => true, () => false),
      read: (path) =>
        readFile(path, 'utf8').catch((err: NodeJS.ErrnoException) => {
          if (err.code === 'ENOENT') return null
          throw err
        }),
      async write(path, text) {
        await mkdir(dirname(path), { recursive: true })
        // Through a symlinked config to its file, keeping the file's permissions (it may hold tokens).
        const target = await realpath(path).catch(() => path)
        const mode = await stat(target).then((s) => s.mode & 0o777, () => 0o600)
        const tmp = `${target}.dayflow-tmp`
        await writeFile(tmp, text, { mode })
        await chmod(tmp, mode)
        await rename(tmp, target)
      }
    }
  }
  const sh = async (script: string, path: string, input?: string) => {
    const c = hostCommand(true, 'sh', ['-c', script, 'sh', path])
    return runner.run(c.command, c.args, { timeoutMs: 15_000, ...(input === undefined ? {} : { input }) })
  }
  return {
    exists: async (path) => (await sh('test -e "$1"', path)).code === 0,
    async read(path) {
      const r = await sh('[ -e "$1" ] || exit 3; cat "$1"', path)
      if (r.code === 3) return null
      if (r.code !== 0) throw new Error(r.stderr.trim() || `Could not read ${path}.`)
      return r.stdout
    },
    async write(path, text) {
      // A symlinked config is written through in place; otherwise a copy keeps the
      // file's permissions (cp -p) before it replaces the original.
      const r = await sh(
        'mkdir -p "$(dirname "$1")" && if [ -L "$1" ]; then cat > "$1"; else { [ ! -e "$1" ] || cp -p "$1" "$1.dayflow-tmp"; } && cat > "$1.dayflow-tmp" && mv "$1.dayflow-tmp" "$1"; fi',
        path,
        text
      )
      if (r.code !== 0) throw new Error(r.stderr.trim() || `Could not write ${path}.`)
    }
  }
}

const filesOf = (env: ClientEnv) => env.files ?? hostFiles(env.runner, env.inFlatpak)

// ---- Claude Code and Codex: their own CLI

type Run = (args: string[]) => Promise<{ code: number | null; stdout: string; stderr: string }>

/** A way to run the client's CLI on the host, or the state to show when there is none. */
async function locate(client: CliName, env: ClientEnv, args: string[]): Promise<Run | AgentClientState> {
  const access = await hostAccess(env.runner, env.inFlatpak, env.appId)
  if (!access.ok) {
    return { state: 'manual', message: `${access.reason} Or run this in a terminal to connect ${AGENT_CLIENT_NAMES[client]}:`, command: shellLine([client, ...args]) }
  }
  const location = await findCli(env.runner, client, { inFlatpak: env.inFlatpak, home: env.home, configuredPath: env.configuredPath })
  if (!location) return { state: 'notFound', message: 'Not found' }
  const [shell, flags] = location.shell
  return (cliArgs) => {
    // Through the shell that found it, so the CLI finds node and friends on PATH.
    const c = hostCommand(env.inFlatpak, shell, [flags, 'exec "$0" "$@"', location.path, ...cliArgs])
    return env.runner.run(c.command, c.args, { timeoutMs: 60_000 })
  }
}

const lastLine = (text: string) => text.trim().split('\n').pop()?.trim().slice(0, 300) || ''

/** Codex reports the registered command; an entry for another path (an old install) counts as not connected. */
function codexMatches(stdout: string, inv: Invocation): boolean {
  try {
    const entry = JSON.parse(stdout) as { transport?: unknown }
    return entryMatches(entry.transport ?? entry, inv)
  } catch {
    return false
  }
}

/** Whether the client has the entry; "stale" when it has one for another copy of the app. */
async function check(client: CliName, run: Run, inv: Invocation): Promise<'connected' | 'available' | 'stale'> {
  const r = await run(mcpRegistration(client, inv).get)
  if (r.code !== 0) return 'available'
  return client === 'codex' && !codexMatches(r.stdout, inv) ? 'stale' : 'connected'
}

// Upstream shows a stale entry as "Connect" too; connecting replaces it.
const shown = (found: 'connected' | 'available' | 'stale'): AgentClientState => ({ state: found === 'connected' ? 'connected' : 'available' })

async function cliStatus(client: CliName, env: ClientEnv): Promise<AgentClientState> {
  const run = await locate(client, env, mcpRegistration(client, env.invocation).add)
  if (typeof run !== 'function') return run
  return shown(await check(client, run, env.invocation))
}

async function cliConnect(client: CliName, env: ClientEnv): Promise<AgentClientState> {
  const reg = mcpRegistration(client, env.invocation)
  const run = await locate(client, env, reg.add)
  if (typeof run !== 'function') return run
  // Replace only our own "dayflow" entry, so a stale path gets repaired.
  await run(reg.remove)
  const added = await run(reg.add)
  if (added.code !== 0) return { state: 'failed', message: lastLine(added.stderr) || lastLine(added.stdout) || `${AGENT_CLIENT_NAMES[client]} could not add the connection.` }
  const after = await check(client, run, env.invocation)
  return after === 'connected' ? { state: 'connected' } : { state: 'failed', message: `${AGENT_CLIENT_NAMES[client]} didn't keep the Dayflow connection.` }
}

async function cliDisconnect(client: CliName, env: ClientEnv): Promise<AgentClientState> {
  const reg = mcpRegistration(client, env.invocation)
  const run = await locate(client, env, reg.remove)
  if (typeof run !== 'function') return run
  const removed = await run(reg.remove)
  const after = await check(client, run, env.invocation)
  if (after === 'connected') {
    return { state: 'failed', message: lastLine(removed.stderr) || `${AGENT_CLIENT_NAMES[client]} kept the connection.` }
  }
  return shown(after)
}

// ---- Claude Desktop: its JSON config

const DESKTOP_FILE = 'claude_desktop_config.json'

/** The config path, or the snippet to paste when the Flatpak may not reach it. */
async function desktopConfig(env: ClientEnv): Promise<string | AgentClientState> {
  const path = claudeDesktopConfigPath(env.places)
  const access = await hostAccess(env.runner, env.inFlatpak, env.appId)
  if (!access.ok) {
    return {
      state: 'manual',
      message: `${access.reason} Or add this under "mcpServers" in ${path}, then restart Claude Desktop:`,
      command: manualConfigSnippet(env.invocation)
    }
  }
  return path
}

async function desktopStatus(env: ClientEnv): Promise<AgentClientState> {
  const path = await desktopConfig(env)
  if (typeof path !== 'string') return path
  const files = filesOf(env)
  try {
    if (!(await files.exists(pathFor(env.places.platform).dirname(path)))) return { state: 'notFound', message: 'Not found' }
    const read = readServerEntry(await files.read(path), DESKTOP_FILE)
    if (!read.ok) return { state: 'failed', message: read.error }
    // An entry for another copy of the app counts as not connected; connecting replaces it.
    return entryMatches(read.entry, env.invocation) ? { state: 'connected' } : { state: 'available' }
  } catch (err) {
    return { state: 'failed', message: errorMessage(err) }
  }
}

async function desktopWrite(env: ClientEnv, change: (text: string | null) => ReturnType<typeof mergeServerEntry> | ReturnType<typeof removeServerEntry>, done: AgentClientState): Promise<AgentClientState> {
  const path = await desktopConfig(env)
  if (typeof path !== 'string') return path
  const files = filesOf(env)
  try {
    const before = await files.read(path)
    const next = change(before)
    if (!next.ok) return { state: 'failed', message: next.error }
    if (next.text !== null && next.text !== before) await files.write(path, next.text)
    return done
  } catch (err) {
    return { state: 'failed', message: `Could not update ${DESKTOP_FILE}: ${errorMessage(err)}` }
  }
}

// ---- Cursor and VS Code: install links

async function linkStatus(client: DeepLinkClient, env: ClientEnv): Promise<AgentClientState> {
  // Without host access the Flatpak cannot look; the link still opens through the portal.
  if (!(await hostAccess(env.runner, env.inFlatpak, env.appId)).ok) return { state: 'available' }
  const files = filesOf(env)
  for (const marker of deepLinkMarkers(client, env.places)) {
    if (await files.exists(marker).catch(() => false)) return { state: 'available' }
  }
  return { state: 'notFound', message: 'Not found' }
}

async function linkConnect(client: DeepLinkClient, env: ClientEnv): Promise<AgentClientState> {
  const url = client === 'cursor' ? cursorInstallUrl(env.invocation) : vscodeInstallUrl(env.invocation)
  try {
    await env.openExternal(url)
    return { state: 'openedInstaller' }
  } catch (err) {
    return { state: 'failed', message: `Could not open ${AGENT_CLIENT_NAMES[client]}: ${errorMessage(err)}` }
  }
}

// ---- the IPC entry points

const isCli = (client: AgentClient): client is CliName => client === 'claude' || client === 'codex'

export function clientStatus(client: AgentClient, env: ClientEnv): Promise<AgentClientState> {
  if (isCli(client)) return cliStatus(client, env)
  if (client === 'claude-desktop') return desktopStatus(env)
  return linkStatus(client, env)
}

export function connectClient(client: AgentClient, env: ClientEnv): Promise<AgentClientState> {
  if (isCli(client)) return cliConnect(client, env)
  if (client === 'claude-desktop') return desktopWrite(env, (text) => mergeServerEntry(text, env.invocation, DESKTOP_FILE), { state: 'connected' })
  return linkConnect(client, env)
}

export function disconnectClient(client: AgentClient, env: ClientEnv): Promise<AgentClientState> {
  if (isCli(client)) return cliDisconnect(client, env)
  if (client === 'claude-desktop') return desktopWrite(env, (text) => removeServerEntry(text, DESKTOP_FILE), { state: 'available' })
  // Cursor and VS Code own their config; the entry is removed in their UI.
  return linkStatus(client, env)
}

/**
 * Upstream's repairStaleRegistrations(), run at launch: configs record the
 * path of the app, which goes stale when it moves or updates to another
 * folder. Rewrites only "dayflow" entries that exist and point elsewhere.
 * The Flatpak's `flatpak run` command never goes stale, so it skips this.
 * Returns one line per repaired or failed client, for the log.
 */
export async function repairStaleRegistrations(envFor: (client: AgentClient) => ClientEnv): Promise<string[]> {
  const base = envFor('claude-desktop')
  if (base.inFlatpak) return []
  const files = filesOf(base)
  const report: string[] = []
  const note = (client: AgentClient, state: AgentClientState) =>
    report.push(state.state === 'connected' ? `repaired the stale ${AGENT_CLIENT_NAMES[client]} registration` : `could not repair the ${AGENT_CLIENT_NAMES[client]} registration: ${'message' in state ? state.message : state.state}`)
  const staleIn = async (path: string) => {
    const read = readServerEntry(await files.read(path).catch(() => null))
    return read.ok && read.entry !== null && !entryMatches(read.entry, base.invocation)
  }

  if (await staleIn(claudeDesktopConfigPath(base.places))) note('claude-desktop', await connectClient('claude-desktop', base))
  // Claude Code keeps user-scope servers in ~/.claude.json; its CLI rewrites the entry.
  if (await staleIn(pathFor(base.places.platform).join(base.home, '.claude.json'))) note('claude', await connectClient('claude', envFor('claude')))
  const codex = envFor('codex')
  const run = await locate('codex', codex, [])
  if (typeof run === 'function' && (await check('codex', run, codex.invocation)) === 'stale') note('codex', await connectClient('codex', codex))
  return report
}
