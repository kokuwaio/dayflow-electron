import { useEffect, useState } from 'react'
import type { AppStatus, Settings } from '@shared/types'
import { Onboarding } from './Onboarding'
import { SettingsView } from './Settings'
import { StatusPill } from './StatusPill'
import { Timeline } from './Timeline'

export function App() {
  const [view, setView] = useState<'timeline' | 'settings'>('timeline')
  const [status, setStatus] = useState<AppStatus | null>(null)

  const [settings, setSettings] = useState<Settings | null>(null)

  useEffect(() => {
    void window.dayflow.getStatus().then(setStatus)
    void window.dayflow.getSettings().then(setSettings)
    return window.dayflow.onStatus(setStatus)
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
          <button className={view === 'timeline' ? 'active' : ''} onClick={() => setView('timeline')}>
            Timeline
          </button>
          <button className={view === 'settings' ? 'active' : ''} onClick={() => setView('settings')}>
            Settings
          </button>
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
      <main>{view === 'timeline' ? <Timeline /> : <SettingsView status={status} />}</main>
    </div>
  )
}
