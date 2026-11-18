// The AI tools the app can register its MCP server with, and their names.

import type { AgentClient } from './types'

export const AGENT_CLIENT_NAMES: Record<AgentClient, string> = {
  codex: 'Codex',
  claude: 'Claude Code',
  'claude-desktop': 'Claude Desktop',
  cursor: 'Cursor',
  vscode: 'VS Code'
}

export const isAgentClient = (value: unknown): value is AgentClient => typeof value === 'string' && Object.hasOwn(AGENT_CLIENT_NAMES, value)

/** Windows has no ~/.local/bin and does not run the POSIX wrapper. */
export const TERMINAL_COMMAND_UNSUPPORTED = 'The dayflow-electron terminal command is available on Linux and macOS. On Windows, connect your AI tools under Settings → MCP / CLI.'
