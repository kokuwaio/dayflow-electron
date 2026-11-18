// Groups screenshots into analysis batches like upstream
// (Core/Analysis/AnalysisManager.swift createScreenshotBatches). All times
// are Unix seconds.

export const BATCHING = {
  /** A batch closes once it would span more than this. */
  targetSec: 15 * 60,
  /** A pause longer than this starts a new batch. */
  maxGapSec: 2 * 60,
  /** Batches shorter than this are skipped, not analyzed. */
  minDurationSec: 5 * 60,
  /** Cards ending this long before a batch's end are context for it. */
  cardLookbackSec: 45 * 60
} as const

export interface ShotRef {
  id: number
  capturedAt: number
}

export interface PlannedBatch {
  start: number
  end: number
  shotIds: number[]
}

export function planBatches(shots: readonly ShotRef[], now: number): PlannedBatch[] {
  const sorted = [...shots].sort((a, b) => a.capturedAt - b.capturedAt)
  const batches: ShotRef[][] = []
  let bucket: ShotRef[] = []
  for (const s of sorted) {
    const first = bucket[0]
    const last = bucket[bucket.length - 1]
    if (first && last && (s.capturedAt - last.capturedAt > BATCHING.maxGapSec || s.capturedAt - first.capturedAt > BATCHING.targetSec)) {
      batches.push(bucket)
      bucket = []
    }
    bucket.push(s)
  }
  if (bucket.length > 0) {
    const first = bucket[0]!
    const last = bucket[bucket.length - 1]!
    // The newest batch may still grow, unless it is full or the next
    // screenshot would start a new batch anyway.
    const full = last.capturedAt - first.capturedAt >= BATCHING.targetSec
    const ended = now - last.capturedAt > BATCHING.maxGapSec
    if (full || ended) batches.push(bucket)
  }
  return batches.map((b) => ({ start: b[0]!.capturedAt, end: b[b.length - 1]!.capturedAt, shotIds: b.map((s) => s.id) }))
}
