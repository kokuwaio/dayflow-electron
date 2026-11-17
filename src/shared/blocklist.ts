// Apps whose screens are never recorded. A rule is either an app ID (the
// window's resource class or Flatpak ID, matched exactly, ignoring case) or
// "title:<text>", which matches window titles containing <text>.

import { isPrivateBrowserWindow } from './private-windows'

export interface ActiveWindow {
  /** Resource class or app ID, e.g. "org.keepassxc.KeePassXC". */
  app: string
  title: string
}

export const DEFAULT_BLOCKLIST: readonly string[] = [
  'org.keepassxc.KeePassXC',
  'keepassxc',
  'keepass2',
  '1password',
  'bitwarden',
  'com.bitwarden.desktop',
  'title:- KeePassXC',
  'title:- KeePass',
  'title:Passbolt',
  'title:| Bitwarden'
]

const TITLE = 'title:'

/** Built-in rule, added while "Hide private browsing windows" is on: Chrome incognito and Firefox private windows. */
export const PRIVATE_WINDOWS_RULE = 'private:browser-windows'

/** The rule that blocks this window, or null when it may be recorded. */
export function blockedBy(window: ActiveWindow, rules: readonly string[]): string | null {
  const app = window.app.trim().toLowerCase()
  const title = window.title.toLowerCase()
  for (const rule of rules) {
    const r = rule.trim()
    if (r === PRIVATE_WINDOWS_RULE) {
      if (isPrivateBrowserWindow(window)) return r
    } else if (r.toLowerCase().startsWith(TITLE)) {
      const fragment = r.slice(TITLE.length).trim().toLowerCase()
      if (fragment && title.includes(fragment)) return r
    } else if (r && app && r.toLowerCase() === app) {
      return r
    }
  }
  return null
}
