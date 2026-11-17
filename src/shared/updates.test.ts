import { describe, expect, it } from 'vitest'
import { acceptUpdate, checkDue, isDevVersion, parseCodesign, releaseUrl, updateMenuItem, updateMode } from './updates'

const release = { platform: 'win32' as const, version: '1.2.3', packaged: true, inFlatpak: false }

describe('which builds update themselves', () => {
  it('installs updates on Windows and on a Developer ID signed Mac', () => {
    expect(updateMode(release)).toEqual({ mode: 'install' })
    expect(updateMode({ ...release, platform: 'darwin', macSignature: 'developer-id' })).toEqual({ mode: 'install' })
  })

  it('only tells about updates on an ad-hoc signed or unsigned Mac (Squirrel.Mac installs only signed apps)', () => {
    expect(updateMode({ ...release, platform: 'darwin', macSignature: 'adhoc' })).toEqual({ mode: 'notify' })
    expect(updateMode({ ...release, platform: 'darwin', macSignature: 'unsigned' })).toEqual({ mode: 'notify' })
    expect(updateMode({ ...release, platform: 'darwin' })).toEqual({ mode: 'notify' })
  })

  it('leaves the Flatpak, Linux, development runs and development builds alone', () => {
    expect(updateMode({ ...release, platform: 'linux', inFlatpak: true })).toMatchObject({ mode: 'off', reason: expect.stringContaining('Flatpak') })
    expect(updateMode({ ...release, platform: 'linux' })).toMatchObject({ mode: 'off' })
    expect(updateMode({ ...release, packaged: false })).toMatchObject({ mode: 'off' })
    expect(updateMode({ ...release, version: '0.0.0-feat-x.abc1234' })).toMatchObject({ mode: 'off', reason: expect.stringContaining('development build') })
  })

  it('tells development builds from releases', () => {
    expect(isDevVersion('0.0.0-main.1234567')).toBe(true)
    expect(isDevVersion('0.1.0')).toBe(false)
    expect(isDevVersion('not a version')).toBe(true)
  })
})

describe('which versions to take', () => {
  it('takes only newer stable releases', () => {
    expect(acceptUpdate('1.2.4', '1.2.3')).toBe(true)
    expect(acceptUpdate('1.10.0', '1.9.9')).toBe(true)
    expect(acceptUpdate('2.0.0', '1.99.99')).toBe(true)
    expect(acceptUpdate('1.2.3', '1.2.3')).toBe(false)
    expect(acceptUpdate('1.2.2', '1.2.3')).toBe(false)
    expect(acceptUpdate('1.3.0-beta.1', '1.2.3')).toBe(false)
    expect(acceptUpdate('v1.3.0', '1.2.3')).toBe(true)
    expect(acceptUpdate('garbage', '1.2.3')).toBe(false)
  })
})

describe('when to check', () => {
  const HOUR = 3600_000
  it('checks at start, then once 6 hours of wall-clock time passed', () => {
    expect(checkDue(null, 1_000_000)).toBe(true)
    expect(checkDue(1_000_000, 1_000_000 + 5 * HOUR)).toBe(false)
    expect(checkDue(1_000_000, 1_000_000 + 6 * HOUR)).toBe(true)
    // Wall-clock time, so a computer that slept through the 6 hours checks at the next tick.
    expect(checkDue(0, 30 * HOUR)).toBe(true)
    // A clock set back does not stop checks for good.
    expect(checkDue(10 * HOUR, 0)).toBe(true)
  })
})

describe('the macOS signature', () => {
  it('reads codesign -dv output', () => {
    expect(parseCodesign('Executable=/Applications/x.app/Contents/MacOS/x\nAuthority=Developer ID Application: Someone (ABCDE12345)\nTeamIdentifier=ABCDE12345')).toBe('developer-id')
    expect(parseCodesign('Executable=/Applications/x.app/Contents/MacOS/x\nSignature=adhoc\nTeamIdentifier=not set')).toBe('adhoc')
    expect(parseCodesign('/Applications/x.app: code object is not signed at all')).toBe('unsigned')
  })
})

describe('the tray entry', () => {
  it('offers what fits the state and the mode', () => {
    expect(updateMenuItem({ kind: 'idle' }, 'install')).toBeNull()
    expect(updateMenuItem({ kind: 'available', version: '1.3.0' }, 'install')).toEqual({ label: 'Download version 1.3.0', action: 'download' })
    expect(updateMenuItem({ kind: 'available', version: '1.3.0' }, 'notify')).toEqual({ label: 'Get version 1.3.0…', action: 'open-release' })
    expect(updateMenuItem({ kind: 'downloading', version: '1.3.0', percent: 41.6 }, 'install')).toEqual({ label: 'Downloading version 1.3.0 (42%)', action: null })
    expect(updateMenuItem({ kind: 'ready', version: '1.3.0' }, 'install')).toEqual({ label: 'Restart to update to 1.3.0', action: 'restart' })
  })

  it('links the release page of a version', () => {
    expect(releaseUrl('1.3.0')).toBe('https://github.com/kokuwaio/dayflow-electron/releases/tag/v1.3.0')
  })
})
