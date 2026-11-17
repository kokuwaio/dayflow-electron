// Settings → "MCP / CLI", after upstream Dayflow
// (Views/UI/Settings/SettingsAgentAccessTabView.swift): connect AI tools to
// the bundled `dayflow` CLI, the edits switch, and the terminal command.

import { useEffect, useState } from 'react'
import type { AgentAccessInfo, AgentClientState, CliName, Settings } from '@shared/types'

const CLIENTS: Array<{ cli: CliName; name: string; restart: string }> = [
  { cli: 'codex', name: 'Codex', restart: 'Restart Codex to pick up the connection.' },
  { cli: 'claude', name: 'Claude Code', restart: 'Restart it to pick up the connection.' }
]

type RowState = AgentClientState | { state: 'checking' | 'connecting' | 'disconnecting' }

export function AgentAccessSettings({ settings, save }: { settings: Settings; save: (next: Partial<Settings>) => void }) {
  const [info, setInfo] = useState<AgentAccessInfo | null>(null)
  useEffect(() => void window.dayflow.getAgentAccess().then(setInfo), [])

  return (
    <section>
      <h2>MCP / CLI</h2>
      <h3>Connect to AI tools</h3>
      <p className="note">
        Let Codex, Claude, and other AI tools read your Dayflow timeline. Connections are saved to each tool's user configuration, so
        Dayflow is available across projects on this computer. Nothing leaves your computer except what you send in your own
        conversations.
      </p>
      {CLIENTS.map((c) => (
        <ClientRow key={c.cli} {...c} />
      ))}
      {info && (
        <div className="field">
          <span>Other apps</span>
          <p className="note">Paste this into any MCP client's configuration.</p>
          <CommandBlock text={info.configSnippet} label="Copy config" />
        </div>
      )}

      <h3>Allow edits</h3>
      <p className="note">
        Off means AI tools can read your timeline but never change it. On lets them rename activities, manage categories, and set day
        goals. The terminal command asks before deleting anything, and AI tools are told to confirm deletes with you. Every edit is
        logged to agent-writes.log in the data folder.
      </p>
      <label className="check">
        <input type="checkbox" checked={settings.allowEdits} onChange={(e) => save({ allowEdits: e.target.checked })} />
        {settings.allowEdits ? 'Edits are on' : 'Edits are off'}
      </label>
      {settings.allowEdits && <p className="note">AI tools can make changes through Dayflow while it's running.</p>}

      <h3>Terminal command</h3>
      <p className="note">
        Adds a <code>dayflow</code> command to <code>~/.local/bin</code> so you can see your timeline from any terminal. It starts the
        CLI already inside Dayflow, so it always matches the app. Nothing is downloaded and your shell configuration isn't touched. Run
        this once in a terminal, then try <code>dayflow timeline</code>:
      </p>
      {info && <CommandBlock text={info.terminalInstall} label="Copy" />}
    </section>
  )
}

function ClientRow({ cli, name, restart }: { cli: CliName; name: string; restart: string }) {
  const [row, setRow] = useState<RowState>({ state: 'checking' })
  useEffect(() => void window.dayflow.agentClient(cli, 'status').then(setRow), [cli])
  const act = (action: 'connect' | 'disconnect') => {
    setRow({ state: action === 'connect' ? 'connecting' : 'disconnecting' })
    void window.dayflow.agentClient(cli, action).then(setRow, (err: unknown) => setRow({ state: 'failed', message: String(err) }))
  }

  return (
    <div className="field">
      <div className="row">
        <strong>{name}</strong>
        {row.state === 'notFound' && <span className="note">Not found</span>}
        {row.state === 'checking' && <span className="note">Checking…</span>}
        {row.state === 'connecting' && <span className="note">Connecting…</span>}
        {row.state === 'disconnecting' && <span className="note">Disconnecting…</span>}
        {row.state === 'available' && <button onClick={() => act('connect')}>Connect</button>}
        {row.state === 'connected' && (
          <>
            <span className="ok">● Connected</span>
            <button onClick={() => act('disconnect')}>Disconnect</button>
          </>
        )}
        {row.state === 'failed' && <button onClick={() => act('connect')}>Retry</button>}
      </div>
      {row.state === 'connected' && <p className="note">{restart}</p>}
      {row.state === 'failed' && <p className="error">{row.message}</p>}
      {row.state === 'manual' && (
        <>
          <p className="note">{row.message} Or run this in a terminal to connect {name}:</p>
          <CommandBlock text={row.command} label="Copy" />
        </>
      )}
    </div>
  )
}

/** A command or config to copy, shown as is. */
function CommandBlock({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="row">
      <code style={{ flex: 1, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', userSelect: 'all' }}>{text}</code>
      <button
        onClick={() => {
          void window.dayflow.copyText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        }}
      >
        {copied ? 'Copied' : label}
      </button>
    </div>
  )
}
