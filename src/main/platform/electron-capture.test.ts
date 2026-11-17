import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type CaptureDeps, startElectronCapture } from './electron-capture'
import type { CaptureHandlers, CapturedFrame } from './types'

const T0 = new Date(2026, 10, 17, 9, 0, 0).getTime()
const DIR = join('data', 'recordings')

/** Two screens; the cursor sits on the second one unless a test moves it. */
function fakeDeps() {
  const state = {
    cursor: { x: 2000, y: 100 },
    access: null as string | null,
    fail: null as string | null,
    empty: false,
    requests: [] as Array<{ width: number; height: number }>,
    written: [] as Array<{ path: string; bytes: number }>,
    taken: new Set<string>()
  }
  const displays = [
    { id: 1, bounds: { x: 0, y: 0, width: 1440, height: 900 }, size: { width: 1440, height: 900 }, scaleFactor: 2 },
    { id: 2, bounds: { x: 1440, y: 0, width: 2560, height: 1440 }, size: { width: 2560, height: 1440 }, scaleFactor: 1 }
  ]
  const deps: CaptureDeps = {
    screen: { getCursorScreenPoint: () => state.cursor, getAllDisplays: () => displays },
    desktopCapturer: {
      async getSources(opts) {
        if (state.fail) throw new Error(state.fail)
        state.requests.push(opts.thumbnailSize!)
        return displays.map((d) => ({
          display_id: String(d.id),
          thumbnail: { isEmpty: () => state.empty, toJPEG: (q: number) => Buffer.alloc(d.id * 100 + q) }
        }))
      }
    },
    async writeFile(path, data) {
      if (state.taken.has(path)) throw Object.assign(new Error('EEXIST: file already exists'), { code: 'EEXIST' })
      state.written.push({ path, bytes: data.length })
    },
    checkAccess: () => state.access
  }
  return { deps, state }
}

function recorder() {
  const events = { frames: [] as CapturedFrame[], skipped: [] as number[], failed: [] as string[] }
  const handlers: CaptureHandlers = {
    frame: (f) => events.frames.push(f),
    skipped: (at) => events.skipped.push(at),
    failed: (m) => events.failed.push(m)
  }
  return { events, handlers }
}

beforeEach(() => vi.useFakeTimers({ now: T0 }))
afterEach(() => vi.useRealTimers())

describe('startElectronCapture', () => {
  it('saves the screen under the cursor as a JPEG at each interval and reports it like the Linux helper', async () => {
    const { deps, state } = fakeDeps()
    const { events, handlers } = recorder()
    const handle = startElectronCapture({ dir: DIR, intervalSec: 10, height: 720 }, handlers, deps)

    await vi.advanceTimersByTimeAsync(0)
    expect(state.requests).toEqual([{ width: 1280, height: 720 }])
    expect(events.frames).toEqual([{ filePath: join(DIR, '20261117-090000.000+0100_s1.jpg'), capturedAt: T0 / 1000, bytes: 275 }])
    expect(state.written).toEqual([{ path: join(DIR, '20261117-090000.000+0100_s1.jpg'), bytes: 275 }])

    state.cursor = { x: 100, y: 100 }
    await vi.advanceTimersByTimeAsync(10_000)
    expect(events.frames[1]).toEqual({ filePath: join(DIR, '20261117-090010.000+0100_s0.jpg'), capturedAt: T0 / 1000 + 10, bytes: 175 })
    expect(state.requests[1]).toEqual({ width: 1152, height: 720 })
    handle.stop()
  })

  it('never overwrites a frame: a taken name moves on to the next millisecond', async () => {
    const { deps, state } = fakeDeps()
    const { events, handlers } = recorder()
    state.taken.add(join(DIR, '20261117-090000.000+0100_s1.jpg'))
    const handle = startElectronCapture({ dir: DIR, intervalSec: 10, height: 720 }, handlers, deps)
    await vi.advanceTimersByTimeAsync(0)
    expect(events.frames.map((f) => f.filePath)).toEqual([join(DIR, '20261117-090000.001+0100_s1.jpg')])
    expect(events.failed).toEqual([])
    handle.stop()
  })

  it('does not capture before startCapture returned, so the recorder can block the first frame', async () => {
    const { deps, state } = fakeDeps()
    const { events, handlers } = recorder()
    const handle = startElectronCapture({ dir: DIR, intervalSec: 10, height: 720 }, handlers, deps)
    handle.setBlocked(true)

    await vi.advanceTimersByTimeAsync(0)
    expect(state.requests).toEqual([])
    expect(events.frames).toEqual([])
    expect(events.skipped).toEqual([T0 / 1000])
    handle.stop()
  })

  it('reports skipped frames while blocked and saves again once unblocked', async () => {
    const { deps, state } = fakeDeps()
    const { events, handlers } = recorder()
    const handle = startElectronCapture({ dir: DIR, intervalSec: 5, height: 720 }, handlers, deps)
    await vi.advanceTimersByTimeAsync(0)
    handle.setBlocked(true)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(events.skipped).toEqual([T0 / 1000 + 5, T0 / 1000 + 10])
    expect(state.written).toHaveLength(1)

    handle.setBlocked(false)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(events.frames).toHaveLength(2)
    handle.stop()
  })

  it('drops a frame when the block arrives while the screenshot is taken', async () => {
    const { deps, state } = fakeDeps()
    const { events, handlers } = recorder()
    let handle: ReturnType<typeof startElectronCapture> | null = null
    const getSources = deps.desktopCapturer.getSources
    deps.desktopCapturer.getSources = async (opts) => {
      const sources = await getSources(opts)
      handle!.setBlocked(true)
      return sources
    }
    handle = startElectronCapture({ dir: DIR, intervalSec: 10, height: 720 }, handlers, deps)
    await vi.advanceTimersByTimeAsync(0)
    expect(state.written).toEqual([])
    expect(events.frames).toEqual([])
    expect(events.skipped).toEqual([T0 / 1000])
    handle.stop()
  })

  it('fails after three screenshots in a row went wrong, and stops', async () => {
    const { deps, state } = fakeDeps()
    const { events, handlers } = recorder()
    state.fail = 'no screen'
    const handle = startElectronCapture({ dir: DIR, intervalSec: 10, height: 720 }, handlers, deps)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(events.failed).toEqual(['Screenshot failed: no screen'])
    await vi.advanceTimersByTimeAsync(60_000)
    expect(events.failed).toHaveLength(1)
    handle.stop()
  })

  it('counts empty screenshots as failures and recovers on the next good one', async () => {
    const { deps, state } = fakeDeps()
    const { events, handlers } = recorder()
    state.empty = true
    const handle = startElectronCapture({ dir: DIR, intervalSec: 10, height: 720 }, handlers, deps)
    await vi.advanceTimersByTimeAsync(10_000)
    state.empty = false
    await vi.advanceTimersByTimeAsync(10_000)
    state.empty = true
    await vi.advanceTimersByTimeAsync(10_000)
    expect(events.failed).toEqual([])
    expect(events.frames).toHaveLength(1)
    handle.stop()
  })

  it('fails at once when the OS denies screen access (macOS Screen Recording)', async () => {
    const { deps, state } = fakeDeps()
    const { events, handlers } = recorder()
    state.access = 'Screen Recording permission is missing.'
    const handle = startElectronCapture({ dir: DIR, intervalSec: 10, height: 720 }, handlers, deps)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(events.failed).toEqual(['Screen Recording permission is missing.'])
    expect(state.requests).toEqual([])
    handle.stop()
  })

  it('reports nothing after stop', async () => {
    const { deps } = fakeDeps()
    const { events, handlers } = recorder()
    const handle = startElectronCapture({ dir: DIR, intervalSec: 10, height: 720 }, handlers, deps)
    handle.stop()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(events).toEqual({ frames: [], skipped: [], failed: [] })
  })
})
