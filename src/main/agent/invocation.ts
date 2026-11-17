// How MCP clients and terminals start the `dayflow` CLI, after upstream
// Dayflow (Core/AgentAccess/AgentClientRegistration.swift,
// CodexMCPRegistration.swift). Upstream points clients at a binary inside the
// app bundle. Here the CLI is a script that Electron runs in Node mode: in
// the Flatpak through `flatpak run --command=dayflow-cli <app id>`, elsewhere
// as `env ELECTRON_RUN_AS_NODE=1 <electron> <app>/out/main/cli.js`.

import type { CliName } from '../../shared/types'

/** The wrapper script the Flatpak manifest installs in /app/bin. */
export const FLATPAK_CLI_COMMAND = 'dayflow-cli'
/** The MCP server's name in client configs (upstream: "dayflow"). */
export const MCP_SERVER_NAME = 'dayflow'
/** Where the terminal command goes; ~/.local/bin is on PATH on most Linux desktops and needs no sudo. */
export const TERMINAL_COMMAND_PATH = '~/.local/bin/dayflow'
/** Marks wrapper scripts the app wrote, so `dayflow unlink` removes only its own. */
export const WRAPPER_MARKER = '# dayflow-electron CLI wrapper'

export interface Invocation {
  command: string
  args: string[]
}

/** The command line that starts the CLI, without its own arguments. */
export function cliInvocation(o: { flatpakId?: string; execPath: string; script: string }): Invocation {
  if (o.flatpakId) return { command: 'flatpak', args: ['run', `--command=${FLATPAK_CLI_COMMAND}`, o.flatpakId] }
  return { command: 'env', args: ['ELECTRON_RUN_AS_NODE=1', o.execPath, o.script] }
}

/** Quotes a word for POSIX shells, only when it needs it. */
export const shQuote = (s: string) => (/^[A-Za-z0-9_\/.=:@%+,-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`)

export const shellLine = (argv: string[]) => argv.map(shQuote).join(' ')

export function wrapperScript(inv: Invocation): string {
  return ['#!/bin/sh', WRAPPER_MARKER, `exec ${shellLine([inv.command, ...inv.args])} "$@"`, ''].join('\n')
}

/** A command to paste into a terminal that installs `dayflow` into ~/.local/bin. */
export function terminalInstallCommand(inv: Invocation): string {
  const lines = wrapperScript(inv).trimEnd().split('\n')
  return `mkdir -p ~/.local/bin && printf '%s\\n' ${lines.map(shQuote).join(' ')} > ${TERMINAL_COMMAND_PATH} && chmod +x ${TERMINAL_COMMAND_PATH}`
}

/** The JSON snippet for MCP clients without a registration command (upstream manualConfigSnippet). */
export function manualConfigSnippet(inv: Invocation): string {
  return `"${MCP_SERVER_NAME}": ${JSON.stringify({ command: inv.command, args: [...inv.args, 'mcp'] }, null, 2)}`
}

/** The client CLI's arguments to add, remove and look up the "dayflow" MCP server (user scope, like upstream). */
export function mcpRegistration(client: CliName, inv: Invocation): { add: string[]; remove: string[]; get: string[] } {
  const server = ['--', inv.command, ...inv.args, 'mcp']
  return client === 'claude'
    ? {
        add: ['mcp', 'add', '--scope', 'user', MCP_SERVER_NAME, ...server],
        remove: ['mcp', 'remove', '--scope', 'user', MCP_SERVER_NAME],
        get: ['mcp', 'get', MCP_SERVER_NAME]
      }
    : {
        add: ['mcp', 'add', MCP_SERVER_NAME, ...server],
        remove: ['mcp', 'remove', MCP_SERVER_NAME],
        get: ['mcp', 'get', MCP_SERVER_NAME, '--json']
      }
}
