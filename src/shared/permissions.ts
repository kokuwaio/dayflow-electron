// The onboarding permission rows, after upstream's ScreenRecordingPermissionView.swift
// and SystemPermissionRow.swift (Views/Onboarding, Views/UI/Settings): each row has a
// title, one explaining line, a granted state and a Grant button, plus "Quit and
// Reopen" for macOS Screen Recording, which applies only after a restart.
// Upstream asks for Accessibility too; our macOS window detection reads window
// titles through the Screen Recording permission, so that row is left out.

import { t } from './i18n'

/** Whether screen capture may run without asking (macOS permission, Linux restore token). */
export type ScreenAccess = 'granted' | 'not-granted'

/** What the main process knows about screen capture permission. */
export interface ScreenPermission {
  screen: ScreenAccess
  /** Grant was clicked since the app started. */
  requested: boolean
}

/** The result of one window-detection check (Linux). */
export interface WindowCheck {
  state: 'checking' | 'ok' | 'unavailable'
  reason: string | null
  /** A command that fixes it (Flatpak KWin permission). */
  command: string | null
}

export interface PermissionsInput {
  /** process.platform of the main process. */
  platform: string
  /** null while it loads. */
  screen: ScreenAccess | null
  /** Grant was clicked: macOS then offers Quit and Reopen. */
  requested: boolean
  /** The Grant action runs (Linux share dialog open). */
  busy: boolean
  /** Why the last Grant failed. */
  error: string | null
  /** Linux only. */
  window: WindowCheck
}

export type PermissionAction = 'grant' | 'relaunch' | 'recheck'

export interface PermissionRow {
  id: 'screen' | 'window' | 'none'
  title: string
  detail: string
  /** null: a row without a state (Windows). */
  status: { kind: 'good' | 'warn' | 'neutral'; label: string } | null
  actions: PermissionAction[]
  busy: boolean
  /** A command to copy. */
  command: string | null
  /** A second line under the detail: what to do next or what went wrong. */
  note: string | null
}

export interface PermissionsView {
  rows: PermissionRow[]
  /** Next is enabled (upstream: only once every permission is granted). */
  canContinue: boolean
  /** Offer "Skip for now" while Next is blocked. */
  skippable: boolean
}

export const kwinOverrideCommand = (appId: string): string => `flatpak override --user --talk-name=org.kde.KWin ${appId}`

/** The command that grants window detection, when the check failed on the Flatpak's missing KWin access. */
export function windowFixCommand(reason: string | null, flatpakId: string): string | null {
  return flatpakId && reason && /KWin/.test(reason) ? kwinOverrideCommand(flatpakId) : null
}

/**
 * Window detection as the running recorder sees it. While it records, a probe
 * would start a second KWin watcher under the same script name and stop the
 * recorder's, so Settings reads the recorder's state instead.
 */
export function liveWindowCheck(
  recorder: { windowDetection: 'ok' | 'unavailable' | 'starting'; windowDetectionError: string | null },
  flatpakId: string
): WindowCheck {
  if (recorder.windowDetection === 'starting') return { state: 'checking', reason: null, command: null }
  if (recorder.windowDetection === 'ok') return { state: 'ok', reason: null, command: null }
  return { state: 'unavailable', reason: recorder.windowDetectionError, command: windowFixCommand(recorder.windowDetectionError, flatpakId) }
}

const row = (r: Pick<PermissionRow, 'id' | 'title' | 'detail'> & Partial<PermissionRow>): PermissionRow => ({
  status: null,
  actions: [],
  busy: false,
  command: null,
  note: null,
  ...r
})

function macScreenRow(input: PermissionsInput): PermissionRow {
  const base = { id: 'screen' as const, title: t('permissions.macScreen.title'), detail: t('permissions.macScreen.detail') }
  if (input.screen === null) return row({ ...base, status: { kind: 'neutral', label: t('permissions.checking') } })
  if (input.screen === 'granted') return row({ ...base, status: { kind: 'good', label: t('permissions.granted') } })
  return row({
    ...base,
    status: { kind: 'warn', label: t('permissions.notGranted') },
    actions: input.requested ? ['grant', 'relaunch'] : ['grant'],
    busy: input.busy,
    note:
      input.error ??
      (input.requested
        ? t('permissions.macScreen.turnOn')
        : null)
  })
}

function linuxScreenRow(input: PermissionsInput): PermissionRow {
  const base = {
    id: 'screen' as const,
    title: t('permissions.linuxScreen.title'),
    detail: t('permissions.linuxScreen.detail')
  }
  if (input.screen === null) return row({ ...base, status: { kind: 'neutral', label: t('permissions.checking') } })
  if (input.screen === 'granted') return row({ ...base, status: { kind: 'good', label: t('permissions.allowed') } })
  return row({
    ...base,
    status: { kind: 'warn', label: t('permissions.notAllowedYet') },
    actions: ['grant'],
    busy: input.busy,
    note: input.error
  })
}

function linuxWindowRow({ window }: PermissionsInput): PermissionRow {
  const base = {
    id: 'window' as const,
    title: t('permissions.window.title'),
    detail: t('permissions.window.detail')
  }
  if (window.state === 'checking') return row({ ...base, status: { kind: 'neutral', label: t('permissions.checking') } })
  if (window.state === 'ok') return row({ ...base, status: { kind: 'good', label: t('permissions.works') } })
  if (window.command) {
    return row({
      ...base,
      detail: t('permissions.window.detailFlatpak'),
      status: { kind: 'warn', label: t('permissions.needsPermission') },
      actions: ['recheck'],
      command: window.command
    })
  }
  return row({
    ...base,
    detail: t('permissions.window.detailUnavailable'),
    status: { kind: 'warn', label: t('permissions.notAvailable') },
    actions: ['recheck'],
    note: window.reason
  })
}

/** The rows of the Permissions step and whether Next is enabled. */
export function permissionsView(input: PermissionsInput): PermissionsView {
  if (input.platform === 'darwin') {
    const granted = input.screen === 'granted'
    return { rows: [macScreenRow(input)], canContinue: granted, skippable: !granted }
  }
  if (input.platform === 'linux') {
    // Not blocking: without the restore token the dialog comes up when recording starts.
    return { rows: [linuxScreenRow(input), linuxWindowRow(input)], canContinue: true, skippable: false }
  }
  return {
    rows: [row({ id: 'none', title: t('permissions.windows.title'), detail: t('permissions.windows.detail') })],
    canContinue: true,
    skippable: false
  }
}
