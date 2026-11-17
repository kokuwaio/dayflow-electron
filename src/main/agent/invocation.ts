// How MCP clients and terminals start the `dayflow-electron` CLI, after upstream
// Dayflow (Core/AgentAccess/AgentClientRegistration.swift,
// CodexMCPRegistration.swift). Upstream points clients at a binary inside the
// app bundle. Here the CLI is a script that Electron runs in Node mode: in
// the Flatpak through `flatpak run --command=dayflow-electron-cli <app id>`, elsewhere
// as `<electron> <app>/out/main/cli.js` with ELECTRON_RUN_AS_NODE=1 in its
// environment. The variable travels separately (client configs have an "env"
// field, `mcp add` takes -e/--env): Windows has no `env` program, so only
// POSIX shell lines put it in front with `env`.

import type { CliName } from '../../shared/types'

/** The wrapper script the Flatpak manifest installs in /app/bin. */
export const FLATPAK_CLI_COMMAND = 'dayflow-electron-cli'
/** The MCP server's name in client configs (upstream: "dayflow"). */
export const MCP_SERVER_NAME = 'dayflow-electron'
/** Where the terminal command goes; ~/.local/bin is on PATH on most Linux desktops and needs no sudo. */
export const TERMINAL_COMMAND_PATH = '~/.local/bin/dayflow-electron'
/** Marks wrapper scripts the app wrote, so `dayflow-electron unlink` removes only its own. */
export const WRAPPER_MARKER = '# dayflow-electron CLI wrapper'

export interface Invocation {
  command: string
  args: string[]
  /** Variables the CLI needs in its environment. */
  env: Record<string, string>
}

/** The command line that starts the CLI, without its own arguments. */
export function cliInvocation(o: { flatpakId?: string; execPath: string; script: string }): Invocation {
  if (o.flatpakId) return { command: 'flatpak', args: ['run', `--command=${FLATPAK_CLI_COMMAND}`, o.flatpakId], env: {} }
  return { command: o.execPath, args: [o.script], env: { ELECTRON_RUN_AS_NODE: '1' } }
}

const envPairs = (inv: Invocation) => Object.entries(inv.env).map(([k, v]) => `${k}=${v}`)

/** The invocation as one argv for POSIX shells and scripts: the environment goes in front through `env`. */
export function posixArgv(inv: Invocation): string[] {
  const pairs = envPairs(inv)
  return [...(pairs.length ? ['env', ...pairs] : []), inv.command, ...inv.args]
}

/** The MCP server entry for JSON client configs (upstream writes "type": "stdio" too). */
export function mcpServerConfig(inv: Invocation): { command: string; args: string[]; env?: Record<string, string> } {
  return { command: inv.command, args: [...inv.args, 'mcp'], ...(Object.keys(inv.env).length ? { env: { ...inv.env } } : {}) }
}

/** Quotes a word for POSIX shells, only when it needs it. */
export const shQuote = (s: string) => (/^[A-Za-z0-9_\/.=:@%+,-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`)

export const shellLine = (argv: string[]) => argv.map(shQuote).join(' ')

export function wrapperScript(inv: Invocation): string {
  return ['#!/bin/sh', WRAPPER_MARKER, `exec ${shellLine(posixArgv(inv))} "$@"`, ''].join('\n')
}

/** Removes what terminalInstallCommand put in place (upstream's tab offers install and remove). */
export const terminalRemoveCommand = (): string => `rm -f ${TERMINAL_COMMAND_PATH}`

/** A command to paste into a terminal that installs `dayflow-electron` into ~/.local/bin. */
export function terminalInstallCommand(inv: Invocation): string {
  const lines = wrapperScript(inv).trimEnd().split('\n')
  return `mkdir -p ~/.local/bin && printf '%s\\n' ${lines.map(shQuote).join(' ')} > ${TERMINAL_COMMAND_PATH} && chmod +x ${TERMINAL_COMMAND_PATH}`
}

/** The JSON snippet for MCP clients without a registration command (upstream manualConfigSnippet). */
export function manualConfigSnippet(inv: Invocation): string {
  return `"${MCP_SERVER_NAME}": ${JSON.stringify(mcpServerConfig(inv), null, 2)}`
}

/** The client CLI's arguments to add, remove and look up the "dayflow-electron" MCP server (user scope, like upstream). */
export function mcpRegistration(client: CliName, inv: Invocation): { add: string[]; remove: string[]; get: string[] } {
  const server = ['--', inv.command, ...inv.args, 'mcp']
  // After the name: Claude Code's -e takes several values and would take the name for one.
  const env = (flag: string) => envPairs(inv).flatMap((pair) => [flag, pair])
  return client === 'claude'
    ? {
        add: ['mcp', 'add', '--scope', 'user', MCP_SERVER_NAME, ...env('-e'), ...server],
        remove: ['mcp', 'remove', '--scope', 'user', MCP_SERVER_NAME],
        get: ['mcp', 'get', MCP_SERVER_NAME]
      }
    : {
        add: ['mcp', 'add', MCP_SERVER_NAME, ...env('--env'), ...server],
        remove: ['mcp', 'remove', MCP_SERVER_NAME],
        get: ['mcp', 'get', MCP_SERVER_NAME, '--json']
      }
}
