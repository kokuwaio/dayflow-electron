// Decides whether a batch was idle enough to skip the model and write an
// Idle card directly. Port of upstream Core/Analysis/IdleBatchClassifier.swift
// and the idle shortcut of AnalysisManager.swift.

import { type Category, isIdleName } from '../../shared/categories'
import { dayKey } from '../../shared/day'

export const IDLE_RULES = {
  version: 'idle_v1',
  minBatchSec: 12 * 60,
  coverageRatio: 0.95,
  qualifiedIdleRatio: 0.9,
  sampleAvailabilityRatio: 0.9,
  qualifyingIdleSec: 60,
  maxUncoveredGapSec: 30,
  /** An Idle card that ended less than this before the batch is extended instead of followed by a new one. */
  mergeGapSec: 5 * 60
} as const

export interface IdleSample {
  /** Unix seconds. */
  capturedAt: number
  /** Seconds without input when the frame was taken; null when unknown. */
  idleSeconds: number | null
}

export interface IdleAssessment {
  version: string
  coverageRatio: number
  largestUncoveredGapSec: number
  screenshotCount: number
  qualifiedIdleRatio: number
}

type Span = { start: number; end: number }

export function assessIdleBatch(shots: readonly IdleSample[]): IdleAssessment | null {
  const ordered = [...shots].sort((a, b) => a.capturedAt - b.capturedAt)
  const first = ordered[0]
  const last = ordered[ordered.length - 1]
  if (!first || !last) return null
  const batchStart = first.capturedAt
  const batchEnd = last.capturedAt
  const duration = batchEnd - batchStart
  if (duration < IDLE_RULES.minBatchSec) return null

  const samples = ordered.filter((s): s is IdleSample & { idleSeconds: number } => (s.idleSeconds ?? 0) > 0)
  if (samples.length === 0) return null

  // Each sample says the user was idle from (capturedAt - idleSeconds) until capturedAt.
  const spans = samples
    .map((s) => ({ start: Math.max(batchStart, s.capturedAt - s.idleSeconds), end: Math.min(batchEnd, s.capturedAt) }))
    .filter((s) => s.end > s.start)
    .sort((a, b) => a.start - b.start || a.end - b.end)
  const merged: Span[] = []
  for (const span of spans) {
    const prev = merged[merged.length - 1]
    if (prev && span.start <= prev.end) prev.end = Math.max(prev.end, span.end)
    else merged.push({ ...span })
  }
  const covered = merged.reduce((sum, s) => sum + (s.end - s.start), 0)

  let largestGap = 0
  let cursor = batchStart
  for (const span of merged) {
    largestGap = Math.max(largestGap, span.start - cursor)
    cursor = Math.max(cursor, span.end)
  }
  largestGap = Math.max(largestGap, batchEnd - cursor)

  const coverageRatio = covered / duration
  const qualifiedIdleRatio = samples.filter((s) => s.idleSeconds >= IDLE_RULES.qualifyingIdleSec).length / ordered.length
  const availability = samples.length / ordered.length
  if (
    coverageRatio < IDLE_RULES.coverageRatio ||
    qualifiedIdleRatio < IDLE_RULES.qualifiedIdleRatio ||
    availability < IDLE_RULES.sampleAvailabilityRatio ||
    largestGap > IDLE_RULES.maxUncoveredGapSec
  ) {
    return null
  }
  return {
    version: IDLE_RULES.version,
    coverageRatio,
    largestUncoveredGapSec: largestGap,
    screenshotCount: ordered.length,
    qualifiedIdleRatio
  }
}

/** The card that ended last before the batch, as far as the idle shortcut needs it. */
export interface PreviousCard {
  id: number
  start: number
  end: number
  title: string
  category: string
}

const floorToMinute = (t: number) => t - (t % 60)

/**
 * Where the Idle card of an idle batch goes, like upstream: it extends the
 * previous card when that is an Idle card of the same 4 AM day that ended
 * less than 5 minutes before the batch; otherwise a new card starts where the
 * previous card ends. Times are whole minutes; null when none is left.
 */
export function idleCardSpan(
  shots: readonly { capturedAt: number }[],
  previous: PreviousCard | null,
  categories: readonly Category[] = []
): { start: number; end: number; extend: number | null } | null {
  const ordered = [...shots].sort((a, b) => a.capturedAt - b.capturedAt)
  const first = ordered[0]
  const last = ordered[ordered.length - 1]
  if (!first || !last) return null
  const extend =
    previous &&
    first.capturedAt - previous.end < IDLE_RULES.mergeGapSec &&
    dayKey(previous.start) === dayKey(first.capturedAt) &&
    isIdleName(previous.title, categories) &&
    isIdleName(previous.category, categories)
      ? previous
      : null
  const end = floorToMinute(last.capturedAt)
  const start = extend ? extend.start : Math.max(floorToMinute(first.capturedAt), previous?.end ?? 0)
  return end > start ? { start, end, extend: extend?.id ?? null } : null
}
