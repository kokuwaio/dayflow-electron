// Lock, sleep and idle through Electron's powerMonitor (Windows and macOS).
// Events for lock and sleep; idle is polled, since powerMonitor has no event
// for it.

import type { SessionHandlers, Stoppable } from './types'

/** The parts of Electron's powerMonitor the session watcher uses. */
export interface PowerMonitorLike {
  on(event: 'lock-screen' | 'unlock-screen' | 'suspend' | 'resume', listener: () => void): unknown
  removeListener(event: 'lock-screen' | 'unlock-screen' | 'suspend' | 'resume', listener: () => void): unknown
  /** Seconds since the last keyboard or mouse input. */
  getSystemIdleTime(): number
}

const IDLE_POLL_MS = 5_000

/**
 * The new idle start (Unix seconds) after reading the idle time, or null
 * while the user is active. An ongoing idle period keeps its start.
 */
export function idleSinceAfter(idleSince: number | null, idleTimeSec: number, thresholdSec: number, nowSec: number): number | null {
  if (idleTimeSec < thresholdSec) return null
  return idleSince ?? nowSec - idleTimeSec
}

export function watchPowerSession({ idleSec }: { idleSec: number }, handlers: SessionHandlers, monitor: PowerMonitorLike): Stoppable {
  const listeners = {
    'lock-screen': () => handlers.lock(true),
    'unlock-screen': () => handlers.lock(false),
    suspend: () => handlers.sleep(true),
    resume: () => handlers.sleep(false)
  }
  for (const [event, listener] of Object.entries(listeners)) monitor.on(event as keyof typeof listeners, listener)

  let idleSince: number | null = null
  const poll = setInterval(() => {
    const next = idleSinceAfter(idleSince, monitor.getSystemIdleTime(), idleSec, Math.floor(Date.now() / 1000))
    if (next === idleSince) return
    idleSince = next
    handlers.idle(next)
  }, IDLE_POLL_MS)

  return {
    stop() {
      clearInterval(poll)
      for (const [event, listener] of Object.entries(listeners)) monitor.removeListener(event as keyof typeof listeners, listener)
    }
  }
}
