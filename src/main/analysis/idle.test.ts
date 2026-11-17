import { describe, expect, it } from 'vitest'
import { assessIdleBatch } from './idle'

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
