import type { WindowCheck } from '../../shared/permissions'
import type { Platform, Stoppable } from './types'

/** How long window detection may take for its first report (recording waits as long). */
export const WINDOW_REPORT_TIMEOUT_MS = 10_000
export const NO_WINDOW_REPORT = 'No window report from the desktop within 10 s.'

/**
 * Starts window detection the way recording does, waits for its first answer
 * and stops it again: for the onboarding, before recording runs.
 */
export function probeWindowDetection(platform: Pick<Platform, 'watchActiveWindow'>): Promise<Omit<WindowCheck, 'command'>> {
  return new Promise((resolve) => {
    let watcher: Stoppable | null = null
    let done = false
    const finish = (result: Omit<WindowCheck, 'command'>) => {
      if (done) return
      done = true
      clearTimeout(timer)
      watcher?.stop()
      resolve(result)
    }
    const timer = setTimeout(() => finish({ state: 'unavailable', reason: NO_WINDOW_REPORT }), WINDOW_REPORT_TIMEOUT_MS)
    watcher = platform.watchActiveWindow({
      window: () => finish({ state: 'ok', reason: null }),
      unavailable: (reason) => finish({ state: 'unavailable', reason })
    })
    if (done) watcher.stop() // answered while starting
  })
}
