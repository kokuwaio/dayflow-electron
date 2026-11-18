// The storage limit and disk-use estimates of Settings → Storage, after
// upstream's StorageSettingsViewModel.swift (storageOptions, handleLimitSelection,
// recordingEstimateText) and StorageManager+Screenshots.swift
// (observedRecordingBytesPerHour). Upstream stores HEVC video; we store JPEGs,
// so the per-frame sizes are our own measurements (docs/platform-notes.md).

import { numberLabel, t } from './i18n'

/** Upstream's choices in GB; 0 is "Unlimited". */
export const STORAGE_LIMIT_PRESETS = [1, 2, 3, 5, 10, 20, 0] as const
export const UNLIMITED = 0

const GB = 1024 ** 3

/**
 * A stored limit as one of the presets: the smallest preset at or above it,
 * and "Unlimited" above 20 GB, so a limit never deletes more than the user
 * asked for (upstream indexForLimit).
 */
export function snapStorageLimit(gb: unknown, fallback = 10): number {
  const n = Number(gb)
  if (gb === null || gb === undefined || gb === '' || !Number.isFinite(n) || n < 0) return fallback
  if (n === UNLIMITED) return UNLIMITED
  return STORAGE_LIMIT_PRESETS.find((p) => p !== UNLIMITED && n <= p) ?? UNLIMITED
}

/** The limit in bytes; Infinity for "Unlimited". */
export const limitBytes = (gb: number): number => (gb === UNLIMITED ? Infinity : gb * GB)

/**
 * What picking a new limit does: nothing, apply it, or ask first because a
 * lower limit deletes the oldest recordings right away.
 */
export function limitChange(currentGb: number, nextGb: number): 'none' | 'apply' | 'confirm' {
  const current = limitBytes(currentGb)
  const next = limitBytes(nextGb)
  if (next === current) return 'none'
  return next < current ? 'confirm' : 'apply'
}

/** A preset's label: "10 GB" or "Unlimited". */
export const limitLabel = (gb: number): string => (gb === UNLIMITED ? t('settings.storage.unlimited') : t('settings.storage.gb', { size: gb }))

/** Average JPEG size per frame, measured with the Linux helper and Electron at quality 80 (about 25 and 52 MB per hour at 10 s). */
export const BYTES_PER_FRAME = { 720: 70_000, 1080: 145_000 } as const

/** Expected disk use per recorded hour for a resolution and capture interval. */
export function estimatedBytesPerHour(height: number, intervalSec: number): number {
  const perFrame = height <= 720 ? BYTES_PER_FRAME[720] : BYTES_PER_FRAME[1080]
  return Math.round(perFrame * (3600 / Math.max(1, intervalSec)))
}

/** Upstream's month: 8 recorded hours a day for 30 days. */
export const estimatedBytesPerMonth = (perHour: number): number => perHour * 8 * 30

/**
 * Bytes per hour measured from the frames of the last hour (upstream
 * observedRecordingBytesPerHour): their total over the time they span, once
 * they span at least 10 minutes; null before that.
 */
export function observedBytesPerHour(frames: ReadonlyArray<{ capturedAt: number; bytes: number }>, nowSec: number): number | null {
  const recent = frames.filter((f) => f.capturedAt >= nowSec - 3600)
  if (recent.length < 2) return null
  let first = Infinity
  let last = -Infinity
  let bytes = 0
  for (const f of recent) {
    first = Math.min(first, f.capturedAt)
    last = Math.max(last, f.capturedAt)
    bytes += f.bytes
  }
  const span = last - first
  return span >= 600 ? Math.round((bytes * 3600) / span) : null
}

/** "850 MB" below 1 GB, else "1.5 GB" (upstream's ByteCountFormatter with MB and GB only). */
export function sizeLabel(bytes: number): string {
  if (bytes < GB) return t('settings.storage.mb', { size: numberLabel(Math.round(bytes / 1024 ** 2), 0) })
  return t('settings.storage.gb', { size: numberLabel(bytes / GB, bytes < 10 * GB ? 1 : 0) })
}

/** Used share of the limit, 0 to 1; null for "Unlimited". */
export const usedShare = (bytes: number, limitGb: number): number | null => (limitGb === UNLIMITED ? null : Math.min(1, bytes / limitBytes(limitGb)))

/** Bytes of the stored frames together. */
export const totalBytes = (frames: ReadonlyArray<{ bytes: number }>): number => frames.reduce((sum, f) => sum + f.bytes, 0)
