// Auto-update for the Windows (NSIS) and macOS builds with electron-updater
// from GitHub Releases, in place of upstream's Sparkle. The policy (which
// builds, which versions, when) lives in src/shared/updates.ts.
// - "install": checks at start and every 6 hours, downloads in the
//   background while "Install updates automatically" is on (otherwise on a
//   click), installs on the next quit, and offers "Restart to update" in the
//   tray and a notification.
// - "Check for updates…" in the tray (and the macOS app menu) checks right
//   away, regardless of the 6-hour timer, and answers with a notification.
// - "notify" (macOS without a Developer ID signature, which Squirrel.Mac
//   needs to install): only tells that a version is out and opens its page.

import { Notification, shell } from 'electron'
import { t } from '../shared/i18n'
import {
  FIRST_CHECK_DELAY_MS,
  type ManualCheck,
  type UpdateAction,
  type UpdateState,
  acceptUpdate,
  checkDue,
  manualCheckLabel,
  manualCheckNotice,
  manualCheckResult,
  releaseUrl,
  updateMenuItem
} from '../shared/updates'

export interface Updater {
  /** The tray entry, if an update is under way. */
  menuItem(): { label: string; click?: () => void } | null
  /** Follows the "Install updates automatically" setting. */
  setAutoInstall(on: boolean): void
  /** "Check for updates…" for the tray and the app menu; null while the "Check for updates" setting is off. */
  checkItem(): { label: string; enabled: boolean; click: () => void } | null
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

  /** A manual check runs: it reports what it found itself. */
  let manual = false
  updater.on('update-available', (info) => {
    if (!acceptUpdate(info.version, o.currentVersion) || state.kind === 'ready') return
    if (manual) notified.add(`available ${info.version}`)
    if (state.kind !== 'downloading') {
      set(updater.autoDownload ? { kind: 'downloading', version: info.version, percent: 0 } : { kind: 'available', version: info.version })
    }
    if (updater.autoDownload) return // the "ready" notification follows
    notify(
      `available ${info.version}`,
      t('updates.available.title', { version: info.version }),
      install ? t('updates.available.bodyDownload') : t('updates.available.bodyOpen'),
      () => run(install ? 'download' : 'open-release')
    )
  })
  updater.on('download-progress', (p) => {
    if (state.kind === 'downloading') set({ ...state, percent: p.percent })
  })
  updater.on('update-downloaded', (info) => {
    set({ kind: 'ready', version: info.version })
    notify(`ready ${info.version}`, t('updates.ready.title', { version: info.version }), t('updates.ready.body'), restart)
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
  // By hand: right away, even within the 6 hours, and always with an answer.
  const checkNow = async () => {
    if (manual || !o.enabled()) return
    // Already found: say so again instead of asking GitHub.
    if (state.kind === 'ready') return show(t('updates.ready.title', { version: state.version }), t('updates.ready.body'), 'restart')
    if (state.kind !== 'idle') {
      const notice = manualCheckNotice({ kind: 'found', version: state.version }, { mode: o.mode, autoDownload: state.kind === 'downloading' })
      return show(notice.title, notice.body, notice.action)
    }
    manual = true
    o.changed()
    let check: ManualCheck
    try {
      lastCheck = Date.now()
      const result = await updater.checkForUpdates()
      check = manualCheckResult(result?.updateInfo ?? null, o.currentVersion)
    } catch (err) {
      check = { kind: 'failed', message: err instanceof Error ? err.message : String(err) }
    } finally {
      manual = false
      o.changed()
    }
    const notice = manualCheckNotice(check, { mode: o.mode, autoDownload: updater.autoDownload })
    show(notice.title, notice.body, notice.action)
  }
  const show = (title: string, body: string, action: UpdateAction | null) => {
    if (!Notification.isSupported()) return
    const n = new Notification({ title, body })
    if (action) n.on('click', () => run(action))
    n.show()
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
    checkItem() {
      if (!o.enabled()) return null
      return { label: manualCheckLabel(manual), enabled: !manual, click: () => void checkNow() }
    },
    setAutoInstall(on) {
      autoInstall = on
      apply()
      if (on && install) download()
    }
  }
}
