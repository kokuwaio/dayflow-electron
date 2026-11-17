// Linux (Wayland) through the Go helper in helper/linux: ScreenCast portal +
// PipeWire for frames, D-Bus for lock and sleep, ext-idle-notify for idle.
// Each helper command runs as a child process printing JSON lines.

import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import type { CaptureHandlers, CaptureOptions, Platform, SessionHandlers, Stoppable } from './types'

type HelperEvent = { type: string; ts: number; [key: string]: unknown }

function findHelper(appPath: string, resourcesPath: string): string {
  const candidates = [
    process.env.DAYFLOW_HELPER,
    '/app/bin/dayflow-linux-helper', // Flatpak
    join(resourcesPath, 'dayflow-linux-helper'), // packaged app
    join(appPath, 'helper/linux/bin/dayflow-linux-helper') // development
  ]
  const found = candidates.find((p): p is string => !!p && existsSync(p))
  if (!found) throw new Error('dayflow-linux-helper not found; build it with "npm run helper"')
  return found
}

interface HelperRun extends Stoppable {
  readonly child: ChildProcess
}

/** Runs one helper command; onExit gets the last error message, if any. */
function runHelper(
  helper: string,
  args: string[],
  onEvent: (e: HelperEvent) => void,
  onExit: (code: number | null, lastError: string | null) => void
): HelperRun {
  const child = spawn(helper, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  let lastError: string | null = null
  let stopping = false
  createInterface({ input: child.stdout! }).on('line', (line) => {
    let event: HelperEvent
    try {
      event = JSON.parse(line)
    } catch {
      return
    }
    if (event.type === 'error' && typeof event.message === 'string') lastError = event.message
    onEvent(event)
  })
  const stderr: string[] = []
  createInterface({ input: child.stderr! }).on('line', (line) => {
    stderr.push(line)
    if (stderr.length > 20) stderr.shift()
  })
  child.on('error', (err) => {
    lastError = err.message
  })
  child.on('close', (code) => {
    if (!stopping) onExit(code, lastError ?? (stderr.length ? stderr.join('\n') : null))
  })
  return {
    child,
    stop() {
      stopping = true
      child.kill('SIGTERM')
    }
  }
}

export interface LinuxOptions {
  appPath: string
  resourcesPath: string
  /** File that keeps the ScreenCast portal's restore token. */
  tokenFile: string
  /** Program and arguments to start at login outside Flatpak. */
  launchCommand: string[]
}

export function linuxPlatform(opts: LinuxOptions): Platform {
  const helper = findHelper(opts.appPath, opts.resourcesPath)
  const tokenFile = opts.tokenFile
  return {
    name: 'linux',

    startCapture(options: CaptureOptions, handlers: CaptureHandlers): Stoppable {
      return runHelper(
        helper,
        ['capture', '-dir', options.dir, '-interval', String(options.intervalSec), '-height', String(options.height), '-token', tokenFile],
        (e) => {
          if (e.type === 'frame' && typeof e.path === 'string') {
            handlers.frame({
              filePath: e.path,
              capturedAt: Math.floor(Number(e.capturedAt ?? e.ts) / 1000),
              bytes: Number(e.bytes ?? 0)
            })
          }
        },
        (code, lastError) => handlers.failed(lastError ?? `capture helper exited (${code})`)
      )
    },

    watchSession({ idleSec }, handlers: SessionHandlers): Stoppable {
      let run: HelperRun | null = null
      let stopped = false
      let restartTimer: ReturnType<typeof setTimeout> | null = null
      const start = () => {
        run = runHelper(
          helper,
          ['watch', '-idle', String(idleSec)],
          (e) => {
            if (e.type === 'lock') handlers.lock(e.locked === true)
            else if (e.type === 'sleep') handlers.sleep(e.sleeping === true)
            else if (e.type === 'idle') {
              handlers.idle(e.idle === true ? Math.floor(Number(e.since ?? e.ts) / 1000) : null)
            } else if (e.type === 'warning' && typeof e.message === 'string') handlers.warning(e.message)
          },
          (code, lastError) => {
            handlers.warning(`session watcher exited (${code}): ${lastError ?? 'no message'}`)
            if (!stopped) restartTimer = setTimeout(start, 30_000)
          }
        )
      }
      start()
      return {
        stop() {
          stopped = true
          if (restartTimer) clearTimeout(restartTimer)
          run?.stop()
        }
      }
    },

    setAutostart: (enable) => setAutostart(helper, enable, opts.launchCommand)
  }
}

/** Turns launch at login on or off (Background portal inside Flatpak). */
function setAutostart(helper: string, enable: boolean, command: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    let error: string | null = null
    runHelper(
      helper,
      ['autostart', `-enable=${enable}`, '--', ...command],
      (e) => {
        if (e.type === 'error' && typeof e.message === 'string') error = e.message
      },
      (code, lastError) => (code === 0 ? resolve() : reject(new Error(error ?? lastError ?? `autostart failed (${code})`)))
    )
  })
}
