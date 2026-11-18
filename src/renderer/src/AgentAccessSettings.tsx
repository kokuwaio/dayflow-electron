// Settings → "MCP / CLI", after upstream Dayflow
// (Views/UI/Settings/SettingsAgentAccessTabView.swift): connect AI tools to
// the bundled `dayflow-electron` CLI, the edits switch, and the terminal command.
// Claude Code and Codex are connected with their own CLI, Claude Desktop by
// its config file, Cursor and VS Code through their install links.

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AGENT_CLIENT_NAMES } from '@shared/agent-clients'
import type { AgentAccessInfo, AgentClient, AgentClientState, Settings } from '@shared/types'
import { CommandBlock, Row, Section, StatusDot } from './SettingsLayout'

// Upstream's order and texts (AgentClient in AgentClientRegistration.swift).
const CLIENTS: AgentClient[] = ['codex', 'claude', 'claude-desktop', 'cursor', 'vscode']

type RowState = AgentClientState | { state: 'checking' | 'connecting' | 'disconnecting' }

export function AgentAccessSettings({ settings, save }: { settings: Settings; save: (next: Partial<Settings>) => void }) {
  const { t } = useTranslation()
  const [info, setInfo] = useState<AgentAccessInfo | null>(null)
  useEffect(() => void window.dayflow.getAgentAccess().then(setInfo), [])

  return (
    <>
      <Section
        title={t('agents.connect.title')}
        sub={t('agents.connect.sub')}
      >
        {CLIENTS.map((client) => (
          <ClientRow key={client} client={client} />
        ))}
        {info && (
          <Row label={t('agents.connect.otherApps')} sub={t('agents.connect.otherAppsSub')} stack>
            <CommandBlock text={info.configSnippet} label={t('agents.copyConfig')} />
          </Row>
        )}
      </Section>

      <Section
        title={t('agents.edits.title')}
        sub={t('agents.edits.sub')}
      >
        <Row label={settings.allowEdits ? t('agents.edits.on') : t('agents.edits.off')} sub={settings.allowEdits ? t('agents.edits.onSub') : undefined}>
          <input
            type="checkbox"
            className="switch"
            checked={settings.allowEdits}
            onChange={(e) => save({ allowEdits: e.target.checked })}
            aria-label={t('agents.edits.title')}
          />
        </Row>
      </Section>

      <Section
        title={t('agents.terminal.title')}
        sub={t('agents.terminal.sub')}
      >
        {info?.terminal ? (
          <>
            <Row label={t('agents.terminal.install')} sub={t('agents.terminal.installSub')} stack>
              <CommandBlock text={info.terminal.install} />
            </Row>
            <Row label={t('agents.terminal.remove')} sub={t('agents.terminal.removeSub')} stack>
              <CommandBlock text={info.terminal.remove} />
            </Row>
          </>
        ) : (
          info && <Row label={t('agents.terminal.windows')} sub={t('agents.terminal.windowsSub')} />
        )}
      </Section>
    </>
  )
}

function ClientRow({ client }: { client: AgentClient }) {
  const { t } = useTranslation()
  const name = AGENT_CLIENT_NAMES[client]
  const [row, setRow] = useState<RowState>({ state: 'checking' })
  useEffect(() => void window.dayflow.agentClient(client, 'status').then(setRow), [client])
  const act = (action: 'connect' | 'disconnect') => {
    setRow({ state: action === 'connect' ? 'connecting' : 'disconnecting' })
    void window.dayflow.agentClient(client, action).then(setRow, (err: unknown) => setRow({ state: 'failed', message: String(err) }))
  }

  const status =
    row.state === 'connected' ? (
      <StatusDot kind="good">{client === 'codex' ? t('agents.client.connectedCodex') : t('agents.client.connected')}</StatusDot>
    ) : row.state === 'failed' ? (
      <StatusDot kind="bad">{row.message}</StatusDot>
    ) : row.state === 'notFound' ? (
      <StatusDot kind="neutral">{t('agents.client.notFound')}</StatusDot>
    ) : row.state === 'checking' ? (
      t('agents.client.checking')
    ) : row.state === 'connecting' ? (
      t('agents.client.connecting')
    ) : row.state === 'disconnecting' ? (
      t('agents.client.disconnecting')
    ) : row.state === 'manual' ? (
      row.message
    ) : row.state === 'openedInstaller' ? (
      t('agents.client.approve')
    ) : undefined

  return (
    <Row label={name} sub={status} stack={row.state === 'manual'}>
      {row.state === 'available' && (
        <button className="btn-ink" onClick={() => act('connect')}>
          {t('agents.client.connect')}
        </button>
      )}
      {row.state === 'connected' && (
        <button className="btn-subtle" onClick={() => act('disconnect')}>
          {t('agents.client.disconnect')}
        </button>
      )}
      {row.state === 'failed' && (
        <button className="btn-subtle" onClick={() => act('connect')}>
          {t('common.retry')}
        </button>
      )}
      {row.state === 'openedInstaller' && <StatusDot kind="neutral">{t('agents.client.finishIn', { name })}</StatusDot>}
      {row.state === 'manual' && <CommandBlock text={row.command} label={client === 'claude-desktop' ? t('agents.copyConfig') : t('common.copy')} />}
    </Row>
  )
}
