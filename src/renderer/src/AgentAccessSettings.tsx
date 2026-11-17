// Settings → "MCP / CLI", after upstream Dayflow
// (Views/UI/Settings/SettingsAgentAccessTabView.swift): connect AI tools to
// the bundled `dayflow-electron` CLI, the edits switch, and the terminal command.
// Claude Code and Codex are connected with their own CLI, Claude Desktop by
// its config file, Cursor and VS Code through their install links.

import { useEffect, useState } from 'react'
import { AGENT_CLIENT_NAMES, TERMINAL_COMMAND_UNSUPPORTED } from '@shared/agent-clients'
import type { AgentAccessInfo, AgentClient, AgentClientState, Settings } from '@shared/types'
import { CommandBlock, Row, Section, StatusDot } from './SettingsLayout'

// Upstream's order and texts (AgentClient in AgentClientRegistration.swift).
const RESTART = 'Restart it to pick up the connection.'
const CLIENTS: Array<{ client: AgentClient; restart: string }> = [
  { client: 'codex', restart: 'Restart Codex to pick up the connection.' },
  { client: 'claude', restart: RESTART },
  { client: 'claude-desktop', restart: RESTART },
  { client: 'cursor', restart: RESTART },
  { client: 'vscode', restart: RESTART }
]

type RowState = AgentClientState | { state: 'checking' | 'connecting' | 'disconnecting' }

export function AgentAccessSettings({ settings, save }: { settings: Settings; save: (next: Partial<Settings>) => void }) {
  const [info, setInfo] = useState<AgentAccessInfo | null>(null)
  useEffect(() => void window.dayflow.getAgentAccess().then(setInfo), [])

  return (
    <>
      <Section
        title="Connect to AI tools"
        sub="Let Codex, Claude, Cursor, and other AI tools read your Dayflow Electron timeline. Connections are saved to each tool's user configuration, so Dayflow Electron is available across projects on this computer. Nothing leaves your computer except what you send in your own conversations."
      >
        {CLIENTS.map((c) => (
          <ClientRow key={c.client} {...c} />
        ))}
        {info && (
          <Row label="Other apps" sub="Paste this into any MCP client's configuration." stack>
            <CommandBlock text={info.configSnippet} label="Copy config" />
          </Row>
        )}
      </Section>

      <Section
        title="Allow edits"
        sub="Off means AI tools can read your timeline but never change it. On lets them rename activities, manage categories, and set day goals. The terminal command asks before deleting anything, and AI tools are told to confirm deletes with you. Every edit is logged to agent-writes.log in the data folder."
      >
        <Row
          label={settings.allowEdits ? 'Edits are on' : 'Edits are off'}
          sub={settings.allowEdits ? "AI tools can make changes through Dayflow Electron while it's running." : undefined}
        >
          <input
            type="checkbox"
            className="switch"
            checked={settings.allowEdits}
            onChange={(e) => save({ allowEdits: e.target.checked })}
            aria-label="Allow edits"
          />
        </Row>
      </Section>

      <Section
        title="Terminal command"
        sub="Adds a dayflow-electron command to ~/.local/bin so you can see your timeline from any terminal. It starts the CLI already inside Dayflow Electron, so it always matches the app. Nothing is downloaded and your shell configuration isn't touched."
      >
        {info?.terminal ? (
          <>
            <Row label="Install" sub="Run this once in a terminal, then try dayflow-electron timeline." stack>
              <CommandBlock text={info.terminal.install} />
            </Row>
            <Row label="Remove" sub="Run this to take the command away again." stack>
              <CommandBlock text={info.terminal.remove} />
            </Row>
          </>
        ) : (
          info && <Row label="Not available on Windows" sub={TERMINAL_COMMAND_UNSUPPORTED} />
        )}
      </Section>
    </>
  )
}

function ClientRow({ client, restart }: { client: AgentClient; restart: string }) {
  const name = AGENT_CLIENT_NAMES[client]
  const [row, setRow] = useState<RowState>({ state: 'checking' })
  useEffect(() => void window.dayflow.agentClient(client, 'status').then(setRow), [client])
  const act = (action: 'connect' | 'disconnect') => {
    setRow({ state: action === 'connect' ? 'connecting' : 'disconnecting' })
    void window.dayflow.agentClient(client, action).then(setRow, (err: unknown) => setRow({ state: 'failed', message: String(err) }))
  }

  const status =
    row.state === 'connected' ? (
      <StatusDot kind="good">Connected. {restart}</StatusDot>
    ) : row.state === 'failed' ? (
      <StatusDot kind="bad">{row.message}</StatusDot>
    ) : row.state === 'notFound' ? (
      <StatusDot kind="neutral">Not found</StatusDot>
    ) : row.state === 'checking' ? (
      'Checking…'
    ) : row.state === 'connecting' ? (
      'Connecting…'
    ) : row.state === 'disconnecting' ? (
      'Disconnecting…'
    ) : row.state === 'manual' ? (
      row.message
    ) : row.state === 'openedInstaller' ? (
      'Approve the install dialog it just showed.'
    ) : undefined

  return (
    <Row label={name} sub={status} stack={row.state === 'manual'}>
      {row.state === 'available' && (
        <button className="btn-ink" onClick={() => act('connect')}>
          Connect
        </button>
      )}
      {row.state === 'connected' && (
        <button className="btn-subtle" onClick={() => act('disconnect')}>
          Disconnect
        </button>
      )}
      {row.state === 'failed' && (
        <button className="btn-subtle" onClick={() => act('connect')}>
          Retry
        </button>
      )}
      {row.state === 'openedInstaller' && <StatusDot kind="neutral">Finish in {name}</StatusDot>}
      {row.state === 'manual' && <CommandBlock text={row.command} label={client === 'claude-desktop' ? 'Copy config' : 'Copy'} />}
    </Row>
  )
}
