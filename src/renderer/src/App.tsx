import { useEffect, useState } from 'react'
import { CalendarRange, ChartPie, ListTree, type LucideIcon, MessagesSquare, Settings as SettingsIcon, X } from 'lucide-react'
import type { AppStatus, Settings, Tab } from '@shared/types'
import { Chat } from './Chat'
import { Daily } from './Daily'
import { Onboarding } from './Onboarding'
import { type SettingsTab, SettingsView } from './Settings'
import { Timeline } from './Timeline'
import { dueGoalPrompt } from './goal-prompt'
import { applyUiStyle } from './ui-style'
import { Weekly } from './Weekly'

/** Upstream's sidebar (MainView/SidebarView.swift), with Lucide icons in place of its artwork. */
const TABS = [
  { id: 'timeline', label: 'Timeline', icon: ListTree },
  { id: 'daily', label: 'Daily', icon: ChartPie },
  { id: 'weekly', label: 'Weekly', icon: CalendarRange },
  { id: 'chat', label: 'Chat', icon: MessagesSquare },
  { id: 'settings', label: 'Settings', icon: SettingsIcon }
] as const satisfies ReadonlyArray<{ id: Tab; label: string; icon: LucideIcon }>
type View = (typeof TABS)[number]['id']

export function App() {
  const [view, setView] = useState<View>('timeline')
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('providers')
  const [status, setStatus] = useState<AppStatus | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [dismissed, setDismissed] = useState<string[]>([])
  const [goalPromptDay, setGoalPromptDay] = useState<string | null>(null)

  useEffect(() => {
    void window.dayflow.getStatus().then(setStatus)
    void window.dayflow.getSettings().then((s) => {
      applyUiStyle(s.uiStyle)
      setSettings(s)
    })
    const offNavigate = window.dayflow.onNavigate((tab) => TABS.some((t) => t.id === tab) && setView(tab as View))
    const offStatus = window.dayflow.onStatus(setStatus)
    return () => {
      offNavigate()
      offStatus()
    }
  }, [])

  // The daily goal pop-up, checked at start, on focus and every minute (upstream requestDailyGoalPromptIfNeeded).
  const onboarded = !!settings?.onboarded
  useEffect(() => {
    if (!onboarded) return
    let checking = false
    const check = () => {
      if (checking) return
      checking = true
      void dueGoalPrompt()
        .then((day) => {
          if (!day) return
          setView('timeline')
          setGoalPromptDay(day)
        })
        .finally(() => (checking = false))
    }
    check()
    window.addEventListener('focus', check)
    const timer = setInterval(check, 60_000)
    return () => {
      window.removeEventListener('focus', check)
      clearInterval(timer)
    }
  }, [onboarded])

  if (settings && !settings.onboarded) {
    return (
      <Onboarding
        settings={settings}
        platform={status?.platform ?? 'linux'}
        onDone={() => void window.dayflow.getSettings().then(setSettings)}
      />
    )
  }

  const openSettings = (tab: SettingsTab) => {
    setSettingsTab(tab)
    setView('settings')
  }
  const toasts = [
    status?.analysis.lastError && { key: `analysis:${status.analysis.lastError}`, title: 'Analysis failed', body: status.analysis.lastError, settings: true },
    status?.recorder.state === 'backoff' &&
      status.recorder.lastError && { key: `capture:${status.recorder.lastError}`, title: 'Capture failed', body: status.recorder.lastError, settings: false }
  ].filter((t): t is { key: string; title: string; body: string; settings: boolean } => !!t && !dismissed.includes(t.key))

  return (
    <div className="app">
      <nav className="sidebar" aria-label="Views">
        {TABS.map((t) => {
          const Icon = t.icon
          return (
            <button
              key={t.id}
              className={`nav-item ${view === t.id ? 'active' : ''}`}
              aria-current={view === t.id ? 'page' : undefined}
              onClick={() => setView(t.id)}
            >
              <span className="nav-icon">
                <Icon size={17.6} strokeWidth={1.75} />
              </span>
              {t.label}
            </button>
          )
        })}
      </nav>
      <main className="panel">
        {view === 'timeline' && (
          <Timeline
            status={status}
            onStatusChange={setStatus}
            onOpenSettings={openSettings}
            goalPromptDay={goalPromptDay}
            onGoalPromptShown={() => setGoalPromptDay(null)}
          />
        )}
        {view === 'daily' && <Daily />}
        {view === 'weekly' && <Weekly />}
        {view === 'chat' && <Chat />}
        {view === 'settings' && <SettingsView status={status} tab={settingsTab} onTab={setSettingsTab} />}
      </main>
      {toasts.length > 0 && (
        <div className="toasts" role="status">
          {toasts.map((t) => (
            <div key={t.key} className="toast">
              <div className="toast-body">
                <div>
                  <strong>{t.title}</strong>
                  {t.body}
                </div>
                {t.settings && view !== 'settings' && (
                  <button className="btn-primary" onClick={() => openSettings('providers')}>
                    Open settings
                  </button>
                )}
              </div>
              <button className="bare close" aria-label="Dismiss" onClick={() => setDismissed([...dismissed, t.key])}>
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
