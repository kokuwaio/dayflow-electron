import { describe, expect, it } from 'vitest'
import { assessIdleBatch, idleCardSpan } from './idle'

/** One frame every 10 s over [0, end]; idleAt(t) gives the idle seconds at capture (null = unknown). */
const frames = (end: number, idleAt: (t: number) => number | null) =>
  Array.from({ length: end / 10 + 1 }, (_, i) => ({ capturedAt: i * 10, idleSeconds: idleAt(i * 10) }))

describe('assessIdleBatch', () => {
  it('treats a 15-minute batch as idle when the user was idle the whole time', () => {
    const away = frames(900, (t) => t + 60) // idle since a minute before the batch
    expect(assessIdleBatch(away)).toMatchObject({ coverageRatio: 1, qualifiedIdleRatio: 1, screenshotCount: 91 })
  })

  it('never treats a batch shorter than 12 minutes as idle', () => {
    expect(assessIdleBatch(frames(710, (t) => t + 60))).toBeNull()
  })

  it('does not treat a batch as idle when a minute of activity interrupts it', () => {
    const idle = (t: number) => (t < 400 ? t + 60 : t < 460 ? 0 : t - 460)
    expect(assessIdleBatch(frames(900, idle))).toBeNull()
  })

  it('needs idle readings for nearly every frame', () => {
    const unknownEveryFifth = (t: number) => (t % 50 === 0 ? null : t + 60)
    expect(assessIdleBatch(frames(900, unknownEveryFifth))).toBeNull()
  })
})

describe('idleCardSpan (upstream AnalysisManager idle shortcut)', () => {
  // Local wall-clock times on 2026-11-17 (TZ=Europe/Berlin in vitest.config.ts).
  const t = (h: number, m: number, s = 0) => new Date(2026, 10, 17, h, m, s).getTime() / 1000
  const shots = (from: number, to: number) => [{ capturedAt: from }, { capturedAt: to }]
  const idlePrev = { id: 7, start: t(10, 0), end: t(10, 14), title: 'Idle', category: 'Idle' }

  it('extends the previous Idle card when it ended less than 5 minutes before, on the same day', () => {
    expect(idleCardSpan(shots(t(10, 15, 20), t(10, 29, 50)), idlePrev)).toEqual({ start: t(10, 0), end: t(10, 29), extend: 7 })
  })

  it('starts a new card at whole minutes, not before the previous card ends', () => {
    expect(idleCardSpan(shots(t(10, 15, 20), t(10, 29, 50)), null)).toEqual({ start: t(10, 15), end: t(10, 29), extend: null })
    const work = { id: 8, start: t(9, 30), end: t(10, 15, 40), title: 'Code review', category: 'Work' }
    expect(idleCardSpan(shots(t(10, 15, 20), t(10, 29, 50)), work)).toEqual({ start: t(10, 15, 40), end: t(10, 29), extend: null })
  })

  it('does not extend across a longer gap or the 4 AM boundary', () => {
    expect(idleCardSpan(shots(t(10, 19), t(10, 33)), idlePrev)).toMatchObject({ start: t(10, 19), extend: null })
    const night = { id: 9, start: t(3, 30), end: t(3, 59), title: 'Idle', category: 'Idle' }
    expect(idleCardSpan(shots(t(4, 0, 30), t(4, 14)), night)).toMatchObject({ start: t(4, 0), extend: null })
  })

  it('extends an Idle card filed under a renamed idle category', () => {
    const away = { ...idlePrev, category: 'Away' }
    const categories = [{ id: 'i', name: 'Away', color: '#000', description: '', isIdle: true }]
    expect(idleCardSpan(shots(t(10, 15, 20), t(10, 29, 50)), away, categories)).toMatchObject({ start: t(10, 0), extend: 7 })
  })

  it('writes nothing when no whole minute is left', () => {
    expect(idleCardSpan(shots(t(10, 15, 20), t(10, 15, 50)), null)).toBeNull()
  })
})
