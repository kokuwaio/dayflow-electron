import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Platform, WindowHandlers } from './types'
import { probeWindowDetection } from './window-probe'

function fakePlatform() {
  const state = { handlers: null as WindowHandlers | null, stops: 0 }
  const platform: Pick<Platform, 'watchActiveWindow'> = {
    watchActiveWindow(handlers) {
      state.handlers = handlers
      return { stop: () => state.stops++ }
    }
  }
  return { platform, state }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('probeWindowDetection', () => {
  it('reports ok on the first window report and stops the watcher', async () => {
    const { platform, state } = fakePlatform()
    const result = probeWindowDetection(platform)
    state.handlers!.window({ app: 'org.kde.konsole', title: 'Shell' })
    await expect(result).resolves.toEqual({ state: 'ok', reason: null })
    expect(state.stops).toBe(1)
  })

  it('reports the reason the platform gives', async () => {
    const { platform, state } = fakePlatform()
    const result = probeWindowDetection(platform)
    state.handlers!.unavailable('Window detection needs KWin access.')
    state.handlers!.window({ app: 'late', title: '' }) // ignored after the answer
    await expect(result).resolves.toEqual({ state: 'unavailable', reason: 'Window detection needs KWin access.' })
    expect(state.stops).toBe(1)
  })

  it('gives up like the recorder when no report arrives', async () => {
    const { platform, state } = fakePlatform()
    const result = probeWindowDetection(platform)
    await vi.advanceTimersByTimeAsync(10_000)
    await expect(result).resolves.toEqual({ state: 'unavailable', reason: 'No window report from the desktop within 10 s.' })
    expect(state.stops).toBe(1)
  })

  it('stops a watcher that answered while it was being started', async () => {
    let stops = 0
    const platform: Pick<Platform, 'watchActiveWindow'> = {
      watchActiveWindow(handlers) {
        handlers.unavailable('no desktop')
        return { stop: () => stops++ }
      }
    }
    await expect(probeWindowDetection(platform)).resolves.toEqual({ state: 'unavailable', reason: 'no desktop' })
    expect(stops).toBe(1)
  })
})
