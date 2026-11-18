import { describe, expect, it } from 'vitest'
import { blockedBy } from './blocklist'
import {
  desktopApp,
  desktopFileId,
  flatpakAppsCommand,
  isAppBlocked,
  linuxApplicationDirs,
  macBundleApp,
  mergeApps,
  parseDesktopEntry,
  plistStrings,
  searchApps,
  toggleAppRules,
  windowsShortcutApp
} from './installed-apps'

const KEEPASSXC = `[Desktop Entry]
Name=KeePassXC
Name[de]=KeePassXC Passwortverwaltung
GenericName=Password Manager
Exec=keepassxc %f
Icon=keepassxc
StartupWMClass=keepassxc
Type=Application

[Desktop Action Lock]
Name=Lock all databases
Exec=keepassxc --lock
`

describe('Linux .desktop files', () => {
  it('reads only the [Desktop Entry] group', () => {
    const entry = parseDesktopEntry(KEEPASSXC)
    expect(entry.Name).toBe('KeePassXC')
    expect(entry.Exec).toBe('keepassxc %f')
  })

  it('maps an app to its desktop file ID and StartupWMClass, the classes KWin reports on Wayland and X11', () => {
    const app = desktopApp('org.keepassxc.KeePassXC.desktop', KEEPASSXC)!
    expect(app).toEqual({ id: 'org.keepassxc.KeePassXC', name: 'KeePassXC', rules: ['org.keepassxc.KeePassXC', 'keepassxc'] })
    expect(blockedBy({ app: 'keepassxc', title: 'Passwords.kdbx' }, app.rules)).toBe('keepassxc')
    expect(blockedBy({ app: 'org.keepassxc.KeePassXC', title: '' }, app.rules)).toBe('org.keepassxc.KeePassXC')
  })

  it('maps a Flatpak app to its Flatpak ID once', () => {
    const app = desktopApp('com.bitwarden.desktop.desktop', '[Desktop Entry]\nType=Application\nName=Bitwarden\nStartupWMClass=com.bitwarden.desktop\n')!
    expect(app.rules).toEqual(['com.bitwarden.desktop'])
  })

  it('adds the program name for X11 apps without StartupWMClass, but not launchers', () => {
    const entry = (exec: string) => `[Desktop Entry]\nType=Application\nName=App\nExec=${exec}\n`
    expect(desktopApp('code_code.desktop', entry('/snap/bin/code --force-user-env %F'))!.rules).toEqual(['code_code', 'code'])
    expect(desktopApp('a.desktop', entry('env GDK_BACKEND=x11 "/opt/My App/myapp" %U'))!.rules).toEqual(['a', 'myapp'])
    expect(desktopApp('org.gimp.GIMP.desktop', entry('/usr/bin/flatpak run --branch=stable org.gimp.GIMP @@u %U @@'))!.rules).toEqual(['org.gimp.GIMP'])
    expect(desktopApp('b.desktop', entry('sh -c "b --x"'))!.rules).toEqual(['b'])
  })

  it('uses the name in the app language', () => {
    expect(desktopApp('k.desktop', KEEPASSXC, 'de')!.name).toBe('KeePassXC Passwortverwaltung')
    expect(desktopApp('k.desktop', '[Desktop Entry]\nType=Application\nName=Files\nName[zh_CN]=文件\n', 'zh-Hans')!.name).toBe('文件')
  })

  it('skips entries that menus hide', () => {
    expect(desktopApp('a.desktop', '[Desktop Entry]\nType=Application\nName=A\nNoDisplay=true\n')).toBeNull()
    expect(desktopApp('a.desktop', '[Desktop Entry]\nType=Application\nName=A\nHidden=true\n')).toBeNull()
    expect(desktopApp('a.desktop', '[Desktop Entry]\nType=Link\nName=A\nURL=https://x\n')).toBeNull()
    expect(desktopApp('a.desktop', '[Desktop Entry]\nType=Application\n')).toBeNull()
  })

  it('turns subfolders into the desktop file ID', () => {
    expect(desktopFileId('kde/org.kde.dolphin.desktop')).toBe('kde-org.kde.dolphin')
  })

  it('looks in the XDG data folders outside the Flatpak, the user first', () => {
    expect(linuxApplicationDirs({ inFlatpak: false, home: '/home/a' })).toEqual([
      '/home/a/.local/share/applications',
      '/usr/local/share/applications',
      '/usr/share/applications'
    ])
    expect(linuxApplicationDirs({ inFlatpak: false, home: '/home/a', xdgDataHome: '/data', xdgDataDirs: '/usr/share/:/var/lib/flatpak/exports/share' })).toEqual([
      '/data/applications',
      '/usr/share/applications',
      '/var/lib/flatpak/exports/share/applications'
    ])
  })

  it('looks at the host folders inside the Flatpak, which an override shares read-only', () => {
    expect(linuxApplicationDirs({ inFlatpak: true, home: '/home/a', xdgDataHome: '/home/a/.var/app/x/data' })).toEqual([
      '/home/a/.local/share/applications',
      '/home/a/.local/share/flatpak/exports/share/applications',
      '/run/host/usr/local/share/applications',
      '/run/host/usr/share/applications'
    ])
    expect(flatpakAppsCommand('io.github.kokuwaio.DayflowElectron')).toBe(
      'flatpak override --user --filesystem=host-os:ro --filesystem=xdg-data/applications:ro io.github.kokuwaio.DayflowElectron'
    )
  })
})

describe('Windows Start-menu shortcuts', () => {
  it('maps a shortcut to the process name of its target, as window detection reports it', () => {
    const app = windowsShortcutApp('KeePassXC.lnk', 'C:\\Program Files\\KeePassXC\\KeePassXC.exe')!
    expect(app).toEqual({ id: 'c:\\program files\\keepassxc\\keepassxc.exe', name: 'KeePassXC', rules: ['KeePassXC'] })
    expect(blockedBy({ app: 'keepassxc', title: '' }, app.rules)).toBe('KeePassXC')
  })

  it('skips uninstallers, documents and web links', () => {
    expect(windowsShortcutApp('Uninstall KeePassXC.lnk', 'C:\\Program Files\\KeePassXC\\uninstall.exe')).toBeNull()
    expect(windowsShortcutApp('KeePassXC.lnk', 'C:\\Program Files\\KeePassXC\\unins000.exe')).toBeNull()
    expect(windowsShortcutApp('Read me.lnk', 'C:\\Program Files\\App\\README.txt')).toBeNull()
    expect(windowsShortcutApp('Website.lnk', '')).toBeNull()
  })
})

describe('macOS bundles', () => {
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key>
  <string>com.1password.1password</string>
  <key>CFBundleName</key>
  <string>1Password</string>
  <key>CFBundleURLTypes</key>
  <array><dict><key>CFBundleURLName</key><string>One &amp; Two</string></dict></array>
</dict></plist>`

  it('reads the string values of Info.plist', () => {
    expect(plistStrings(plist)).toMatchObject({ CFBundleIdentifier: 'com.1password.1password', CFBundleName: '1Password', CFBundleURLName: 'One & Two' })
  })

  it('maps a bundle to its bundle ID, as window detection reports it', () => {
    const app = macBundleApp('/Applications/1Password.app', plistStrings(plist))!
    expect(app).toEqual({ id: '/Applications/1Password.app', name: '1Password', rules: ['com.1password.1password'] })
    expect(blockedBy({ app: 'com.1password.1password', title: '' }, app.rules)).toBe('com.1password.1password')
  })

  it('prefers the display name and falls back to the folder name', () => {
    expect(macBundleApp('/Applications/X.app', { CFBundleIdentifier: 'x', CFBundleDisplayName: 'Ex', CFBundleName: 'X' })!.name).toBe('Ex')
    expect(macBundleApp('/Applications/Some Tool.app', { CFBundleIdentifier: 'y' })!.name).toBe('Some Tool')
    expect(macBundleApp('/Applications/Z.app', {})).toBeNull()
  })
})

describe('the app list', () => {
  const a = { id: 'a', name: 'bitwarden', rules: ['com.bitwarden.desktop'] }
  const b = { id: 'b', name: 'KeePassXC', rules: ['org.keepassxc.KeePassXC', 'keepassxc'] }
  const c = { id: 'c', name: 'Firefox', rules: ['firefox'] }

  it('keeps the first of each app and sorts by name, ignoring case', () => {
    expect(mergeApps([b, null, a, c, { ...a, name: 'Other' }, { id: 'd', name: 'Firefox (copy)', rules: ['Firefox'] }]).map((x) => x.name)).toEqual([
      'bitwarden',
      'Firefox',
      'KeePassXC'
    ])
  })

  it('finds apps by name or rule', () => {
    expect(searchApps([a, b, c], 'KEEP').map((x) => x.id)).toEqual(['b'])
    expect(searchApps([a, b, c], 'com.bit').map((x) => x.id)).toEqual(['a'])
    expect(searchApps([a, b, c], '  ').length).toBe(3)
  })

  it('counts an app as blocked when any of its rules is listed, ignoring case', () => {
    expect(isAppBlocked(b, ['KEEPASSXC'])).toBe(true)
    expect(isAppBlocked(c, ['title:Firefox'])).toBe(false)
  })

  it('adds the missing rules of an app and removes all of them again', () => {
    const list = ['title:Passbolt', 'keepassxc']
    expect(toggleAppRules(['title:Passbolt'], b)).toEqual(['title:Passbolt', 'org.keepassxc.KeePassXC', 'keepassxc'])
    expect(toggleAppRules(list, b)).toEqual(['title:Passbolt'])
    expect(toggleAppRules(list, c)).toEqual(['title:Passbolt', 'keepassxc', 'firefox'])
  })
})
