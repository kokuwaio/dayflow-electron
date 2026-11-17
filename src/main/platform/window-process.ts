// Runs a long-lived script that prints the focused window as JSON lines
// (PowerShell on Windows, osascript on macOS) and restarts it when it dies,
// like the Linux helper's window watcher in linux.ts.

import { type ChildProcess, spawn as nodeSpawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { parseWindowLine } from './window-lines'
import type { Stoppable, WindowHandlers } from './types'

export type SpawnFn = (command: string, args: readonly string[]) => Pick<ChildProcess, 'stdout' | 'stderr' | 'kill' | 'on'>

export interface WindowProcessOptions {
  command: string
  args: readonly string[]
  /** Used in messages, e.g. "The window watcher". */
  name: string
  spawn?: SpawnFn
  /** Why the script cannot work right now (e.g. a missing permission), checked before each start. */
  checkAccess?: () => string | null
  /** Replace the script with a fresh one this often, without reporting a gap. */
  recycleMs?: number
}

/** Restart after a crash of a script that worked. */
const RETRY_AFTER_CRASH_MS = 10_000
/** Retry a script that never reported a window; usually it lacks something only a restart or the user fixes. */
const RETRY_AFTER_FAILURE_MS = 5 * 60_000
/** Re-check a missing permission. */
const RETRY_ACCESS_MS = 60_000

const defaultSpawn: SpawnFn = (command, args) => nodeSpawn(command, [...args], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })

export function watchWindowProcess(opts: WindowProcessOptions, handlers: WindowHandlers): Stoppable {
  const spawn = opts.spawn ?? defaultSpawn
  let stopped = false
  let child: ReturnType<SpawnFn> | null = null
  let retry: ReturnType<typeof setTimeout> | null = null
  let recycle: ReturnType<typeof setTimeout> | null = null

  const later = (fn: () => void, ms: number) => {
    if (!stopped) retry = setTimeout(fn, ms)
  }

  const start = () => {
    retry = null
    const denied = opts.checkAccess?.()
    if (denied) {
      handlers.unavailable(denied)
      return later(start, RETRY_ACCESS_MS)
    }
    let reported = false
    let lastError: string | null = null
    const stderr: string[] = []
    const run = spawn(opts.command, opts.args)
    child = run
    if (opts.recycleMs) {
      recycle = setTimeout(() => {
        // The last reported window stays valid until the fresh script reports.
        child = null
        run.kill()
        start()
      }, opts.recycleMs)
    }
    createInterface({ input: run.stdout! }).on('line', (line) => {
      if (stopped) return
      const parsed = parseWindowLine(line)
      if (parsed?.type === 'window') {
        reported = true
        handlers.window(parsed.window)
      } else if (parsed?.type === 'error') lastError = parsed.message
    })
    createInterface({ input: run.stderr! }).on('line', (line) => {
      if (line.trim()) stderr.push(line.trim())
      if (stderr.length > 5) stderr.shift()
    })
    run.on('error', (err: Error) => {
      lastError = err.message
    })
    run.on('close', (code: number | null) => {
      if (stopped || child !== run) return
      child = null
      if (recycle) clearTimeout(recycle)
      recycle = null
      handlers.unavailable(lastError ?? (stderr.length ? stderr.join('\n') : `${opts.name} exited (${code}).`))
      later(start, reported ? RETRY_AFTER_CRASH_MS : RETRY_AFTER_FAILURE_MS)
    })
  }

  // Not synchronously: the recorder is still setting up when this returns.
  retry = setTimeout(start, 0)

  return {
    stop() {
      stopped = true
      if (retry) clearTimeout(retry)
      if (recycle) clearTimeout(recycle)
      retry = recycle = null
      child?.kill()
      child = null
    }
  }
}
