import { describe, expect, it } from 'vitest'
import { planBatches } from './batching'

/** Screenshots every `step` seconds from `from` to `to` inclusive, ids counting from `firstId`. */
const shots = (from: number, to: number, step = 10, firstId = 1) =>
  Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => ({ id: firstId + i, capturedAt: from + i * step }))

describe('planBatches', () => {
  it('splits on gaps over two minutes and holds back the newest batch while it can still grow', () => {
    const morning = shots(1000, 1600) // 10 min
    const afterBreak = shots(1600 + 121, 1600 + 121 + 300, 10, 100) // starts 121 s later
    const now = 1600 + 121 + 300 + 30 // 30 s after the last shot

    const batches = planBatches([...afterBreak, ...morning], now)

    expect(batches).toEqual([{ start: 1000, end: 1600, shotIds: morning.map((s) => s.id) }])
  })

  it('closes a batch once it would exceed 15 minutes', () => {
    const run = shots(0, 1200) // 20 min of continuous capture
    const batches = planBatches(run, 1210)
    expect(batches).toHaveLength(1)
    expect(batches[0]).toMatchObject({ start: 0, end: 900 })
    expect(batches[0]!.shotIds).toHaveLength(91)
  })

  it('releases the newest batch once no screenshot followed it for over two minutes', () => {
    const run = shots(0, 400)
    expect(planBatches(run, 400 + 120)).toEqual([])
    expect(planBatches(run, 400 + 121)).toEqual([{ start: 0, end: 400, shotIds: run.map((s) => s.id) }])
  })
})
