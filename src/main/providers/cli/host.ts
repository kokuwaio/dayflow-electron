// Running the user's agent CLIs (claude, codex) on the host. Inside the
// Flatpak they start through `flatpak-spawn --host`, which needs the opt-in
// permission org.freedesktop.Flatpak (it lets the app run any host program,
// so the manifest does not request it).

import { spawn } from 'node:child_process'
import type { CliName } from '../../../shared/types'

export type { CliName }

export interface RunResult {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

export interface RunOptions {
  input?: string
  timeoutMs?: number
  env?: NodeJS.ProcessEnv
}

export interface ProcessRunner {
  run(command: string, args: string[], options?: RunOptions): Promise<RunResult>
}

/** Runs a process to completion, collecting its output. */
export const nodeRunner: ProcessRunner = {
  run(command, args, options = {}) {
    return new Promise((resolve) => {
      const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], env: options.env ?? process.env })
      let stdout = ''
      let stderr = ''
      let timedOut = false
      let settled = false
      const finish = (code: number | null) => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        resolve({ code, stdout, stderr, timedOut })
      }
      // SIGTERM first, SIGKILL if the process ignores it.
      const timer = options.timeoutMs
        ? setTimeout(() => {
            timedOut = true
            child.kill('SIGTERM')
            setTimeout(() => child.kill('SIGKILL'), 5_000).unref()
          }, options.timeoutMs)
        : null
      child.stdout.on('data', (d) => (stdout += d))
      child.stderr.on('data', (d) => (stderr += d))
      child.on('error', (err) => {
        stderr += err.message
      })
      child.on('close', (code) => finish(code))
      // A grandchild may keep the pipes open after the process exited.
      child.on('exit', (code) => setTimeout(() => finish(code), 2_000).unref())
      child.stdin.on('error', () => {})
      child.stdin.end(options.input ?? '')
    })
  }
}

export function hostCommand(inFlatpak: boolean, command: string, args: string[]): { command: string; args: string[] } {
  return inFlatpak ? { command: 'flatpak-spawn', args: ['--host', command, ...args] } : { command, args }
}

export type HostAccess = { ok: true } | { ok: false; reason: string }

export async function hostAccess(runner: ProcessRunner, inFlatpak: boolean, appId: string): Promise<HostAccess> {
  if (!inFlatpak) return { ok: true }
  const r = await runner.run('flatpak-spawn', ['--host', 'true'], { timeoutMs: 10_000 })
  if (r.code === 0) return { ok: true }
  return {
    ok: false,
    reason: `The app may not start programs outside its sandbox. To use agent CLIs, run "flatpak override --user --talk-name=org.freedesktop.Flatpak ${appId}" once, then restart the app.`
  }
}

/** Where the CLIs are commonly installed, relative to the home directory. */
const KNOWN_LOCATIONS: Record<CliName, string[]> = {
  claude: ['.claude/local/claude', '.local/bin/claude', '.npm-global/bin/claude', '.bun/bin/claude', '.local/share/mise/shims/claude'],
  codex: ['.local/bin/codex', '.npm-global/bin/codex', '.bun/bin/codex', '.local/share/mise/shims/codex', '.cargo/bin/codex']
}

/** A found CLI and the shell to start it through (so its PATH matches). */
export interface CliLocation {
  path: string
  shell: [string, string]
}

/**
 * Finds a CLI on the host: the configured path, then the login shells (so
 * mise, nvm or npm prefixes from the user's profile apply), then well-known
 * install locations.
 */
export async function findCli(
  runner: ProcessRunner,
  name: CliName,
  env: { inFlatpak: boolean; home: string; configuredPath?: string }
): Promise<CliLocation | null> {
  const onHost = (command: string, args: string[]) => {
    const c = hostCommand(env.inFlatpak, command, args)
    return runner.run(c.command, c.args, { timeoutMs: 15_000 })
  }
  const executable = async (path: string) => (await onHost('test', ['-x', path])).code === 0
  const viaSh = (path: string): CliLocation => ({ path, shell: ['sh', '-lc'] })

  if (env.configuredPath?.trim()) {
    const path = env.configuredPath.trim()
    return (await executable(path)) ? viaSh(path) : null
  }
  for (const shell of [
    ['sh', '-lc'],
    ['zsh', '-lic'],
    ['bash', '-lic']
  ] as Array<[string, string]>) {
    const r = await onHost(shell[0], [shell[1], `command -v ${name}`])
    // Interactive shells may print banners first; the path is the last line.
    const path = r.stdout.trim().split('\n').pop()?.trim() ?? ''
    if (r.code === 0 && path.startsWith('/')) return { path, shell }
  }
  for (const rel of KNOWN_LOCATIONS[name]) {
    const path = `${env.home}/${rel}`
    if (await executable(path)) return viaSh(path)
  }
  return null
}
