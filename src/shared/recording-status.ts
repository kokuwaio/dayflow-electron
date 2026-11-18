// Settings → Storage → "Recording status", after upstream's
// SettingsStorageTabView.swift (recordingStatusSection) and
// StorageSettingsViewModel.runStorageStatusCheck: the screen permission, the
// recorder's state and, since we store single frames, whether frames still
// arrive and (Linux) whether the capture helper runs.

import type { ScreenAccess } from './permissions'
import { durationLabel, t } from './i18n'
import type { RecorderState } from './types'

/** What the main process reports for a status check. */
export interface RecordingCheck {
  /** process.platform of the main process. */
  platform: string
  screen: ScreenAccess
  recorder: RecorderState
  /** The last capture error, while the recorder backs off. */
  lastError: string | null
  /** Unix seconds of the newest frame (blocked placeholders included); null without frames. */
  lastFrameAt: number | null
  intervalSec: number
  /** The capture process (Linux helper) or capture loop runs. */
  captureRunning: boolean
  /** Unix seconds when it was checked. */
  checkedAt: number
}

export interface StatusRow {
  id: 'permission' | 'recorder' | 'frames' | 'helper'
  label: string
  status: { kind: 'good' | 'warn' | 'bad' | 'neutral'; label: string }
  /** A second line: what went wrong. */
  note: string | null
}

/** A frame is late once three intervals passed, but never before a minute (resume waits 5 s, the helper needs time to start). */
export const lateAfterSec = (intervalSec: number): number => Math.max(60, 3 * intervalSec)

/** "12 s ago", "5m ago", "2h 15m ago". */
export function ageLabel(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return t('settings.storage.check.secondsAgo', { count: s })
  return t('settings.storage.check.ago', { time: durationLabel(Math.floor(s / 60)) })
}

function permissionRow(c: RecordingCheck): StatusRow {
  const label = t('settings.storage.check.permission')
  const granted = c.screen === 'granted'
  if (c.platform === 'darwin') {
    return { id: 'permission', label, status: granted ? { kind: 'good', label: t('permissions.granted') } : { kind: 'bad', label: t('settings.storage.check.missing') }, note: null }
  }
  if (c.platform === 'linux') {
    // Without the restore token the desktop asks again when recording starts.
    return {
      id: 'permission',
      label,
      status: granted ? { kind: 'good', label: t('permissions.allowed') } : { kind: 'warn', label: t('settings.storage.check.asksAtStart') },
      note: null
    }
  }
  return { id: 'permission', label, status: { kind: 'good', label: t('settings.storage.check.notNeeded') }, note: null }
}

function recorderRow(c: RecordingCheck): StatusRow {
  const label = t('settings.storage.check.recorder')
  const row = (kind: StatusRow['status']['kind'], text: string, note: string | null = null): StatusRow => ({ id: 'recorder', label, status: { kind, label: text }, note })
  if (c.platform === 'darwin' && c.screen !== 'granted' && c.recorder !== 'paused' && c.recorder !== 'stopped') return row('bad', t('settings.storage.check.permissionRequired'))
  switch (c.recorder) {
    case 'recording':
      return row('good', t('settings.storage.check.active'))
    case 'paused':
      return row('neutral', t('settings.storage.check.paused'))
    case 'locked':
    case 'sleeping':
      return row('neutral', t('settings.storage.check.idle'))
    case 'backoff':
      return row('bad', t('settings.storage.check.failing'), c.lastError)
    case 'stopped':
      return row('neutral', t('settings.storage.check.notStarted'))
  }
}

function framesRow(c: RecordingCheck): StatusRow {
  const label = t('settings.storage.check.lastFrame')
  const recording = c.recorder === 'recording'
  if (c.lastFrameAt === null) {
    return { id: 'frames', label, status: { kind: recording ? 'warn' : 'neutral', label: t('settings.storage.check.noFrames') }, note: null }
  }
  const age = c.checkedAt - c.lastFrameAt
  const late = recording && age > lateAfterSec(c.intervalSec)
  return {
    id: 'frames',
    label,
    status: { kind: !recording ? 'neutral' : late ? 'warn' : 'good', label: ageLabel(age) },
    note: late ? t('settings.storage.check.lateNote', { interval: c.intervalSec }) : null
  }
}

function helperRow(c: RecordingCheck): StatusRow {
  const label = t('settings.storage.check.helper')
  if (c.captureRunning) return { id: 'helper', label, status: { kind: 'good', label: t('settings.storage.check.running') }, note: null }
  // The helper runs only while recording; paused, locked or asleep it is meant to be off.
  const expected = c.recorder === 'recording'
  return { id: 'helper', label, status: { kind: expected ? 'bad' : 'neutral', label: t('settings.storage.check.notRunning') }, note: null }
}

/** The rows of "Recording status" and whether everything that should work does. */
export function recordingStatusRows(c: RecordingCheck): { rows: StatusRow[]; ok: boolean } {
  const rows = [permissionRow(c), recorderRow(c), framesRow(c), ...(c.platform === 'linux' ? [helperRow(c)] : [])]
  return { rows, ok: rows.every((r) => r.status.kind !== 'bad' && r.status.kind !== 'warn') }
}
