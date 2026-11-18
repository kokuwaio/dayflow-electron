import { describe, expect, it } from 'vitest'
import { type PermissionsInput, kwinOverrideCommand, liveWindowCheck, permissionsView, windowFixCommand } from './permissions'

const input = (over: Partial<PermissionsInput>): PermissionsInput => ({
  platform: 'linux',
  screen: 'not-granted',
  requested: false,
  busy: false,
  error: null,
  window: { state: 'checking', reason: null, command: null },
  ...over
})

const row = (view: ReturnType<typeof permissionsView>, id: string) => view.rows.find((r) => r.id === id)!

describe('permissionsView on macOS', () => {
  it('blocks Next until Screen Recording is granted and offers Grant', () => {
    const view = permissionsView(input({ platform: 'darwin' }))
    expect(view.rows.map((r) => r.id)).toEqual(['screen'])
    expect(view.canContinue).toBe(false)
    expect(view.skippable).toBe(true)
    expect(row(view, 'screen')).toMatchObject({ title: 'Screen Recording', status: { kind: 'warn' }, actions: ['grant'] })
  })

  it('offers Quit and Reopen once Grant was clicked, as macOS applies it after a restart', () => {
    const screen = row(permissionsView(input({ platform: 'darwin', requested: true })), 'screen')
    expect(screen.actions).toEqual(['grant', 'relaunch'])
    expect(screen.note).toMatch(/quit and reopen/i)
  })

  it('shows Granted and lets the user continue', () => {
    const view = permissionsView(input({ platform: 'darwin', screen: 'granted', requested: true }))
    expect(view.canContinue).toBe(true)
    expect(view.skippable).toBe(false)
    expect(row(view, 'screen')).toMatchObject({ status: { kind: 'good', label: 'Granted' }, actions: [], note: null })
  })

  it('shows nothing yet while the status loads', () => {
    const view = permissionsView(input({ platform: 'darwin', screen: null }))
    expect(view.canContinue).toBe(false)
    expect(row(view, 'screen')).toMatchObject({ status: { kind: 'neutral' }, actions: [] })
  })
})

describe('permissionsView on Linux', () => {
  it('never blocks Next: the share dialog can still come up at the first recording', () => {
    const view = permissionsView(input({}))
    expect(view.canContinue).toBe(true)
    expect(view.skippable).toBe(false)
    expect(view.rows.map((r) => r.id)).toEqual(['screen', 'window'])
  })

  it('offers to open the share dialog now until the restore token exists', () => {
    expect(row(permissionsView(input({})), 'screen')).toMatchObject({ title: 'Screen sharing', status: { kind: 'warn' }, actions: ['grant'] })
    expect(row(permissionsView(input({ screen: 'granted' })), 'screen')).toMatchObject({ status: { kind: 'good', label: 'Allowed' }, actions: [] })
  })

  it('disables Grant while the dialog is open and shows why the last attempt failed', () => {
    expect(row(permissionsView(input({ busy: true })), 'screen')).toMatchObject({ busy: true, actions: ['grant'] })
    expect(row(permissionsView(input({ error: 'Start: cancelled' })), 'screen').note).toBe('Start: cancelled')
  })

  it('shows the window check as it runs and when it works', () => {
    expect(row(permissionsView(input({})), 'window')).toMatchObject({ title: 'Window detection (optional)', status: { kind: 'neutral' }, actions: [] })
    const ok = row(permissionsView(input({ window: { state: 'ok', reason: null, command: null } })), 'window')
    expect(ok).toMatchObject({ status: { kind: 'good', label: 'Works' }, actions: [], command: null, note: null })
  })

  it('shows the Flatpak command and Check again when KWin access is missing', () => {
    const command = kwinOverrideCommand('io.example.App')
    const view = permissionsView(input({ window: { state: 'unavailable', reason: 'Window detection needs KWin access.', command } }))
    expect(row(view, 'window')).toMatchObject({ status: { kind: 'warn' }, actions: ['recheck'], command, note: null })
    expect(view.canContinue).toBe(true)
  })

  it('explains other failures with their reason', () => {
    const view = permissionsView(input({ window: { state: 'unavailable', reason: 'Window detection works on KDE Plasma only so far.', command: null } }))
    expect(row(view, 'window')).toMatchObject({ status: { kind: 'warn', label: 'Not available' }, actions: ['recheck'], command: null })
    expect(row(view, 'window').note).toBe('Window detection works on KDE Plasma only so far.')
    expect(row(view, 'window').detail).toMatch(/pause recording/i)
  })
})

describe('permissionsView on Windows', () => {
  it('has nothing to allow', () => {
    const view = permissionsView(input({ platform: 'win32', screen: 'granted' }))
    expect(view.rows).toHaveLength(1)
    expect(view.rows[0]).toMatchObject({ id: 'none', title: 'Nothing to allow', status: null, actions: [] })
    expect(view.canContinue).toBe(true)
  })
})

describe('windowFixCommand', () => {
  it('gives the override command only for a missing KWin permission inside Flatpak', () => {
    expect(windowFixCommand('Window detection needs KWin access.', 'io.example.App')).toBe(
      'flatpak override --user --talk-name=org.kde.KWin io.example.App'
    )
    expect(windowFixCommand('Window detection needs KWin access.', '')).toBeNull()
    expect(windowFixCommand('Window detection works on KDE Plasma only so far.', 'io.example.App')).toBeNull()
    expect(windowFixCommand(null, 'io.example.App')).toBeNull()
  })
})

describe('liveWindowCheck', () => {
  const kwin = 'Window detection needs KWin access. Run "flatpak override …" once, then restart the app.'

  it("reads the running recorder's window detection instead of starting a second watcher", () => {
    expect(liveWindowCheck({ windowDetection: 'ok', windowDetectionError: null }, 'io.example.App')).toEqual({ state: 'ok', reason: null, command: null })
    expect(liveWindowCheck({ windowDetection: 'starting', windowDetectionError: null }, '')).toEqual({ state: 'checking', reason: null, command: null })
  })

  it('offers the KWin command when the recorder found the permission missing in the Flatpak', () => {
    expect(liveWindowCheck({ windowDetection: 'unavailable', windowDetectionError: kwin }, 'io.example.App')).toEqual({
      state: 'unavailable',
      reason: kwin,
      command: kwinOverrideCommand('io.example.App')
    })
    expect(liveWindowCheck({ windowDetection: 'unavailable', windowDetectionError: 'GNOME' }, 'io.example.App').command).toBeNull()
  })
})
