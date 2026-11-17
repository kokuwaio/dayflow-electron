import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CaptureHandlers, Platform, SessionHandlers } from '../platform/types'
import { Recorder, type RecordedFrame } from './recorder'

/** A platform whose capture and session events the test drives by hand. */
function fakePlatform() {
  const state = {
    capture: null as CaptureHandlers | null,
    session: null as SessionHandlers | null,
    starts: 0,
    stops: 0,
    lastOptions: null as unknown
  }
  const platform: Platform = {
    name: 'fake',
    startCapture(opts, handlers) {
      state.capture = handlers
      state.lastOptions = opts
      state.starts++
      return { stop: () => { state.stops++; state.capture = null } }
    },
    watchSession(_opts, handlers) {
      state.session = handlers
      return { stop: () => { state.session = null } }
    },
    setAutostart: async () => {}
  }
  return { platform, state }
}

const nowSec = () => Math.floor(Date.now() / 1000)
const T0 = new Date(2026, 10, 17, 9, 0).getTime()

let fake: ReturnType<typeof fakePlatform>
let frames: RecordedFrame[]
let recorder: Recorder

beforeEach(() => {
  vi.useFakeTimers({ now: T0 })
  fake = fakePlatform()
  frames = []
  recorder = new Recorder(fake.platform, { dir: '/f', intervalSec: 10, height: 1080 }, (f) => frames.push(f))
  recorder.start()
})
afterEach(() => {
  recorder.stop()
  vi.useRealTimers()
})

const emitFrame = () => fake.state.capture!.frame({ filePath: `/f/${nowSec()}.jpg`, capturedAt: nowSec(), bytes: 100 })

describe('Recorder', () => {
  it('records frames and tags them with how long the user has been idle', () => {
    expect(recorder.status().state).toBe('recording')
    emitFrame()
    fake.state.session!.idle(nowSec() - 60)
    vi.advanceTimersByTime(30_000)
    emitFrame()
    fake.state.session!.idle(null)
    emitFrame()

    expect(frames.map((f) => f.idleSeconds)).toEqual([0, 90, 0])
    expect(frames[0]).toMatchObject({ filePath: `/f/${T0 / 1000}.jpg`, capturedAt: T0 / 1000, fileSize: 100 })
  })

  it('stops capturing while locked or asleep and resumes 5 s after unlock or wake', () => {
    fake.state.session!.lock(true)
    expect(recorder.status().state).toBe('locked')
    expect(fake.state.capture).toBeNull()

    fake.state.session!.lock(false)
    vi.advanceTimersByTime(4_999)
    expect(fake.state.capture).toBeNull()
    vi.advanceTimersByTime(1)
    expect(recorder.status().state).toBe('recording')

    fake.state.session!.sleep(true)
    fake.state.session!.lock(true) // KDE locks on suspend
    fake.state.session!.sleep(false)
    vi.advanceTimersByTime(10_000)
    expect(recorder.status().state).toBe('locked') // still locked after wake
    fake.state.session!.lock(false)
    vi.advanceTimersByTime(5_000)
    expect(recorder.status().state).toBe('recording')
    expect(fake.state.starts).toBe(3)
  })

  it('backs off 60, 120, 300 and 600 s after capture failures and resets after a frame', () => {
    const failAndMeasureRestart = () => {
      fake.state.capture!.failed('portal closed')
      expect(recorder.status()).toMatchObject({ state: 'backoff', lastError: 'portal closed' })
      const started = fake.state.starts
      let waited = 0
      while (fake.state.starts === started) {
        vi.advanceTimersByTime(1_000)
        waited += 1
      }
      return waited
    }
    expect([failAndMeasureRestart(), failAndMeasureRestart(), failAndMeasureRestart(), failAndMeasureRestart(), failAndMeasureRestart()])
      .toEqual([60, 120, 300, 600, 600])

    emitFrame()
    expect(recorder.status()).toMatchObject({ state: 'recording', lastError: null })
    expect(failAndMeasureRestart()).toBe(60)
  })

  it('pauses for a set time or until resumed, and stays paused across unlock', () => {
    recorder.pause(15 * 60)
    expect(recorder.status()).toMatchObject({ state: 'paused', until: nowSec() + 15 * 60 })
    expect(fake.state.capture).toBeNull()
    fake.state.session!.lock(true)
    fake.state.session!.lock(false)
    vi.advanceTimersByTime(14 * 60_000)
    expect(recorder.status().state).toBe('paused')
    vi.advanceTimersByTime(60_000)
    expect(recorder.status().state).toBe('recording')

    recorder.pause(null)
    vi.advanceTimersByTime(24 * 3600_000)
    expect(recorder.status()).toMatchObject({ state: 'paused', until: null })
    recorder.resume()
    expect(recorder.status().state).toBe('recording')
    expect(fake.state.capture).not.toBeNull()
  })

  it('keeps a pause and the lock state when the capture settings change', () => {
    recorder.pause(null)
    recorder.reconfigure({ dir: '/f', intervalSec: 30, height: 720 })
    expect(recorder.status().state).toBe('paused')
    recorder.resume()
    fake.state.session!.lock(true)
    recorder.reconfigure({ dir: '/f', intervalSec: 10, height: 1080 })
    expect(recorder.status().state).toBe('locked')
    expect(fake.state.capture).toBeNull()
  })

  it('restarts a running capture with the new settings', () => {
    const before = fake.state.starts
    recorder.reconfigure({ dir: '/f', intervalSec: 30, height: 720 })
    expect(fake.state.starts).toBe(before + 1)
    expect(fake.state.lastOptions).toEqual({ dir: '/f', intervalSec: 30, height: 720 })
  })

  it('ends a timed pause that ran out while the machine was asleep', () => {
    recorder.pause(15 * 60)
    fake.state.session!.sleep(true)
    vi.setSystemTime(Date.now() + 2 * 3600_000) // suspended: timers did not run
    fake.state.session!.sleep(false)
    vi.advanceTimersByTime(5_000)
    expect(recorder.status().state).toBe('recording')
  })
})
