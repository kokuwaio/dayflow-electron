import { describe, expect, it } from 'vitest'
import { type RecordingCheck, ageLabel, lateAfterSec, recordingStatusRows } from './recording-status'

const NOW = 1_800_000_000
const check = (over: Partial<RecordingCheck>): RecordingCheck => ({
  platform: 'linux',
  screen: 'granted',
  recorder: 'recording',
  lastError: null,
  lastFrameAt: NOW - 8,
  intervalSec: 10,
  captureRunning: true,
  checkedAt: NOW,
  ...over
})
const row = (c: RecordingCheck, id: string) => recordingStatusRows(c).rows.find((r) => r.id === id)

describe('recording status on Linux', () => {
  it('is all good while frames arrive and the helper runs', () => {
    const view = recordingStatusRows(check({}))
    expect(view.ok).toBe(true)
    expect(view.rows.map((r) => [r.id, r.label, r.status.kind, r.status.label])).toEqual([
      ['permission', 'Screen recording permission', 'good', 'Allowed'],
      ['recorder', 'Recorder', 'good', 'Active'],
      ['frames', 'Last frame', 'good', '8 s ago'],
      ['helper', 'Capture helper', 'good', 'Running']
    ])
  })

  it('warns when no frame came for three intervals (at least a minute) while recording', () => {
    expect(lateAfterSec(10)).toBe(60)
    expect(lateAfterSec(60)).toBe(180)
    const late = row(check({ lastFrameAt: NOW - 300 }), 'frames')!
    expect(late.status).toEqual({ kind: 'warn', label: '5m ago' })
    expect(late.note).toMatch(/every 10 s/)
    expect(row(check({ lastFrameAt: NOW - 59 }), 'frames')!.status.kind).toBe('good')
  })

  it('flags a helper that should run but does not', () => {
    const view = recordingStatusRows(check({ captureRunning: false }))
    expect(view.ok).toBe(false)
    expect(row(check({ captureRunning: false }), 'helper')!.status).toEqual({ kind: 'bad', label: 'Not running' })
  })

  it('treats a paused or locked recorder as idle, with an old frame and no helper as expected', () => {
    for (const recorder of ['paused', 'locked', 'sleeping'] as const) {
      const view = recordingStatusRows(check({ recorder, lastFrameAt: NOW - 3 * 3600, captureRunning: false }))
      expect(view.ok).toBe(true)
      expect(view.rows.map((r) => r.status.kind)).toEqual(['good', 'neutral', 'neutral', 'neutral'])
    }
    expect(row(check({ recorder: 'paused' }), 'recorder')!.status.label).toBe('Paused')
    expect(row(check({ recorder: 'locked' }), 'recorder')!.status.label).toBe('Idle')
  })

  it('shows the capture error while the recorder backs off', () => {
    const r = row(check({ recorder: 'backoff', lastError: 'Start: cancelled by the user', captureRunning: false }), 'recorder')!
    expect(r.status).toEqual({ kind: 'bad', label: 'Capture failing, retrying' })
    expect(r.note).toBe('Start: cancelled by the user')
  })

  it('warns that the share dialog comes up again without the restore token', () => {
    expect(row(check({ screen: 'not-granted' }), 'permission')!.status).toEqual({ kind: 'warn', label: 'Asks when recording starts' })
  })

  it('says when there are no frames yet', () => {
    expect(row(check({ lastFrameAt: null }), 'frames')!.status).toEqual({ kind: 'warn', label: 'No frames yet' })
    expect(row(check({ lastFrameAt: null, recorder: 'stopped' }), 'frames')!.status.kind).toBe('neutral')
  })
})

describe('recording status on macOS and Windows', () => {
  it('needs Screen Recording on macOS (upstream: Missing, Permission required) and has no helper row', () => {
    const view = recordingStatusRows(check({ platform: 'darwin', screen: 'not-granted' }))
    expect(view.rows.map((r) => r.id)).toEqual(['permission', 'recorder', 'frames'])
    expect(view.rows[0]!.status).toEqual({ kind: 'bad', label: 'Missing' })
    expect(view.rows[1]!.status).toEqual({ kind: 'bad', label: 'Permission required' })
    expect(recordingStatusRows(check({ platform: 'darwin' })).rows[0]!.status).toEqual({ kind: 'good', label: 'Granted' })
  })

  it('needs no permission on Windows', () => {
    expect(row(check({ platform: 'win32', screen: 'granted' }), 'permission')!.status).toEqual({ kind: 'good', label: 'Not needed' })
  })
})

describe('ageLabel', () => {
  it('counts seconds, then minutes and hours', () => {
    expect(ageLabel(1)).toBe('1 s ago')
    expect(ageLabel(59)).toBe('59 s ago')
    expect(ageLabel(61)).toBe('1m ago')
    expect(ageLabel(2 * 3600 + 15 * 60)).toBe('2h 15m ago')
  })
})
