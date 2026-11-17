// The AI tools the app can register its MCP server with, and their names.

import type { CliName } from './types'

export const AGENT_CLIENT_NAMES: Record<CliName, string> = { claude: 'Claude Code', codex: 'Codex' }

export const isAgentClient = (value: unknown): value is CliName => typeof value === 'string' && Object.hasOwn(AGENT_CLIENT_NAMES, value)
