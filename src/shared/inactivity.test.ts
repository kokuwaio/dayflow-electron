import { describe, expect, it } from 'vitest'
import { IDLE_RESET_MS, checkIntervalMs, idleCheck, interacted, startInactivity } from './inactivity'

const min = 60_000
const t0 = new Date(2026, 10, 17, 9, 0).getTime()

describe('back to today after 15 minutes away', () => {
  it('waits for 15 minutes without input in the window', () => {
    const state = startInactivity(t0)
    expect(idleCheck(state, t0 + 14 * min)).toEqual({ reset: false, state })
    const due = idleCheck(state, t0 + 15 * min)
    expect(due.reset).toBe(true)
    expect(due.state).toEqual({ lastInteractionAt: t0, lastResetAt: t0 + 15 * min })
  })

  it('counts every click, key or scroll as using the app', () => {
    // 9:00 start, 9:10 a click, 9:20 focus comes back: only 10 minutes since the click.
    const state = interacted(startInactivity(t0), t0 + 10 * min)
    expect(idleCheck(state, t0 + 20 * min).reset).toBe(false)
    expect(idleCheck(state, t0 + 25 * min).reset).toBe(true)
  })

  it('resets once per idle stretch, then again after another 15 minutes', () => {
    // Away from 9:00: reset at 9:15; the checks at 9:16 and 9:29 do nothing, 9:30 resets again (upstream lastResetAt).
    const first = idleCheck(startInactivity(t0), t0 + 15 * min)
    expect(idleCheck(first.state, t0 + 16 * min).reset).toBe(false)
    expect(idleCheck(first.state, t0 + 29 * min).reset).toBe(false)
    expect(idleCheck(first.state, t0 + 30 * min).reset).toBe(true)
  })

  it('starts counting afresh after input that follows a reset', () => {
    const reset = idleCheck(startInactivity(t0), t0 + 15 * min).state
    const back = interacted(reset, t0 + 16 * min)
    expect(back).toEqual({ lastInteractionAt: t0 + 16 * min, lastResetAt: null })
    expect(idleCheck(back, t0 + 30 * min).reset).toBe(false)
    expect(idleCheck(back, t0 + 31 * min).reset).toBe(true)
  })

  it('checks every 60 s for the 15-minute threshold (half of it, between 5 and 60 s)', () => {
    expect(checkIntervalMs(IDLE_RESET_MS)).toBe(60_000)
    expect(checkIntervalMs(40_000)).toBe(20_000)
    expect(checkIntervalMs(4_000)).toBe(5_000)
  })
})
