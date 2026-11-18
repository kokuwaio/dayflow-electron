// Reads the installed apps for Settings → Privacy (the mapping to blocklist
// rules is in src/shared/installed-apps.ts): .desktop files on Linux,
// Start-menu shortcuts on Windows, app bundles on macOS. No native modules:
// Electron reads shortcut targets on Windows, plutil converts binary plists.

import { execFile } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'
import {
  type InstalledApp,
  type InstalledApps,
  desktopApp,
  flatpakAppsCommand,
  linuxApplicationDirs,
  macBundleApp,
  mergeApps,
  plistStrings,
  windowsShortcutApp
} from '../../shared/installed-apps'

export interface InstalledAppsEnv {
  platform: string
  home: string
  env: NodeJS.ProcessEnv
  /** Set inside the Flatpak: its ID. */
  flatpakId: string
  /** The app language, for localized .desktop names. */
  language: string
  /** Electron's shell.readShortcutLink (Windows only). */
  readShortcutLink?: (path: string) => { target: string }
}

/** Every file below dir whose name passes `want`, at most `depth` folders deep; missing or unreadable folders count as empty. */
async function walk(dir: string, want: (name: string) => boolean, depth: number): Promise<string[]> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const out: string[] = []
  for (const e of entries) {
    const path = join(dir, e.name)
    if (want(e.name) && (e.isFile() || e.isSymbolicLink())) out.push(path)
    else if (e.isDirectory() && depth > 0) out.push(...(await walk(path, want, depth - 1)))
  }
  return out
}

const readable = async (dir: string) => {
  try {
    await readdir(dir)
    return true
  } catch {
    return false
  }
}

async function linuxApps(o: InstalledAppsEnv): Promise<InstalledApps> {
  const inFlatpak = !!o.flatpakId
  const dirs = linuxApplicationDirs({ inFlatpak, home: o.home, xdgDataHome: o.env.XDG_DATA_HOME, xdgDataDirs: o.env.XDG_DATA_DIRS })
  const apps: Array<InstalledApp | null> = []
  for (const dir of dirs) {
    for (const file of await walk(dir, (n) => n.endsWith('.desktop'), 2)) {
      const text = await readFile(file, 'utf8').catch(() => '')
      if (text) apps.push(desktopApp(relative(dir, file), text, o.language))
    }
  }
  // The sandbox hides the host's folders until shared; say how, unless both main ones are visible.
  const shared = inFlatpak && (await readable('/run/host/usr/share/applications')) && (await readable(`${o.home}/.local/share/applications`))
  return { apps: mergeApps(apps), sandboxCommand: inFlatpak && !shared ? flatpakAppsCommand(o.flatpakId) : null }
}

async function windowsApps(o: InstalledAppsEnv): Promise<InstalledApps> {
  const roots = [o.env.APPDATA, o.env.ProgramData ?? o.env.PROGRAMDATA]
    .filter((r): r is string => !!r)
    .map((r) => join(r, 'Microsoft', 'Windows', 'Start Menu', 'Programs'))
  const apps: Array<InstalledApp | null> = []
  for (const root of roots) {
    for (const file of await walk(root, (n) => /\.lnk$/i.test(n), 3)) {
      try {
        const { target } = o.readShortcutLink!(file)
        apps.push(windowsShortcutApp(file.split(/[\\/]/).pop()!, target))
      } catch {
        // Shortcuts to the Store, URLs or missing targets have nothing to read.
      }
    }
  }
  return { apps: mergeApps(apps), sandboxCommand: null }
}

/** Info.plist as text; binary plists go through plutil. */
async function readPlist(path: string): Promise<string> {
  const buffer = await readFile(path)
  if (buffer.subarray(0, 6).toString('latin1') !== 'bplist') return buffer.toString('utf8')
  return new Promise((resolve) => {
    execFile('plutil', ['-convert', 'xml1', '-o', '-', path], { timeout: 5_000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => resolve(err ? '' : stdout))
  })
}

async function macApps(o: InstalledAppsEnv): Promise<InstalledApps> {
  const roots = ['/Applications', '/Applications/Utilities', join(o.home, 'Applications'), '/System/Applications', '/System/Applications/Utilities']
  const apps: Array<InstalledApp | null> = []
  for (const root of roots) {
    let names: string[]
    try {
      names = (await readdir(root)).filter((n) => n.endsWith('.app'))
    } catch {
      continue
    }
    for (const name of names) {
      const bundle = join(root, name)
      const text = await readPlist(join(bundle, 'Contents', 'Info.plist')).catch(() => '')
      if (text) apps.push(macBundleApp(bundle, plistStrings(text)))
    }
  }
  return { apps: mergeApps(apps), sandboxCommand: null }
}

/** The installed apps of this computer, as far as the app can see them. */
export function listInstalledApps(o: InstalledAppsEnv): Promise<InstalledApps> {
  if (o.platform === 'linux') return linuxApps(o)
  if (o.platform === 'win32' && o.readShortcutLink) return windowsApps(o)
  if (o.platform === 'darwin') return macApps(o)
  return Promise.resolve({ apps: [], sandboxCommand: null })
}
