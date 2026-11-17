// The timeline review: rating cards as distracted, neutral or focused, after
// upstream Dayflow (Core/Recording/StorageManager+TimelineReview.swift,
// Views/UI/TimelineReviewOverlay.swift, Views/Components/DaySummaryStats.swift
// and TimelineReviewSummaryCard.swift). Ratings live in upstream's
// timeline_review_ratings table as time ranges, not per card.

import { SYSTEM_CATEGORY } from './categories'
import { dayRange } from './day'
import type { TimelineCard } from './types'

export const REVIEW_RATINGS = ['distracted', 'neutral', 'focused'] as const
export type ReviewRating = (typeof REVIEW_RATINGS)[number]

export interface ReviewSegment {
  start: number
  end: number
  rating: ReviewRating
}

/** A card counts as reviewed once this share of it is rated (upstream coverageThreshold). */
export const REVIEW_COVERAGE = 0.8

/** Rated ranges clipped to [from, to), sorted and merged. */
function merged(segments: ReviewSegment[], from: number, to: number): Array<{ start: number; end: number }> {
  const clipped = segments
    .map((s) => ({ start: Math.max(s.start, from), end: Math.min(s.end, to) }))
    .filter((s) => s.end > s.start)
    .sort((a, b) => a.start - b.start)
  const out: Array<{ start: number; end: number }> = []
  for (const s of clipped) {
    const last = out[out.length - 1]
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end)
    else out.push({ ...s })
  }
  return out
}

/** The day's cards still to review: all but failed ones, in time order, rated under 80%. */
export function unreviewedCards(cards: TimelineCard[], segments: ReviewSegment[], day: string): TimelineCard[] {
  const { start, end } = dayRange(day)
  const covered = merged(segments, start, end)
  return cards
    .filter((c) => c.category.trim().toLowerCase() !== SYSTEM_CATEGORY.toLowerCase())
    .sort((a, b) => a.start - b.start || a.id - b.id)
    .filter((c) => {
      const rated = covered.reduce((sum, s) => sum + Math.max(0, Math.min(c.end, s.end) - Math.max(c.start, s.start)), 0)
      return rated / Math.max(c.end - c.start, 1) < REVIEW_COVERAGE
    })
}

export interface ReviewSummary {
  distracted: number
  neutral: number
  focused: number
  /** Seconds rated in all. */
  total: number
  /** The end of the latest rated range (upstream's "Last reviewed at"), or null. */
  lastReviewedAt: number | null
}

/** Rated seconds per rating within the day's 4 AM window. */
export function reviewSummary(segments: ReviewSegment[], day: string): ReviewSummary {
  const { start, end } = dayRange(day)
  const out: ReviewSummary = { distracted: 0, neutral: 0, focused: 0, total: 0, lastReviewedAt: null }
  for (const s of segments) {
    const from = Math.max(s.start, start)
    const to = Math.min(s.end, end)
    if (to <= from || !REVIEW_RATINGS.includes(s.rating)) continue
    out[s.rating] += to - from
    out.total += to - from
    out.lastReviewedAt = Math.max(out.lastReviewedAt ?? to, to)
  }
  return out
}

/**
 * How many cards the "Review cards" badge and link announce: none for people
 * who rated before but not in the last 7 days (upstream cardsToReviewPromptCount).
 */
export function cardsToReviewPrompt(count: number, history: { hasAny: boolean; hasRecent: boolean }): number {
  return count > 0 && (history.hasRecent || !history.hasAny) ? count : 0
}
