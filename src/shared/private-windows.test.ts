import { describe, expect, it } from 'vitest'
import { PRIVATE_WINDOWS_RULE, blockedBy } from './blocklist'
import { isPrivateBrowserWindow } from './private-windows'

describe('private browser windows (upstream BrowserWindowClassifier, titles only)', () => {
  it('recognizes Chromium incognito and Firefox private browsing titles', () => {
    expect(isPrivateBrowserWindow({ app: 'google-chrome', title: 'New Tab - Google Chrome (Incognito)' })).toBe(true)
    expect(isPrivateBrowserWindow({ app: 'org.chromium.Chromium', title: 'Neuer Tab - Chromium (Inkognito)' })).toBe(true)
    expect(isPrivateBrowserWindow({ app: 'org.mozilla.firefox', title: 'Example — Mozilla Firefox Private Browsing' })).toBe(true)
    expect(isPrivateBrowserWindow({ app: 'firefox', title: 'Beispiel — Mozilla Firefox Privates Surfen' })).toBe(true)
  })

  it('leaves normal windows and other apps alone', () => {
    expect(isPrivateBrowserWindow({ app: 'google-chrome', title: 'Incognito mode explained - Google Search - Google Chrome' })).toBe(false)
    expect(isPrivateBrowserWindow({ app: 'firefox', title: 'Private Browsing tips — Mozilla Firefox' })).toBe(false)
    expect(isPrivateBrowserWindow({ app: 'org.kde.kate', title: 'notes (Incognito)' })).toBe(false)
    expect(isPrivateBrowserWindow({ app: 'constructor', title: 'x (Incognito)' })).toBe(false)
    expect(isPrivateBrowserWindow({ app: '__proto__', title: 'x (Incognito)' })).toBe(false)
  })

  it('applies through the built-in blocklist rule', () => {
    const window = { app: 'firefox', title: 'Bank — Mozilla Firefox Private Browsing' }
    expect(blockedBy(window, [PRIVATE_WINDOWS_RULE])).toBe(PRIVATE_WINDOWS_RULE)
    expect(blockedBy(window, [])).toBeNull()
  })
})
