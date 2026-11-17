import { describe, expect, it } from 'vitest'
import { DEFAULT_BLOCKLIST, blockedBy } from './blocklist'

const win = (app: string, title: string) => ({ app, title })

describe('blockedBy', () => {
  it.each([
    ['KeePassXC (Flatpak)', win('org.keepassxc.KeePassXC', 'Passwords.kdbx - KeePassXC')],
    ['KeePassXC (native)', win('keepassxc', 'Passwords.kdbx [Locked] - KeePassXC')],
    ['KeePass 2', win('keepass2', 'Database.kdbx - KeePass')],
    ['1Password', win('1Password', '1Password')],
    ['Bitwarden', win('bitwarden', 'My vault | Bitwarden')],
    ['the Passbolt web app in a browser', win('firefox', 'Passwords | Passbolt — Mozilla Firefox')]
  ])('blocks %s by default', (_name, window) => {
    expect(blockedBy(window, DEFAULT_BLOCKLIST)).not.toBeNull()
  })

  it.each([
    ['an editor', win('code', 'pipeline.ts - dayflow-electron - Visual Studio Code')],
    ['a browser page that merely mentions KeePass in passing', win('firefox', 'Why I switched from KeePass to nothing — Mozilla Firefox')],
    ['an unknown window', win('', '')]
  ])('lets %s through', (_name, window) => {
    expect(blockedBy(window, DEFAULT_BLOCKLIST)).toBeNull()
  })

  it('applies user rules for app IDs and title fragments and names the rule that matched', () => {
    const rules = ['org.gnome.Banking', 'title:online banking']
    expect(blockedBy(win('org.gnome.banking', 'Accounts'), rules)).toBe('org.gnome.Banking')
    expect(blockedBy(win('firefox', 'My Online Banking — Mozilla Firefox'), rules)).toBe('title:online banking')
    expect(blockedBy(win('firefox', 'News'), rules)).toBeNull()
  })

  it('ignores empty and blank rules', () => {
    expect(blockedBy(win('', ''), ['', '  ', 'title:'])).toBeNull()
  })
})
