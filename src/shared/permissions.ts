// The onboarding permission rows, after upstream's ScreenRecordingPermissionView.swift
// and SystemPermissionRow.swift (Views/Onboarding, Views/UI/Settings): each row has a
// title, one explaining line, a granted state and a Grant button, plus "Quit and
// Reopen" for macOS Screen Recording, which applies only after a restart.
// Upstream asks for Accessibility too; our macOS window detection reads window
// titles through the Screen Recording permission, so that row is left out.

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

const row = (r: Pick<PermissionRow, 'id' | 'title' | 'detail'> & Partial<PermissionRow>): PermissionRow => ({
  status: null,
  actions: [],
  busy: false,
  command: null,
  note: null,
  ...r
})

function macScreenRow(input: PermissionsInput): PermissionRow {
  const base = { id: 'screen' as const, title: 'Screen Recording', detail: 'Periodic screenshots let Dayflow Electron write your timeline for you.' }
  if (input.screen === null) return row({ ...base, status: { kind: 'neutral', label: 'Checking…' } })
  if (input.screen === 'granted') return row({ ...base, status: { kind: 'good', label: 'Granted' } })
  return row({
    ...base,
    status: { kind: 'warn', label: 'Not granted' },
    actions: input.requested ? ['grant', 'relaunch'] : ['grant'],
    busy: input.busy,
    note:
      input.error ??
      (input.requested
        ? 'Turn on Dayflow Electron in System Settings → Privacy & Security → Screen Recording, then quit and reopen the app.'
        : null)
  })
}

function linuxScreenRow(input: PermissionsInput): PermissionRow {
  const base = {
    id: 'screen' as const,
    title: 'Screen sharing',
    detail:
      'Your desktop asks which screens to share. Choose all screens and allow restoring the permission, so it does not ask again. The app keeps only the screen under your mouse.'
  }
  if (input.screen === null) return row({ ...base, status: { kind: 'neutral', label: 'Checking…' } })
  if (input.screen === 'granted') return row({ ...base, status: { kind: 'good', label: 'Allowed' } })
  return row({
    ...base,
    status: { kind: 'warn', label: 'Not allowed yet' },
    actions: ['grant'],
    busy: input.busy,
    note: input.error
  })
}

function linuxWindowRow({ window }: PermissionsInput): PermissionRow {
  const base = {
    id: 'window' as const,
    title: 'Window detection (optional)',
    detail: 'Blocked apps such as password managers are left out of recordings only where the app can see the active window.'
  }
  if (window.state === 'checking') return row({ ...base, status: { kind: 'neutral', label: 'Checking…' } })
  if (window.state === 'ok') return row({ ...base, status: { kind: 'good', label: 'Works' } })
  if (window.command) {
    return row({
      ...base,
      detail: `${base.detail} In the Flatpak on KDE Plasma, run this command once, then restart the app.`,
      status: { kind: 'warn', label: 'Needs permission' },
      actions: ['recheck'],
      command: window.command
    })
  }
  return row({
    ...base,
    detail: `${base.detail} Where it is not available, pause recording before opening a password manager.`,
    status: { kind: 'warn', label: 'Not available' },
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
    rows: [row({ id: 'none', title: 'Nothing to allow', detail: 'Windows needs no permission for screenshots. Recording starts as soon as you launch.' })],
    canContinue: true,
    skippable: false
  }
}
