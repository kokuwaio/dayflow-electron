// Auto-update policy for the Windows (NSIS) and macOS (dmg) builds, which
// replace upstream's Sparkle with electron-updater and GitHub Releases. The
// Flatpak updates through Flatpak; development builds never update.

import { t } from './i18n'

/** Where electron-builder's publish config points (electron-builder.yml). */
export const RELEASES_REPO = 'kokuwaio/dayflow-electron'
/** How often the app looks for a new release. */
export const UPDATE_CHECK_INTERVAL_MS = 6 * 3600_000
/** The first check waits until startup is done. */
export const FIRST_CHECK_DELAY_MS = 10_000

/** How the running build's macOS signature reads: Squirrel.Mac installs only into a Developer ID signed app. */
export type MacSignature = 'developer-id' | 'adhoc' | 'unsigned'

/** "install": download and install; "notify": only say a version is out (unsigned macOS); "off": no updater. */
export type UpdateMode = { mode: 'install' | 'notify' } | { mode: 'off'; reason: string }

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

/** Builds from branches are 0.0.0-<branch>.<sha> (scripts/version.sh); they never update. */
export const isDevVersion = (version: string): boolean => !SEMVER.test(version) || version.startsWith('0.0.0-')

export function updateMode(o: {
  /** process.platform */
  platform: string
  version: string
  packaged: boolean
  inFlatpak: boolean
  macSignature?: MacSignature
}): UpdateMode {
  if (o.inFlatpak) return { mode: 'off', reason: 'The Flatpak updates itself through Flatpak.' }
  if (!o.packaged) return { mode: 'off', reason: 'Not a packaged app.' }
  if (o.platform !== 'win32' && o.platform !== 'darwin') return { mode: 'off', reason: 'Updates come from the package manager.' }
  if (isDevVersion(o.version)) return { mode: 'off', reason: 'This is a development build.' }
  if (o.platform === 'darwin' && o.macSignature !== 'developer-id') return { mode: 'notify' }
  return { mode: 'install' }
}

const parts = (v: string) => {
  const m = SEMVER.exec(v)
  return m ? { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] } : null
}

/** Only stable releases newer than the running version; the feed is checked again here, not only by electron-updater. */
export function acceptUpdate(candidate: string, current: string): boolean {
  const c = parts(candidate)
  const r = parts(current)
  if (!c || !r || c.pre) return false
  for (let i = 0; i < 3; i++) {
    const a = c.nums[i] ?? 0
    const b = r.nums[i] ?? 0
    if (a !== b) return a > b
  }
  // Same numbers: a release is newer than its own prerelease.
  return !!r.pre
}

/** Whether to check now: at start, then once UPDATE_CHECK_INTERVAL_MS of wall-clock time passed (a sleeping computer catches up). */
export function checkDue(lastCheck: number | null, now: number): boolean {
  return lastCheck === null || now - lastCheck >= UPDATE_CHECK_INTERVAL_MS || now < lastCheck
}

/** Reads `codesign -dv --verbose=2 <app>` (it writes to stderr). */
export function parseCodesign(output: string): MacSignature {
  if (/^Authority=Developer ID Application:/m.test(output)) return 'developer-id'
  if (/^Signature=adhoc$/m.test(output)) return 'adhoc'
  return 'unsigned'
}

export type UpdateState =
  | { kind: 'idle' }
  | { kind: 'available'; version: string }
  | { kind: 'downloading'; version: string; percent: number }
  | { kind: 'ready'; version: string }

export type UpdateAction = 'download' | 'restart' | 'open-release'

/** The tray menu entry for an update, if any. */
export function updateMenuItem(state: UpdateState, mode: 'install' | 'notify'): { label: string; action: UpdateAction | null } | null {
  switch (state.kind) {
    case 'idle':
      return null
    case 'available':
      return mode === 'notify'
        ? { label: t('updates.menuGet', { version: state.version }), action: 'open-release' }
        : { label: t('updates.menuDownload', { version: state.version }), action: 'download' }
    case 'downloading':
      return { label: t('updates.menuDownloading', { version: state.version, percent: Math.round(state.percent) }), action: null }
    case 'ready':
      return { label: t('updates.menuRestart', { version: state.version }), action: 'restart' }
  }
}

export const releaseUrl = (version: string) => `https://github.com/${RELEASES_REPO}/releases/tag/v${version.replace(/^v/, '')}`
