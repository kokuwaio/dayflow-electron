// Signs Claude Code or Codex back in from inside the app, after upstream
// Dayflow (System/ProviderSignIn.swift, ProviderAvailability.swift's
// ProviderHealthCheck). It runs the CLI's own login command on the host (the
// CLI opens the browser), asks the CLI every few seconds whether it is signed
// in, and gives up after ten minutes. Inside the Flatpak the commands start
// through `flatpak-spawn --host` like every other CLI call.

import { spawn } from 'node:child_process'
import type { CliName, SignInState } from '../../../shared/types'
import { type CliLocation, type ProcessRunner, findCli, hostAccess, hostCommand } from './host'

export const loginArgs = (cli: CliName): string[] => (cli === 'claude' ? ['auth', 'login'] : ['login'])
export const statusArgs = (cli: CliName): string[] => (cli === 'claude' ? ['auth', 'status'] : ['login', 'status'])

/** Whether the CLI says it is signed in; null when it cannot tell (an old version, a timeout). */
export function parseSignedIn(cli: CliName, result: { stdout: string; stderr: string; code: number | null }): boolean | null {
  if (cli === 'claude') {
    // Prints JSON such as {"loggedIn": true, ...}; a shell banner may come first.
    for (const line of result.stdout.split('\n').reverse()) {
      try {
        const parsed = JSON.parse(line.trim())
        if (typeof parsed?.loggedIn === 'boolean') return parsed.loggedIn
      } catch {
        // not the JSON line
      }
    }
    try {
      const parsed = JSON.parse(result.stdout)
      if (typeof parsed?.loggedIn === 'boolean') return parsed.loggedIn
    } catch {
      // nothing to read
    }
    return null
  }
  const output = `${result.stdout}\n${result.stderr}`.toLowerCase()
  if (output.includes('not logged in')) return false
  if (result.code === 0 && output.includes('logged in')) return true
  return null
}

export type SignInVerdict = 'done' | 'failed' | 'waiting'

/**
 * Upstream's rules: done when the CLI turns signed in; when it looked signed
 * in before (a login that can no longer be refreshed still does), only the
 * login command finishing cleanly counts. An old CLI that cannot report its
 * state is trusted on its exit code.
 */
export function signInVerdict(s: { signedInBefore: boolean; signedIn: boolean | null; ended: boolean; exitCode: number | null; timedOut: boolean }): SignInVerdict {
  if (s.signedIn === true && !s.signedInBefore) return 'done'
  if (s.ended) return s.signedIn !== false && s.exitCode === 0 ? 'done' : 'failed'
  if (s.timedOut) return 'failed'
  return 'waiting'
}

/** The sign-in address a CLI prints for when the browser does not open. */
export function signInUrl(output: string): string | null {
  return /https:\/\/[^\s"'<>]+/.exec(output)?.[0] ?? null
}

const TIMEOUT_MS = 10 * 60_000
const CHECK_MS = 3_000

export interface SignInDeps {
  runner: ProcessRunner
  env: { inFlatpak: boolean; home: string; appId: string }
  configuredPath(cli: CliName): string
  /** The state changed (for the window and the tray). */
  changed(state: SignInState): void
  /** The CLI is signed in now: lift its hold and catch up. */
  signedIn(cli: CliName): void
  log(message: string): void
}

/** One sign-in at a time; starting again restarts it ("Browser didn't open? Try again"). */
export class CliSignIn {
  private current: SignInState = { state: 'idle' }
  private stopCurrent: (() => void) | null = null

  constructor(private readonly deps: SignInDeps) {}

  state(): SignInState {
    return this.current
  }

  cancel(): void {
    this.stopCurrent?.()
    this.stopCurrent = null
    this.set({ state: 'idle' })
  }

  /** Forgets a failed try, so the next problem's card starts with its Sign in button again. */
  clearFailure(): void {
    if (this.current.state === 'failed') this.set({ state: 'idle' })
  }

  async start(cli: CliName): Promise<void> {
    this.stopCurrent?.()
    this.stopCurrent = null
    const { runner, env } = this.deps
    const access = await hostAccess(runner, env.inFlatpak, env.appId)
    const location = access.ok ? await findCli(runner, cli, { ...env, ...(this.deps.configuredPath(cli) ? { configuredPath: this.deps.configuredPath(cli) } : {}) }) : null
    if (!location) {
      this.deps.log(`sign-in: ${cli} not found${access.ok ? '' : ` (${access.reason})`}`)
      this.set({ state: 'failed', cli, url: null })
      return
    }
    const signedInBefore = (await this.signedIn(cli, location)) === true
    const command = viaShell(env.inFlatpak, location, loginArgs(cli))
    // Its own session, so stopping it stops the CLI and not only the shell around it.
    const child = spawn(command.command, command.args, { stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32', env: cleanEnv() })
    let output = ''
    let ended = false
    let exitCode: number | null = null
    const onOutput = (d: Buffer) => {
      output += d.toString()
      const url = signInUrl(output)
      if (url && this.current.state === 'waiting' && this.current.url !== url) this.set({ ...this.current, url })
    }
    child.stdout.on('data', onOutput)
    child.stderr.on('data', onOutput)
    child.on('error', (err) => {
      output += err.message
      ended = true
    })
    child.on('exit', (code) => {
      ended = true
      exitCode = code
    })
    // An open, silent stdin keeps the CLI from quitting because it thinks the terminal went away.
    child.stdin.on('error', () => {})

    const kill = () => {
      try {
        if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGTERM')
        else child.kill('SIGTERM')
      } catch {
        // already gone
      }
    }
    const deadline = Date.now() + TIMEOUT_MS
    let checking = false
    const timer = setInterval(() => {
      if (checking) return
      checking = true
      void this.signedIn(cli, location)
        .then((signedIn) => {
          if (this.stopCurrent !== stop) return
          const verdict = signInVerdict({ signedInBefore, signedIn, ended, exitCode, timedOut: Date.now() >= deadline })
          if (verdict === 'waiting') return
          stop()
          this.stopCurrent = null
          this.deps.log(`sign-in: ${cli} ${verdict}${ended ? ` (exit ${exitCode})` : ''}`)
          if (verdict === 'done') {
            this.set({ state: 'idle' })
            this.deps.signedIn(cli)
          } else {
            this.set({ state: 'failed', cli, url: null })
          }
        })
        .finally(() => (checking = false))
    }, CHECK_MS)
    const stop = () => {
      clearInterval(timer)
      child.stdin.end()
      if (!ended) kill()
    }
    this.stopCurrent = stop
    this.set({ state: 'waiting', cli, url: null })
  }

  /** Whether a CLI is installed and signed in, so it could be the backup (upstream isReadyToUse). */
  async isReady(cli: CliName): Promise<boolean> {
    const { runner, env } = this.deps
    if (!(await hostAccess(runner, env.inFlatpak, env.appId)).ok) return false
    const path = this.deps.configuredPath(cli)
    const location = await findCli(runner, cli, { ...env, ...(path ? { configuredPath: path } : {}) })
    return !!location && (await this.signedIn(cli, location)) === true
  }

  private async signedIn(cli: CliName, location: CliLocation): Promise<boolean | null> {
    const c = viaShell(this.deps.env.inFlatpak, location, statusArgs(cli))
    const r = await this.deps.runner.run(c.command, c.args, { timeoutMs: 15_000, env: cleanEnv() })
    return r.timedOut ? null : parseSignedIn(cli, r)
  }

  private set(state: SignInState): void {
    this.current = state
    this.deps.changed(state)
  }
}

/** The CLI through the shell that found it, so it finds node and friends on PATH. */
function viaShell(inFlatpak: boolean, location: CliLocation, args: string[]) {
  const [shell, flags] = location.shell
  return hostCommand(inFlatpak, shell, [flags, 'exec "$0" "$@"', location.path, ...args])
}

/** Never let a CLI think it runs inside Claude Code. */
function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  for (const key of ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SSE_PORT']) delete env[key]
  return env
}
