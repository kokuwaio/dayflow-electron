// Reads the segment reply of the two-step path into timed observations, like
// upstream OllamaProvider+Transcription.swift (convertSegmentsToObservations).
// Segment times are offsets ("MM:SS" or "HH:MM:SS") from the first sampled
// frame. Times are Unix seconds.

import { jsonArray } from './json'

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

function offsetSeconds(value: unknown): number {
  const parts = String(value ?? '').trim().split(':').map(Number)
  if (parts.length < 2 || parts.length > 3 || parts.some((n) => !Number.isFinite(n))) return 0
  return parts.reduce((total, n) => total * 60 + n, 0)
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
    if (!text || from < -SLACK_SEC || to > duration + SLACK_SEC) continue
    const start = Math.min(Math.max(from, 0), duration)
    const end = Math.min(Math.max(to, 0), duration)
    observations.push({ start: recording.start + start, end: recording.start + Math.max(end, start + 1), text })
  }
  if (observations.length === 0) return { ok: false, issue: 'The reply contains no segments within the recording.' }
  if (observations.length > MAX_SEGMENTS) {
    return { ok: false, issue: `The reply has ${observations.length} segments; use at most ${MAX_SEGMENTS}.` }
  }
  const covered = observations.reduce((sum, o) => sum + (o.end - o.start), 0)
  const coverage = duration > 0 ? covered / duration : 1
  if (coverage < MIN_COVERAGE) {
    return { ok: false, issue: `The segments cover only ${Math.round(coverage * 100)}% of the recording.`, coverage }
  }
  return { ok: true, observations }
}
