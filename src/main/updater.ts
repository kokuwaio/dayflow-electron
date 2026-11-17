// Auto-update for the Windows (NSIS) and macOS builds with electron-updater
// from GitHub Releases, in place of upstream's Sparkle. The policy (which
// builds, which versions, when) lives in src/shared/updates.ts.
// - "install": checks at start and every 6 hours, downloads in the
//   background while "Install updates automatically" is on (otherwise on a
//   click), installs on the next quit, and offers "Restart to update" in the
//   tray and a notification.
// - "notify" (macOS without a Developer ID signature, which Squirrel.Mac
//   needs to install): only tells that a version is out and opens its page.

import { Notification, shell } from 'electron'
import {
  FIRST_CHECK_DELAY_MS,
  type UpdateAction,
  type UpdateState,
  acceptUpdate,
  checkDue,
  releaseUrl,
  updateMenuItem
} from '../shared/updates'

export interface Updater {
  /** The tray entry, if an update is under way. */
  menuItem(): { label: string; click?: () => void } | null
  /** Follows the "Install updates automatically" setting. */
  setAutoInstall(on: boolean): void
}

export async function startUpdater(o: {
  mode: 'install' | 'notify'
  currentVersion: string
  autoInstall: boolean
  /** The "Check for updates" setting; nothing is fetched from GitHub while it is off. */
  enabled: () => boolean
  log: (message: string) => void
  /** The tray needs redrawing. */
  changed: () => void
  /** Lets the windows close: quitAndInstall closes them before the app quits. */
  beforeRestart: () => void
}): Promise<Updater> {
  // CommonJS package: its named exports are getters ES modules cannot see.
  const { default: electronUpdater } = await import('electron-updater')
  const updater = electronUpdater.autoUpdater
  const log = (level: string) => (message?: unknown) => o.log(`updates: ${level ? `${level}: ` : ''}${String(message)}`)
  updater.logger = { info: log(''), warn: log('warning'), error: log('error') }
  updater.allowPrerelease = false
  updater.allowDowngrade = false

  let autoInstall = o.autoInstall
  let state: UpdateState = { kind: 'idle' }
  let lastCheck: number | null = null
  const notified = new Set<string>()
  const install = o.mode === 'install'
  const apply = () => {
    updater.autoDownload = install && autoInstall
    updater.autoInstallOnAppQuit = install && autoInstall
  }
  apply()
  const set = (next: UpdateState) => {
    state = next
    o.changed()
  }

  const notify = (key: string, title: string, body: string, click: () => void) => {
    if (notified.has(key) || !Notification.isSupported()) return
    notified.add(key)
    const n = new Notification({ title, body })
    n.on('click', click)
    n.show()
  }

  const download = () => {
    if (state.kind !== 'available') return
    set({ kind: 'downloading', version: state.version, percent: 0 })
    // Asked for by hand: install on quit too, as the "ready" notification says.
    updater.autoInstallOnAppQuit = install
    updater.downloadUpdate().catch(() => {}) // reported through the "error" event
  }
  const restart = () => {
    o.beforeRestart()
    updater.quitAndInstall()
  }
  const run = (action: UpdateAction) => {
    if (action === 'download') download()
    else if (action === 'restart') restart()
    else if (state.kind === 'available') void shell.openExternal(releaseUrl(state.version))
  }

  updater.on('update-available', (info) => {
    if (!acceptUpdate(info.version, o.currentVersion) || state.kind === 'ready') return
    if (state.kind !== 'downloading') {
      set(updater.autoDownload ? { kind: 'downloading', version: info.version, percent: 0 } : { kind: 'available', version: info.version })
    }
    if (updater.autoDownload) return // the "ready" notification follows
    notify(
      `available ${info.version}`,
      `Dayflow Electron ${info.version} is available`,
      install ? 'Click to download it.' : "This copy can't install updates itself. Click to open the download page.",
      () => run(install ? 'download' : 'open-release')
    )
  })
  updater.on('download-progress', (p) => {
    if (state.kind === 'downloading') set({ ...state, percent: p.percent })
  })
  updater.on('update-downloaded', (info) => {
    set({ kind: 'ready', version: info.version })
    notify(`ready ${info.version}`, `Dayflow Electron ${info.version} is ready`, 'Restart Dayflow Electron to update, or it updates the next time you quit.', restart)
  })
  updater.on('error', () => {
    // Logged by the logger; a failed download can be tried again.
    if (state.kind === 'downloading') set({ kind: 'available', version: state.version })
  })

  const check = () => {
    if (!o.enabled() || !checkDue(lastCheck, Date.now()) || state.kind === 'ready' || state.kind === 'downloading') return
    lastCheck = Date.now()
    updater.checkForUpdates().catch(() => {})
  }
  // A tick every 10 minutes checks once 6 hours of wall-clock time passed, so sleep does not delay checks.
  setTimeout(check, FIRST_CHECK_DELAY_MS)
  setInterval(check, 10 * 60_000).unref()

  return {
    menuItem() {
      const item = updateMenuItem(state, o.mode)
      if (!item) return null
      const action = item.action
      return action ? { label: item.label, click: () => run(action) } : { label: item.label }
    },
    setAutoInstall(on) {
      autoInstall = on
      apply()
      if (on && install) download()
    }
  }
}
