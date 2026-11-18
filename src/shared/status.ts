import { spelledDuration } from './goal-flow'
import { clockLabel, durationLabel, t } from './i18n'
import type { RecorderState } from './types'

/** The three timed pause lengths, editable in Settings → Other (upstream PausePresets in App/PauseManager.swift). */
export const DEFAULT_PAUSE_MINUTES: readonly [number, number, number] = [15, 30, 60]
/** Upstream's choices for each of them. */
export const PAUSE_MINUTE_OPTIONS = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 480] as const

/** Three lengths from the options, or the defaults (upstream keeps a stored list only when it has three). */
export function sanitizePauseMinutes(value: unknown): [number, number, number] {
  const ok =
    Array.isArray(value) && value.length === DEFAULT_PAUSE_MINUTES.length && value.every((m) => (PAUSE_MINUTE_OPTIONS as readonly number[]).includes(m as number))
  return ok ? ([...value] as [number, number, number]) : [...DEFAULT_PAUSE_MINUTES]
}

/** Pause choices offered in the tray and in the window, shortest first and without repeats; null: until resumed. */
export function pausePresets(minutes: readonly number[] = DEFAULT_PAUSE_MINUTES): Array<{ seconds: number | null }> {
  const timed = [...new Set(sanitizePauseMinutes(minutes))].sort((a, b) => a - b)
  return [...timed.map((m) => ({ seconds: m * 60 })), { seconds: null }]
}

/** The default choices: 15, 30 and 60 minutes, and until resumed. */
export const PAUSE_PRESETS: ReadonlyArray<{ seconds: number | null }> = pausePresets()

/** A preset's menu label, e.g. "For 15 minutes", "For 1 hour, 30 minutes". */
export function pauseLabel(seconds: number | null): string {
  if (seconds === null) return t('pause.untilResumed')
  const minutes = Math.round(seconds / 60)
  if (minutes >= 60 && minutes % 60) return t('pause.forDuration', { time: spelledDuration(minutes) })
  return minutes >= 60 ? t('pause.forHours', { count: minutes / 60 }) : t('pause.forMinutes', { count: minutes })
}

/** A chip's short text: "15m", "1h", "1h 30m" or ∞ (upstream PauseDuration.shortLabel). */
export function pauseChipLabel(seconds: number | null): string {
  return seconds === null ? '∞' : durationLabel(Math.round(seconds / 60))
}

/** A chip's tooltip, e.g. "Pause for 15 minutes". */
export function pauseChipTitle(seconds: number | null): string {
  if (seconds === null) return t('pause.chipUntilResumed')
  const minutes = Math.round(seconds / 60)
  if (minutes >= 60 && minutes % 60) return t('pause.chipDuration', { time: spelledDuration(minutes) })
  return minutes >= 60 ? t('pause.chipHours', { count: minutes / 60 }) : t('pause.chipMinutes', { count: minutes })
}

/** One line describing the recorder, e.g. "Paused until 3:15 PM". */
export function describeRecorder(state: RecorderState, until: number | null): string {
  switch (state) {
    case 'recording':
      return t('recorder.recording')
    case 'paused':
      return until ? t('recorder.pausedUntil', { time: clockLabel(until) }) : t('recorder.paused')
    case 'locked':
      return t('recorder.locked')
    case 'sleeping':
      return t('recorder.sleeping')
    case 'backoff':
      return until ? t('recorder.backoffUntil', { time: clockLabel(until) }) : t('recorder.backoff')
    case 'stopped':
      return t('recorder.stopped')
  }
}
