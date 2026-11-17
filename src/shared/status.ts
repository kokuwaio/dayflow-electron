import type { RecorderState } from './types'

/** Pause choices offered in the tray and in the window. null: until resumed. */
export const PAUSE_PRESETS: ReadonlyArray<{ label: string; seconds: number | null }> = [
  { label: 'For 15 minutes', seconds: 15 * 60 },
  { label: 'For 30 minutes', seconds: 30 * 60 },
  { label: 'For 1 hour', seconds: 60 * 60 },
  { label: 'Until I resume', seconds: null }
]

const clock = (ts: number) => new Date(ts * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

/** One line describing the recorder, e.g. "Paused until 3:15 PM". */
export function describeRecorder(state: RecorderState, until: number | null): string {
  switch (state) {
    case 'recording':
      return 'Recording'
    case 'paused':
      return until ? `Paused until ${clock(until)}` : 'Paused'
    case 'locked':
      return 'Paused while locked'
    case 'sleeping':
      return 'Paused while asleep'
    case 'backoff':
      return until ? `Capture failed, retrying at ${clock(until)}` : 'Capture failed'
    case 'stopped':
      return 'Stopped'
  }
}
