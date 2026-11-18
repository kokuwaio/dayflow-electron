// Reads the segment reply of the two-step path into timed observations, like
// upstream OllamaProvider+Transcription.swift (convertSegmentsToObservations).
// Segment times are offsets ("MM:SS" or "HH:MM:SS") from the first sampled
// frame. Times are Unix seconds.

import { jsonArray } from '../../shared/json'

export interface Observation {
  start: number
  end: number
  text: string
}

export interface Recording {
  /** Time of the first sampled frame. */
  start: number
  durationSec: number
}

export type SegmentResult = { ok: true; observations: Observation[] } | { ok: false; issue: string; coverage?: number }

const MAX_SEGMENTS = 5
const MIN_COVERAGE = 0.8
/** Segments may run this far outside the recording before they are dropped. */
const SLACK_SEC = 30

/**
 * "MM:SS" or "HH:MM:SS" in seconds; null when missing or unreadable. Upstream
 * reads those as 0, which made up a start at the beginning of the recording.
 */
function offsetSeconds(value: unknown): number | null {
  const parts = String(value ?? '').trim().split(':')
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !/^\d+$/.test(p.trim()))) return null
  return parts.map(Number).reduce((total, n) => total * 60 + n, 0)
}

export function parseSegments(reply: string, recording: Recording): SegmentResult {
  const raw = jsonArray(reply, 'segments') ?? []
  const duration = recording.durationSec
  const observations: Observation[] = []
  for (const item of raw) {
    const s = (item ?? {}) as Record<string, unknown>
    const from = offsetSeconds(s.startTimestamp ?? s.start)
    const to = offsetSeconds(s.endTimestamp ?? s.end)
    const text = typeof s.description === 'string' ? s.description.trim() : ''
    if (!text || from === null || to === null || from < -SLACK_SEC || to > duration + SLACK_SEC) continue
    const start = Math.min(Math.max(from, 0), duration)
    const end = Math.min(Math.max(to, 0), duration)
    // A reversed segment, or one left empty by clipping, says nothing about the recording.
    if (end <= start) continue
    observations.push({ start: recording.start + start, end: recording.start + end, text })
  }
  if (observations.length === 0) return { ok: false, issue: 'The reply contains no segments within the recording.' }
  if (observations.length > MAX_SEGMENTS) {
    return { ok: false, issue: `The reply has ${observations.length} segments; use at most ${MAX_SEGMENTS}.` }
  }
  // Later steps take the first start and the last end, so keep time order.
  observations.sort((a, b) => a.start - b.start || a.end - b.end)
  const coverage = duration > 0 ? coveredSeconds(observations) / duration : 1
  if (coverage < MIN_COVERAGE) {
    return { ok: false, issue: `The segments cover only ${Math.round(coverage * 100)}% of the recording.`, coverage }
  }
  return { ok: true, observations }
}

/** Seconds covered by the union of sorted segments, so overlaps count once. */
function coveredSeconds(sorted: Observation[]): number {
  let total = 0
  let reach = -Infinity
  for (const o of sorted) {
    const from = Math.max(o.start, reach)
    if (o.end > from) total += o.end - from
    reach = Math.max(reach, o.end)
  }
  return total
}
