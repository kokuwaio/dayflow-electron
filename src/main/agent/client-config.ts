// Client configs and install links for the MCP server, after upstream Dayflow
// (Core/AgentAccess/AgentClientRegistration.swift): Claude Desktop gets the
// "dayflow-electron" entry merged into its JSON config; Cursor and VS Code get install
// deep links and write their own config after their own consent dialog.
// Pure functions: the caller reads and writes the files.

import { posix, win32 } from 'node:path'
import { type Invocation, MCP_SERVER_NAME, mcpServerConfig } from './invocation'

/** The clients that take an install link instead of a config write. */
export type DeepLinkClient = 'cursor' | 'vscode'

export type ConfigResult<T> = ({ ok: true } & T) | { ok: false; error: string }

type Json = Record<string, unknown>

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Parses a config; a missing or blank file is an empty one. Anything else unparsable is an error, never overwritten. */
function parseConfig(text: string | null, file: string): ConfigResult<{ config: Json }> {
  if (text === null || !text.trim()) return { ok: true, config: {} }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, error: `${file} exists but isn't valid JSON, so Dayflow Electron left it alone.` }
  }
  if (!isObject(parsed)) return { ok: false, error: `${file} isn't a JSON object, so Dayflow Electron left it alone.` }
  if (parsed.mcpServers !== undefined && !isObject(parsed.mcpServers)) {
    return { ok: false, error: `"mcpServers" in ${file} isn't an object, so Dayflow Electron left it alone.` }
  }
  return { ok: true, config: parsed }
}

const serialize = (config: Json) => `${JSON.stringify(config, null, 2)}\n`

/** The "dayflow-electron" entry under mcpServers, or null when there is none. */
export function readServerEntry(text: string | null, file = 'The config'): ConfigResult<{ entry: unknown }> {
  const parsed = parseConfig(text, file)
  if (!parsed.ok) return parsed
  const servers = parsed.config.mcpServers as Json | undefined
  return { ok: true, entry: servers?.[MCP_SERVER_NAME] ?? null }
}

/** Adds or replaces only the "dayflow-electron" entry under mcpServers; every other key stays as it was. */
export function mergeServerEntry(text: string | null, inv: Invocation, file = 'The config'): ConfigResult<{ text: string }> {
  const parsed = parseConfig(text, file)
  if (!parsed.ok) return parsed
  const servers = { ...((parsed.config.mcpServers as Json | undefined) ?? {}) }
  servers[MCP_SERVER_NAME] = { type: 'stdio', ...mcpServerConfig(inv) }
  return { ok: true, text: serialize({ ...parsed.config, mcpServers: servers }) }
}

/** Removes the "dayflow-electron" entry; without one the text comes back unchanged. */
export function removeServerEntry(text: string | null, file = 'The config'): ConfigResult<{ text: string | null }> {
  const parsed = parseConfig(text, file)
  if (!parsed.ok) return parsed
  const servers = parsed.config.mcpServers as Json | undefined
  if (!servers || !(MCP_SERVER_NAME in servers)) return { ok: true, text }
  const { [MCP_SERVER_NAME]: _removed, ...rest } = servers
  return { ok: true, text: serialize({ ...parsed.config, mcpServers: rest }) }
}

/**
 * Whether a registered entry starts this copy of the app: same command and
 * arguments, and the variables the CLI needs. A moved app or an entry from
 * before the variables travelled separately (`env VAR=1 ...`) is stale.
 */
export function entryMatches(entry: unknown, inv: Invocation): boolean {
  if (!isObject(entry)) return false
  const want = mcpServerConfig(inv)
  if (entry.command !== want.command || JSON.stringify(entry.args ?? []) !== JSON.stringify(want.args)) return false
  const env = isObject(entry.env) ? entry.env : {}
  return Object.entries(want.env ?? {}).every(([k, v]) => env[k] === v)
}

/** Cursor's install link: the config as base64 (upstream's format), percent-encoded so "+" survives. */
export function cursorInstallUrl(inv: Invocation): string {
  const config = Buffer.from(JSON.stringify(mcpServerConfig(inv)), 'utf8').toString('base64')
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=${MCP_SERVER_NAME}&config=${encodeURIComponent(config)}`
}

/** VS Code's install link: the config with its name, URL-encoded (upstream's format). */
export function vscodeInstallUrl(inv: Invocation): string {
  return `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: MCP_SERVER_NAME, ...mcpServerConfig(inv) }))}`
}

export interface ClientPlaces {
  platform: NodeJS.Platform
  home: string
  /** Linux: $XDG_CONFIG_HOME on the host (not the Flatpak's own). */
  xdgConfigHome?: string
  /** Windows: %APPDATA%. */
  appData?: string
  /** Windows: %LOCALAPPDATA%. */
  localAppData?: string
}

/** Path functions for the platform the config lives on (Windows paths differ). */
export const pathFor = (platform: NodeJS.Platform) => (platform === 'win32' ? win32 : posix)

/** Claude Desktop's config: ~/Library/Application Support/Claude on macOS, %APPDATA%\Claude on Windows, ~/.config/Claude on Linux. */
export function claudeDesktopConfigPath(p: ClientPlaces): string {
  const path = pathFor(p.platform)
  const dir =
    p.platform === 'darwin'
      ? path.join(p.home, 'Library', 'Application Support')
      : p.platform === 'win32'
        ? (p.appData ?? path.join(p.home, 'AppData', 'Roaming'))
        : (p.xdgConfigHome ?? path.join(p.home, '.config'))
  return path.join(dir, 'Claude', 'claude_desktop_config.json')
}

/** Paths whose existence shows the client is installed (upstream looks for the app bundle in /Applications). */
export function deepLinkMarkers(client: DeepLinkClient, p: ClientPlaces): string[] {
  const path = pathFor(p.platform)
  const userDir = path.join(p.home, client === 'cursor' ? '.cursor' : '.vscode')
  if (p.platform === 'darwin') return [userDir, client === 'cursor' ? '/Applications/Cursor.app' : '/Applications/Visual Studio Code.app']
  if (p.platform === 'win32') {
    const local = p.localAppData ?? path.join(p.home, 'AppData', 'Local')
    return [userDir, path.join(local, 'Programs', client === 'cursor' ? 'cursor' : 'Microsoft VS Code')]
  }
  return [userDir]
}
