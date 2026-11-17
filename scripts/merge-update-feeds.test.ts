import { describe, expect, it } from 'vitest'
import { mergeFeeds } from './merge-update-feeds'

const feed = (arch: string, version = '1.2.3') =>
  [
    `version: ${version}`,
    'files:',
    `  - url: dayflow-electron-v${version}-win-${arch}.exe`,
    `    sha512: ${arch.toUpperCase()}+/==`,
    '    size: 123',
    `path: dayflow-electron-v${version}-win-${arch}.exe`,
    `sha512: ${arch.toUpperCase()}+/==`,
    "releaseDate: '2026-11-17T10:00:00.000Z'",
    ''
  ].join('\n')

describe('merging latest.yml of the per-architecture Windows builds', () => {
  it('lists the installers of all builds, so electron-updater picks the one for its architecture', () => {
    expect(mergeFeeds([feed('x64'), feed('arm64')])).toBe(
      [
        'version: 1.2.3',
        'files:',
        '  - url: dayflow-electron-v1.2.3-win-x64.exe',
        '    sha512: X64+/==',
        '    size: 123',
        '  - url: dayflow-electron-v1.2.3-win-arm64.exe',
        '    sha512: ARM64+/==',
        '    size: 123',
        'path: dayflow-electron-v1.2.3-win-x64.exe',
        'sha512: X64+/==',
        "releaseDate: '2026-11-17T10:00:00.000Z'",
        ''
      ].join('\n')
    )
  })

  it('keeps a single feed as it is', () => {
    expect(mergeFeeds([feed('x64')])).toBe(feed('x64'))
  })

  it('refuses feeds of different versions or without files', () => {
    expect(() => mergeFeeds([feed('x64'), feed('arm64', '1.2.4')])).toThrow(/versions differ/)
    expect(() => mergeFeeds(['version: 1.2.3\n'])).toThrow(/no files/)
    expect(() => mergeFeeds([])).toThrow()
  })
})
