import { beforeEach, describe, expect, it } from 'vitest'
import { Store } from './store'

let store: Store
beforeEach(() => {
  store = Store.open(':memory:')
})

describe('Store: timeline review ratings (upstream StorageManager+TimelineReview)', () => {
  it('replaces overlapping ratings and keeps the parts outside the new range', () => {
    store.applyReviewRating({ start: 100, end: 400 }, 'focused')
    store.applyReviewRating({ start: 200, end: 300 }, 'distracted')
    expect(store.reviewRatings({ start: 0, end: 1000 })).toEqual([
      { start: 100, end: 200, rating: 'focused' },
      { start: 200, end: 300, rating: 'distracted' },
      { start: 300, end: 400, rating: 'focused' }
    ])
    expect(store.reviewRatings({ start: 250, end: 260 })).toEqual([{ start: 200, end: 300, rating: 'distracted' }])
  })

  it('ignores empty ranges and keeps thumbs feedback apart', () => {
    store.applyReviewRating({ start: 300, end: 300 }, 'neutral')
    store.rateRange({ start: 100, end: 200 }, 'up')
    expect(store.reviewRatings({ start: 0, end: 1000 })).toEqual([])
    expect(store.hasAnyReviewRating()).toBe(false)
  })

  it('tells whether anyone rated at all, and since when', () => {
    store.applyReviewRating({ start: 1000, end: 2000 }, 'neutral')
    expect(store.hasAnyReviewRating()).toBe(true)
    expect(store.hasReviewRatingSince(1500)).toBe(true)
    expect(store.hasReviewRatingSince(2000)).toBe(false)
  })
})
