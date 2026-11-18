import { describe, expect, it } from 'vitest'
import {
  claudeDesktopConfigPath,
  cursorInstallUrl,
  deepLinkMarkers,
  entryMatches,
  mergeServerEntry,
  readServerEntry,
  removeServerEntry,
  vscodeInstallUrl
} from './client-config'
import { cliInvocation } from './invocation'

const flatpak = cliInvocation({ flatpakId: 'io.github.kokuwaio.DayflowElectron', execPath: '', script: '' })
const plain = cliInvocation({ execPath: 'C:\\Program Files\\dayflow-electron\\dayflow-electron.exe', script: 'C:\\Program Files\\dayflow-electron\\resources\\app.asar\\out\\main\\cli.js' })
const PLAIN_ENTRY = {
  type: 'stdio',
  command: plain.command,
  args: [plain.args[0], 'mcp'],
  env: { ELECTRON_RUN_AS_NODE: '1' }
}

describe('JSON client configs (Claude Desktop, ~/.claude.json)', () => {
  it('adds the dayflow-electron entry and keeps everything else', () => {
    const before = JSON.stringify({ theme: 'dark', mcpServers: { other: { command: 'npx', args: ['other'] } } })
    const merged = mergeServerEntry(before, plain)
    expect(merged.ok).toBe(true)
    if (!merged.ok) return
    expect(JSON.parse(merged.text)).toEqual({
      theme: 'dark',
      mcpServers: { other: { command: 'npx', args: ['other'] }, 'dayflow-electron': PLAIN_ENTRY }
    })
    expect(merged.text.endsWith('\n')).toBe(true)
  })

  it('starts a new config when there is none or it is empty', () => {
    for (const text of [null, '', '  \n']) {
      const merged = mergeServerEntry(text, flatpak)
      expect(merged.ok && JSON.parse(merged.text)).toEqual({
        mcpServers: { 'dayflow-electron': { type: 'stdio', command: 'flatpak', args: ['run', '--command=dayflow-electron-cli', 'io.github.kokuwaio.DayflowElectron', 'mcp'] } }
      })
    }
  })

  it('replaces an old dayflow-electron entry instead of adding a second one', () => {
    const merged = mergeServerEntry(JSON.stringify({ mcpServers: { 'dayflow-electron': { command: 'env', args: ['ELECTRON_RUN_AS_NODE=1', '/old/electron', '/old/cli.js', 'mcp'] } } }), plain)
    expect(merged.ok && JSON.parse(merged.text)).toEqual({ mcpServers: { 'dayflow-electron': PLAIN_ENTRY } })
  })

  it('never touches a config it cannot parse', () => {
    expect(mergeServerEntry('{ "mcpServers": { ', plain)).toEqual({ ok: false, error: expect.stringContaining("isn't valid JSON") })
    expect(mergeServerEntry('[1, 2]', plain)).toEqual({ ok: false, error: expect.stringContaining('JSON object') })
    expect(mergeServerEntry('{"mcpServers": []}', plain)).toEqual({ ok: false, error: expect.stringContaining('mcpServers') })
    expect(removeServerEntry('nope')).toMatchObject({ ok: false })
    expect(readServerEntry('nope')).toMatchObject({ ok: false })
  })

  it('removes only the dayflow-electron entry', () => {
    const before = JSON.stringify({ mcpServers: { other: { command: 'x' }, 'dayflow-electron': PLAIN_ENTRY }, keep: 1 })
    const removed = removeServerEntry(before)
    expect(removed.ok && JSON.parse(removed.text ?? '')).toEqual({ mcpServers: { other: { command: 'x' } }, keep: 1 })
    // Nothing to remove: the text stays as it was.
    expect(removeServerEntry('{"a":1}')).toEqual({ ok: true, text: '{"a":1}' })
    expect(removeServerEntry(null)).toEqual({ ok: true, text: null })
  })

  it('reads the dayflow-electron entry, if any', () => {
    expect(readServerEntry(JSON.stringify({ mcpServers: { 'dayflow-electron': PLAIN_ENTRY } }))).toEqual({ ok: true, entry: PLAIN_ENTRY })
    expect(readServerEntry(JSON.stringify({ mcpServers: {} }))).toEqual({ ok: true, entry: null })
    expect(readServerEntry(null)).toEqual({ ok: true, entry: null })
  })
})

describe('stale registrations', () => {
  it('matches an entry that starts this copy of the app', () => {
    expect(entryMatches(PLAIN_ENTRY, plain)).toBe(true)
    // Clients may add fields of their own, or more variables.
    expect(entryMatches({ ...PLAIN_ENTRY, env: { ELECTRON_RUN_AS_NODE: '1', DEBUG: '1' }, disabled: false }, plain)).toBe(true)
    expect(entryMatches({ command: 'flatpak', args: ['run', '--command=dayflow-electron-cli', 'io.github.kokuwaio.DayflowElectron', 'mcp'] }, flatpak)).toBe(true)
  })

  it('flags an entry for a moved app, a missing variable or the old env form', () => {
    expect(entryMatches({ ...PLAIN_ENTRY, command: 'C:\\Old\\dayflow-electron.exe' }, plain)).toBe(false)
    expect(entryMatches({ ...PLAIN_ENTRY, args: ['C:\\Old\\cli.js', 'mcp'] }, plain)).toBe(false)
    expect(entryMatches({ ...PLAIN_ENTRY, env: undefined }, plain)).toBe(false)
    expect(entryMatches({ command: 'env', args: ['ELECTRON_RUN_AS_NODE=1', plain.command, plain.args[0], 'mcp'] }, plain)).toBe(false)
    expect(entryMatches('nonsense', plain)).toBe(false)
  })
})

describe('install deep links', () => {
  it('builds the Cursor link with the base64 config, like upstream', () => {
    const url = new URL(cursorInstallUrl(plain))
    expect(url.protocol).toBe('cursor:')
    expect(url.host).toBe('anysphere.cursor-deeplink')
    expect(url.pathname).toBe('/mcp/install')
    expect(url.searchParams.get('name')).toBe('dayflow-electron')
    const config = JSON.parse(Buffer.from(url.searchParams.get('config') ?? '', 'base64').toString('utf8'))
    expect(config).toEqual({ command: plain.command, args: [plain.args[0], 'mcp'], env: { ELECTRON_RUN_AS_NODE: '1' } })
  })

  it('percent-encodes the base64, so a + survives query parsing', () => {
    // Base64 may hold "+", "/" and "="; none may stay raw in the query.
    const inv = { command: '?>?', args: [], env: {} }
    const raw = cursorInstallUrl(inv).split('config=')[1] ?? ''
    expect(raw).not.toMatch(/[+/=]/)
    expect(JSON.parse(Buffer.from(new URL(cursorInstallUrl(inv)).searchParams.get('config') ?? '', 'base64').toString()).command).toBe('?>?')
  })

  it('builds the VS Code link with the URL-encoded JSON, like upstream', () => {
    const url = vscodeInstallUrl(flatpak)
    expect(url.startsWith('vscode:mcp/install?')).toBe(true)
    expect(JSON.parse(decodeURIComponent(url.slice('vscode:mcp/install?'.length)))).toEqual({
      name: 'dayflow-electron',
      command: 'flatpak',
      args: ['run', '--command=dayflow-electron-cli', 'io.github.kokuwaio.DayflowElectron', 'mcp']
    })
    expect(url).not.toMatch(/[{}" ]/)
  })
})

describe('where the clients live', () => {
  it('finds the Claude Desktop config per OS', () => {
    expect(claudeDesktopConfigPath({ platform: 'linux', home: '/home/me' })).toBe('/home/me/.config/Claude/claude_desktop_config.json')
    expect(claudeDesktopConfigPath({ platform: 'linux', home: '/home/me', xdgConfigHome: '/home/me/.cfg' })).toBe('/home/me/.cfg/Claude/claude_desktop_config.json')
    expect(claudeDesktopConfigPath({ platform: 'darwin', home: '/Users/me' })).toBe('/Users/me/Library/Application Support/Claude/claude_desktop_config.json')
    expect(claudeDesktopConfigPath({ platform: 'win32', home: 'C:\\Users\\me', appData: 'C:\\Users\\me\\AppData\\Roaming' })).toBe(
      'C:\\Users\\me\\AppData\\Roaming\\Claude\\claude_desktop_config.json'
    )
    expect(claudeDesktopConfigPath({ platform: 'win32', home: 'C:\\Users\\me' })).toBe('C:\\Users\\me\\AppData\\Roaming\\Claude\\claude_desktop_config.json')
  })

  it('looks for Cursor and VS Code by their user folders and app bundles', () => {
    expect(deepLinkMarkers('cursor', { platform: 'linux', home: '/home/me' })).toEqual(['/home/me/.cursor'])
    expect(deepLinkMarkers('vscode', { platform: 'darwin', home: '/Users/me' })).toEqual(['/Users/me/.vscode', '/Applications/Visual Studio Code.app'])
    expect(deepLinkMarkers('cursor', { platform: 'win32', home: 'C:\\Users\\me', localAppData: 'C:\\Users\\me\\AppData\\Local' })).toEqual([
      'C:\\Users\\me\\.cursor',
      'C:\\Users\\me\\AppData\\Local\\Programs\\cursor'
    ])
  })
})
