import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CalendarRange, ChartPie, ListTree, type LucideIcon, MessagesSquare, Settings as SettingsIcon, X } from 'lucide-react'
import type { AppStatus, Settings, Tab } from '@shared/types'
import { Chat } from './Chat'
import { Daily } from './Daily'
import { GettingStartedTour } from './GettingStarted'
import { useIdleReset } from './idle-reset'
import { Onboarding } from './Onboarding'
import { type SettingsTab, SettingsView } from './Settings'
import { Timeline } from './Timeline'
import { dueGoalPrompt } from './goal-prompt'
import { applyUiStyle } from './ui-style'
import { Weekly } from './Weekly'

/** Upstream's sidebar (MainView/SidebarView.swift), with Lucide icons in place of its artwork. */
const TABS = [
  { id: 'timeline', icon: ListTree },
  { id: 'daily', icon: ChartPie },
  { id: 'weekly', icon: CalendarRange },
  { id: 'chat', icon: MessagesSquare },
  { id: 'settings', icon: SettingsIcon }
] as const satisfies ReadonlyArray<{ id: Tab; icon: LucideIcon }>
type View = (typeof TABS)[number]['id']

export function App() {
  // Re-renders the whole window when the app language changes.
  const { t } = useTranslation()
  const [view, setView] = useState<View>('timeline')
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('providers')
  const [status, setStatus] = useState<AppStatus | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [dismissed, setDismissed] = useState<string[]>([])
  const [goalPromptDay, setGoalPromptDay] = useState<string | null>(null)
  const [dailyBadge, setDailyBadge] = useState(false)
  /** Bumped to send the timeline back to today and now (after 15 minutes away). */
  const [resetTick, setResetTick] = useState(0)
  const idleResetPending = useRef(false)

  useEffect(() => {
    void window.dayflow.getStatus().then(setStatus)
    void window.dayflow.getSettings().then((s) => {
      applyUiStyle(s.uiStyle)
      setSettings(s)
    })
    const offNavigate = window.dayflow.onNavigate((tab) => TABS.some((t) => t.id === tab) && setView(tab as View))
    const offStatus = window.dayflow.onStatus(setStatus)
    void window.dayflow.getDailyBadge().then(setDailyBadge)
    const offBadge = window.dayflow.onDailyBadge(setDailyBadge)
    const offGuide = window.dayflow.onGettingStarted((gettingStarted) => setSettings((s) => s && { ...s, gettingStarted }))
    return () => {
      offNavigate()
      offStatus()
      offBadge()
      offGuide()
    }
  }, [])

  // The main process clears the Daily badge once Daily is on screen.
  useEffect(() => window.dayflow.reportView(view), [view])

  // Back to today after 15 minutes away (upstream InactivityMonitor): not while Settings is open; then on leaving it.
  useIdleReset(() => {
    if (view === 'settings') idleResetPending.current = true
    else setResetTick((n) => n + 1)
  })
  useEffect(() => {
    if (view === 'settings' || !idleResetPending.current) return
    idleResetPending.current = false
    setResetTick((n) => n + 1)
  }, [view])

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
    status?.analysis.lastError && { key: `analysis:${status.analysis.lastError}`, title: t('app.analysisFailed'), body: status.analysis.lastError, settings: true },
    status?.recorder.state === 'backoff' &&
      status.recorder.lastError && { key: `capture:${status.recorder.lastError}`, title: t('app.captureFailed'), body: status.recorder.lastError, settings: false }
  ].filter((x): x is { key: string; title: string; body: string; settings: boolean } => !!x && !dismissed.includes(x.key))

  const finishTour = () => {
    setSettings((s) => s && { ...s, gettingStarted: { ...s.gettingStarted, tourPending: false } })
    void window.dayflow.updateGettingStarted({ tourPending: false })
  }

  return (
    <div className="app">
      {settings?.gettingStarted.tourPending && <GettingStartedTour platform={status?.platform ?? 'linux'} onFinish={finishTour} />}
      <nav className="sidebar" aria-label={t('app.views')}>
        {TABS.map((tab) => {
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              className={`nav-item ${view === tab.id ? 'active' : ''}`}
              aria-current={view === tab.id ? 'page' : undefined}
              onClick={() => setView(tab.id)}
            >
              <span className="nav-icon">
                <Icon size={17.6} strokeWidth={1.75} />
                {tab.id === 'daily' && dailyBadge && view !== 'daily' && <span className="badge-dot" role="status" aria-label={t('daily.badge')} />}
              </span>
              {t(`app.tabs.${tab.id}`)}
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
            resetTick={resetTick}
            onOpenTab={(tab) => TABS.some((t) => t.id === tab) && setView(tab as View)}
          />
        )}
        {view === 'daily' && <Daily />}
        {view === 'weekly' && <Weekly />}
        {view === 'chat' && <Chat />}
        {view === 'settings' && <SettingsView status={status} tab={settingsTab} onTab={setSettingsTab} />}
      </main>
      {toasts.length > 0 && (
        <div className="toasts" role="status">
          {toasts.map((toast) => (
            <div key={toast.key} className="toast">
              <div className="toast-body">
                <div>
                  <strong>{toast.title}</strong>
                  {toast.body}
                </div>
                {toast.settings && view !== 'settings' && (
                  <button className="btn-primary" onClick={() => openSettings('providers')}>
                    {t('app.openSettings')}
                  </button>
                )}
              </div>
              <button className="bare close" aria-label={t('common.dismiss')} onClick={() => setDismissed([...dismissed, toast.key])}>
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
