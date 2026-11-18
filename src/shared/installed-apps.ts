// The installed apps offered under Settings → Privacy → Blocked apps (upstream
// SettingsRecordingPrivacyTabView.swift and RecordingPrivacyPreferences
// .installedApplications, which list /Applications by bundle ID). Each app maps
// to the blocklist rules that match its windows (src/shared/blocklist.ts):
// - Linux (KDE): the window's resource class, which is the .desktop file ID for
//   Wayland and Flatpak apps and StartupWMClass for X11 apps.
// - Windows: the process name without ".exe", from a Start-menu shortcut's target.
// - macOS: the bundle ID from the app's Info.plist.

export interface InstalledApp {
  /** Unique per list: the desktop file ID, the shortcut's target or the bundle path. */
  id: string
  name: string
  /** Blocklist rules that match the app's windows; never empty. */
  rules: string[]
}

const lower = (s: string) => s.trim().toLowerCase()
const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path

/** Rules without blanks and case-insensitive repeats, in order. */
function uniqueRules(rules: Array<string | undefined>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const r of rules) {
    const v = r?.trim()
    if (!v || seen.has(lower(v))) continue
    seen.add(lower(v))
    out.push(v)
  }
  return out
}

// ---------------------------------------------------------------- Linux

/** The keys of a .desktop file's [Desktop Entry] group (other groups are actions). */
export function parseDesktopEntry(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  let inEntry = false
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    if (line.startsWith('[')) {
      inEntry = line === '[Desktop Entry]'
      continue
    }
    if (!inEntry) continue
    const eq = line.indexOf('=')
    if (eq > 0) out[line.slice(0, eq).trim()] ??= line.slice(eq + 1).trim()
  }
  return out
}

/** A desktop file ID from its path below an applications folder: "kde/org.kde.foo.desktop" → "kde-org.kde.foo" (XDG desktop entry spec). */
export const desktopFileId = (relativePath: string): string => relativePath.replace(/\.desktop$/, '').replace(/[\\/]/g, '-')

/** The name in the app language (Name[de], Name[zh_CN] for zh-Hans, ...), else Name. */
function localizedName(entry: Record<string, string>, language: string): string | undefined {
  const tags: Record<string, string[]> = { 'zh-Hans': ['zh_CN', 'zh'], 'zh-Hant': ['zh_TW', 'zh_HK', 'zh'] }
  for (const tag of tags[language] ?? [language]) {
    const name = entry[`Name[${tag}]`]
    if (name) return name
  }
  return entry.Name
}

/** Programs that start other programs; their name says nothing about the window. */
const LAUNCHERS = new Set([
  'env', 'flatpak', 'snap', 'sh', 'bash', 'dash', 'zsh', 'gtk-launch', 'gio', 'xdg-open', 'kioclient', 'kioclient5', 'kde-open',
  'dbus-launch', 'systemd-run', 'sudo', 'pkexec', 'wine', 'python', 'python3', 'java', 'electron', 'steam'
])

/** The program an Exec line starts ("/snap/bin/code %F" → "code"), past `env VAR=…`; null for launchers. */
export function execProgram(exec: string | undefined): string | null {
  const tokens = (exec ?? '').match(/"[^"]*"|\S+/g)?.map((t) => t.replace(/^"|"$/g, '')) ?? []
  let i = 0
  if (tokens[0] && baseName(tokens[0]) === 'env') {
    i = 1
    while (tokens[i]?.includes('=')) i++
  }
  const program = tokens[i] ? baseName(tokens[i]!) : ''
  return program && !program.includes('%') && !LAUNCHERS.has(program) ? program : null
}

/**
 * An app from a .desktop file; null for entries not shown in menus (NoDisplay,
 * Hidden, links, missing names). Its rules: the desktop file ID (Wayland and
 * Flatpak apps), StartupWMClass and the program name (X11 apps usually name
 * their window class after it).
 */
export function desktopApp(relativePath: string, text: string, language = 'en'): InstalledApp | null {
  const entry = parseDesktopEntry(text)
  if (entry.Type !== 'Application' || entry.NoDisplay === 'true' || entry.Hidden === 'true') return null
  const name = localizedName(entry, language)?.trim()
  if (!name) return null
  const id = desktopFileId(relativePath)
  return { id, name, rules: uniqueRules([id, entry.StartupWMClass, execProgram(entry.Exec) ?? undefined]) }
}

/**
 * Where .desktop files live, user's first so they win (XDG base directories).
 * Inside the Flatpak the host's own folders are visible only with
 * flatpak override (see flatpakAppsCommand): the system's under /run/host
 * (host-os) and the user's in their home (xdg-data/applications).
 */
export function linuxApplicationDirs(o: { inFlatpak: boolean; home: string; xdgDataHome?: string; xdgDataDirs?: string }): string[] {
  if (o.inFlatpak) {
    return [
      `${o.home}/.local/share/applications`,
      `${o.home}/.local/share/flatpak/exports/share/applications`,
      '/run/host/usr/local/share/applications',
      '/run/host/usr/share/applications'
    ]
  }
  const dataHome = o.xdgDataHome?.trim() || `${o.home}/.local/share`
  const dataDirs = (o.xdgDataDirs?.trim() || '/usr/local/share:/usr/share').split(':').filter(Boolean)
  return [...new Set([dataHome, ...dataDirs].map((d) => `${d.replace(/\/+$/, '')}/applications`))]
}

/** Lets the Flatpak read the host's app list (read-only). Apps installed as system-wide Flatpaks stay hidden: /var is off limits. */
export const flatpakAppsCommand = (appId: string): string =>
  `flatpak override --user --filesystem=host-os:ro --filesystem=xdg-data/applications:ro ${appId}`

// ---------------------------------------------------------------- Windows

/** An app from a Start-menu shortcut and its target; null for uninstallers, documents and links. */
export function windowsShortcutApp(shortcutName: string, target: string): InstalledApp | null {
  const name = shortcutName.replace(/\.lnk$/i, '').trim()
  const file = baseName(target.trim())
  if (!name || !/\.exe$/i.test(file)) return null
  if (/uninstall|deinstall/i.test(name) || /^unins\d*\.exe$/i.test(file)) return null
  return { id: lower(target), name, rules: [file.replace(/\.exe$/i, '')] }
}

// ---------------------------------------------------------------- macOS

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const unescapeXml = (s: string) => s.replace(/&(amp|lt|gt|quot|apos);/g, (_m, e: string) => XML_ENTITIES[e]!)

/** The string values at the top level of an XML property list (Info.plist). */
export function plistStrings(xml: string): Record<string, string> {
  const out: Record<string, string> = {}
  // Only the outer dict: nested dicts (CFBundleURLTypes, ...) come after a <key> without a <string> next to it.
  for (const m of xml.matchAll(/<key>([^<]*)<\/key>\s*<string>([^<]*)<\/string>/g)) {
    const key = unescapeXml(m[1]!.trim())
    out[key] ??= unescapeXml(m[2]!.trim())
  }
  return out
}

/** An app from its bundle folder name ("1Password.app") and Info.plist; null without a bundle ID. */
export function macBundleApp(bundlePath: string, info: Record<string, string>): InstalledApp | null {
  const bundleId = info.CFBundleIdentifier?.trim()
  if (!bundleId) return null
  const name = (info.CFBundleDisplayName || info.CFBundleName || baseName(bundlePath).replace(/\.app$/i, '')).trim()
  return { id: bundlePath, name, rules: [bundleId] }
}

// ---------------------------------------------------------------- the list

/** One entry per app (the first wins, so user folders shadow system ones), sorted by name. */
export function mergeApps(apps: ReadonlyArray<InstalledApp | null>): InstalledApp[] {
  const byId = new Map<string, InstalledApp>()
  const byRules = new Set<string>()
  for (const app of apps) {
    if (!app || byId.has(app.id)) continue
    // Two shortcuts or bundles for the same program are one app to block.
    const rulesKey = app.rules.map(lower).join('\n')
    if (byRules.has(rulesKey)) continue
    byId.set(app.id, app)
    byRules.add(rulesKey)
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id))
}

/** Apps whose name or rule contains the query, ignoring case. */
export function searchApps(apps: readonly InstalledApp[], query: string): InstalledApp[] {
  const q = lower(query)
  if (!q) return [...apps]
  return apps.filter((a) => lower(a.name).includes(q) || a.rules.some((r) => lower(r).includes(q)))
}

/** The app is blocked when one of its rules is on the list. */
export const isAppBlocked = (app: InstalledApp, blocked: readonly string[]): boolean => {
  const list = new Set(blocked.map(lower))
  return app.rules.some((r) => list.has(lower(r)))
}

/** Adds the app's rules to the list, or removes them all when it is blocked already. */
export function toggleAppRules(blocked: readonly string[], app: InstalledApp): string[] {
  const mine = new Set(app.rules.map(lower))
  if (isAppBlocked(app, blocked)) return blocked.filter((r) => !mine.has(lower(r)))
  const present = new Set(blocked.map(lower))
  return [...blocked, ...app.rules.filter((r) => !present.has(lower(r)))]
}

/** The installed apps and, inside the Flatpak, how to let it see the host's apps. */
export interface InstalledApps {
  apps: InstalledApp[]
  /** Set when some app folders could not be read from the sandbox: the command that shares them. */
  sandboxCommand: string | null
}
