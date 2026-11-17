import { describe, expect, it } from 'vitest'
import { Store } from './store'

describe('frames for a time range', () => {
  it('lists saved frames of the range in time order, without blocked placeholders or deleted frames', () => {
    const store = Store.open(':memory:')
    const shot = (capturedAt: number, blocked = false) =>
      store.insertScreenshot({ capturedAt, filePath: blocked ? '' : `/r/${capturedAt}.jpg`, fileSize: 1, idleSeconds: 0, blocked })
    shot(100)
    shot(110, true)
    const gone = shot(120)
    shot(130)
    shot(200)
    store.deleteScreenshots([gone])

    expect(store.framesInRange({ start: 100, end: 140 })).toEqual([
      { id: 1, capturedAt: 100, filePath: '/r/100.jpg' },
      { id: 4, capturedAt: 130, filePath: '/r/130.jpg' }
    ])
  })
})
