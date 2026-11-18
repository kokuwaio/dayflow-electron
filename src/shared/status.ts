import { clockLabel, t } from './i18n'
import type { RecorderState } from './types'

/** Pause choices offered in the tray and in the window. null: until resumed. */
export const PAUSE_PRESETS: ReadonlyArray<{ seconds: number | null }> = [{ seconds: 15 * 60 }, { seconds: 30 * 60 }, { seconds: 60 * 60 }, { seconds: null }]

/** A preset's menu label, e.g. "For 15 minutes". */
export function pauseLabel(seconds: number | null): string {
  if (seconds === null) return t('pause.untilResumed')
  return seconds >= 3600 ? t('pause.forHours', { count: seconds / 3600 }) : t('pause.forMinutes', { count: seconds / 60 })
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
