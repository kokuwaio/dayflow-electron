import { useEffect, useState } from 'react'
import type { AppStatus, Settings, Tab } from '@shared/types'
import { Chat } from './Chat'
import { Daily } from './Daily'
import { Onboarding } from './Onboarding'
import { SettingsView } from './Settings'
import { StatusPill } from './StatusPill'
import { Timeline } from './Timeline'
import { Weekly } from './Weekly'

const TABS = [
  { id: 'timeline', label: 'Timeline' },
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'chat', label: 'Chat' },
  { id: 'settings', label: 'Settings' }
] as const satisfies ReadonlyArray<{ id: Tab; label: string }>
type View = (typeof TABS)[number]['id']

export function App() {
  const [view, setView] = useState<View>('timeline')
  const [status, setStatus] = useState<AppStatus | null>(null)

  const [settings, setSettings] = useState<Settings | null>(null)

  useEffect(() => {
    void window.dayflow.getStatus().then(setStatus)
    void window.dayflow.getSettings().then(setSettings)
    const offNavigate = window.dayflow.onNavigate((tab) => TABS.some((t) => t.id === tab) && setView(tab as View))
    const offStatus = window.dayflow.onStatus(setStatus)
    return () => {
      offNavigate()
      offStatus()
    }
  }, [])

  if (settings && !settings.onboarded) {
    return (
      <Onboarding
        settings={settings}
        platform={status?.platform ?? 'linux'}
        onDone={() => void window.dayflow.getSettings().then(setSettings)}
      />
    )
  }

  return (
    <div className="app">
      <header className="topbar">
        <nav className="tabs">
          {TABS.map((t) => (
            <button key={t.id} className={view === t.id ? 'active' : ''} onClick={() => setView(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
        {status && <StatusPill status={status} onChange={() => void window.dayflow.getStatus().then(setStatus)} />}
      </header>
      {status?.analysis.lastError && (
        <div className="banner">
          Analysis: {status.analysis.lastError}
          {view !== 'settings' && <button onClick={() => setView('settings')}>Open settings</button>}
        </div>
      )}
      {status?.recorder.state === 'backoff' && status.recorder.lastError && (
        <div className="banner">Capture: {status.recorder.lastError}</div>
      )}
      <main>
        {view === 'timeline' && <Timeline />}
        {view === 'daily' && <Daily />}
        {view === 'weekly' && <Weekly />}
        {view === 'chat' && <Chat />}
        {view === 'settings' && <SettingsView status={status} />}
      </main>
    </div>
  )
}
