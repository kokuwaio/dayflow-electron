import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { idleSinceAfter, watchPowerSession } from './power-session'

const T0 = new Date(2026, 10, 17, 9, 0, 0).getTime() / 1000

describe('idleSinceAfter', () => {
  it('turns idle once input stopped for the threshold and remembers when it stopped', () => {
    expect(idleSinceAfter(null, 59, 60, T0)).toBeNull()
    expect(idleSinceAfter(null, 60, 60, T0)).toBe(T0 - 60)
  })

  it('keeps the start of an ongoing idle period', () => {
    expect(idleSinceAfter(T0 - 60, 65, 60, T0 + 5)).toBe(T0 - 60)
  })

  it('ends idle on any input', () => {
    expect(idleSinceAfter(T0 - 60, 0, 60, T0 + 5)).toBeNull()
  })
})

describe('watchPowerSession', () => {
  beforeEach(() => vi.useFakeTimers({ now: T0 * 1000 }))
  afterEach(() => vi.useRealTimers())

  function setup() {
    const monitor = Object.assign(new EventEmitter(), { idle: 0, getSystemIdleTime: () => monitor.idle })
    const calls: string[] = []
    const watch = watchPowerSession({ idleSec: 60 }, {
      lock: (l) => calls.push(`lock ${l}`),
      sleep: (s) => calls.push(`sleep ${s}`),
      idle: (since) => calls.push(`idle ${since === null ? null : T0 - since}`),
      warning: (m) => calls.push(`warning ${m}`)
    }, monitor)
    return { monitor, calls, watch }
  }

  it('maps powerMonitor lock and sleep events', () => {
    const { monitor, calls, watch } = setup()
    monitor.emit('lock-screen')
    monitor.emit('unlock-screen')
    monitor.emit('suspend')
    monitor.emit('resume')
    expect(calls).toEqual(['lock true', 'lock false', 'sleep true', 'sleep false'])
    watch.stop()
  })

  it('polls the idle time and reports only changes', () => {
    const { monitor, calls, watch } = setup()
    monitor.idle = 30
    vi.advanceTimersByTime(5_000)
    monitor.idle = 61
    vi.advanceTimersByTime(5_000)
    monitor.idle = 66
    vi.advanceTimersByTime(5_000)
    monitor.idle = 1
    vi.advanceTimersByTime(5_000)
    // T0 + 10 s - 61 s idle: input stopped 51 s before T0.
    expect(calls).toEqual(['idle 51', 'idle null'])
    watch.stop()
  })

  it('removes its listeners and stops polling on stop', () => {
    const { monitor, calls, watch } = setup()
    watch.stop()
    monitor.emit('lock-screen')
    monitor.idle = 600
    vi.advanceTimersByTime(60_000)
    expect(calls).toEqual([])
    expect(monitor.listenerCount('lock-screen')).toBe(0)
  })
})
