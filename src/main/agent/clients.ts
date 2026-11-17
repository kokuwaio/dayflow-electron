// Connects Claude Code and Codex to the MCP server, after upstream Dayflow
// (Core/AgentAccess/AgentClientRegistration.swift, CodexMCPRegistration.swift).
// Upstream edits ~/.claude.json directly; the Flatpak has no home access, so
// both clients are registered with their own `mcp add` command on the host.
// Without host access the window shows that command to copy instead. These
// are the only commands this module runs.

import type { AgentClientState, CliName } from '../../shared/types'
import { type ProcessRunner, findCli, hostAccess, hostCommand } from '../providers/cli/host'
import { type Invocation, mcpRegistration, shellLine } from './invocation'

export interface ClientEnv {
  runner: ProcessRunner
  inFlatpak: boolean
  appId: string
  home: string
  /** The CLI path from Settings → AI provider, if any. */
  configuredPath: string
  invocation: Invocation
}

const NAMES: Record<CliName, string> = { claude: 'Claude Code', codex: 'Codex' }

type Run = (args: string[]) => Promise<{ code: number | null; stdout: string; stderr: string }>

/** A way to run the client's CLI on the host, or the state to show when there is none. */
async function locate(client: CliName, env: ClientEnv, args: string[]): Promise<Run | AgentClientState> {
  const access = await hostAccess(env.runner, env.inFlatpak, env.appId)
  if (!access.ok) return { state: 'manual', message: access.reason, command: shellLine([client, ...args]) }
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
    const entry = JSON.parse(stdout) as { transport?: { command?: unknown; args?: unknown }; command?: unknown; args?: unknown }
    const t = entry.transport ?? entry
    return t.command === inv.command && JSON.stringify(t.args) === JSON.stringify([...inv.args, 'mcp'])
  } catch {
    return false
  }
}

async function check(client: CliName, run: Run, inv: Invocation): Promise<AgentClientState> {
  const r = await run(mcpRegistration(client, inv).get)
  if (r.code !== 0) return { state: 'available' }
  return client === 'codex' && !codexMatches(r.stdout, inv) ? { state: 'available' } : { state: 'connected' }
}

export async function clientStatus(client: CliName, env: ClientEnv): Promise<AgentClientState> {
  const run = await locate(client, env, mcpRegistration(client, env.invocation).add)
  return typeof run === 'function' ? check(client, run, env.invocation) : run
}

export async function connectClient(client: CliName, env: ClientEnv): Promise<AgentClientState> {
  const reg = mcpRegistration(client, env.invocation)
  const run = await locate(client, env, reg.add)
  if (typeof run !== 'function') return run
  // Replace only our own "dayflow" entry, so a stale path gets repaired.
  await run(reg.remove)
  const added = await run(reg.add)
  if (added.code !== 0) return { state: 'failed', message: lastLine(added.stderr) || lastLine(added.stdout) || `${NAMES[client]} could not add the connection.` }
  const after = await check(client, run, env.invocation)
  return after.state === 'connected' ? after : { state: 'failed', message: `${NAMES[client]} didn't keep the Dayflow connection.` }
}

export async function disconnectClient(client: CliName, env: ClientEnv): Promise<AgentClientState> {
  const reg = mcpRegistration(client, env.invocation)
  const run = await locate(client, env, reg.remove)
  if (typeof run !== 'function') return run
  const removed = await run(reg.remove)
  const after = await check(client, run, env.invocation)
  if (after.state === 'connected') {
    return { state: 'failed', message: lastLine(removed.stderr) || `${NAMES[client]} kept the connection.` }
  }
  return after
}
