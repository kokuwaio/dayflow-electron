// The first-day guide, after upstream Dayflow (Views/UI/GettingStarted/*): the
// four-page welcome tour after onboarding, the "Your first day" checklist on
// the timeline, and its rows in Settings → Other. Upstream's illustrations are
// redrawn with Lucide icons and CSS; the rules are in src/shared/getting-started.ts.

import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { AppWindow, BatteryMedium, CalendarRange, ChartPie, Check, ChevronDown, ChevronUp, ListTree, MessagesSquare, Pause, Sun, Wifi, X } from 'lucide-react'
import type { Feature, FeatureAccess } from '@shared/daily'
import { type ChecklistItem, type GettingStarted, checklistCount, checklistItems, checklistVisible } from '@shared/getting-started'
import { UNLOCK_HOURS } from '@shared/daily'
import type { RecorderState, Tab } from '@shared/types'
import { Row } from './SettingsLayout'
import './getting-started.css'

const PAGES = ['recording', 'cards', 'unlocks', 'close'] as const
type Page = (typeof PAGES)[number]

/** The welcome tour over the whole window (upstream GettingStartedTourOverlay). */
export function GettingStartedTour({ platform, onFinish }: { platform: string; onFinish: () => void }) {
  const { t } = useTranslation()
  const [index, setIndex] = useState(0)
  const page: Page = PAGES[index]!
  const mac = platform === 'darwin'
  const text: Record<Page, { title: string; body: string }> = {
    recording: { title: t('gettingStarted.tour.recordingTitle'), body: mac ? t('gettingStarted.tour.recordingBodyMac') : t('gettingStarted.tour.recordingBody') },
    cards: { title: t('gettingStarted.tour.cardsTitle'), body: t('gettingStarted.tour.cardsBody') },
    unlocks: { title: t('gettingStarted.tour.unlocksTitle'), body: t('gettingStarted.tour.unlocksBody') },
    close: { title: t('gettingStarted.tour.closeTitle'), body: mac ? t('gettingStarted.tour.closeBodyMac') : t('gettingStarted.tour.closeBody') }
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onFinish()
      else if (e.key === 'ArrowRight' && index < PAGES.length - 1) setIndex(index + 1)
      else if (e.key === 'ArrowLeft' && index > 0) setIndex(index - 1)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, onFinish])

  return createPortal(
    <div className="gs-backdrop">
      <div className="gs-tour" role="dialog" aria-modal="true" aria-label={t('gettingStarted.tour.label')}>
        <div className="gs-illustration" key={page}>
          {page === 'recording' && <RecordingIllustration />}
          {page === 'cards' && <CardsIllustration />}
          {page === 'unlocks' && <UnlocksIllustration />}
          {page === 'close' && <NotificationIllustration />}
        </div>
        <div className="gs-text" key={`${page}-text`}>
          <span className="gs-step">{t('gettingStarted.of', { current: index + 1, total: PAGES.length })}</span>
          <h2>{text[page].title}</h2>
          <p>{text[page].body}</p>
        </div>
        <footer className="gs-footer">
          <span className="gs-dots" aria-hidden="true">
            {PAGES.map((p, i) => (
              <i key={p} className={i === index ? 'on' : ''} />
            ))}
          </span>
          <span className="push-right" />
          {page === 'close' ? (
            <button className="btn-primary gs-primary" autoFocus onClick={onFinish}>
              {t('gettingStarted.tour.gotIt')}
            </button>
          ) : (
            <>
              <button className="bare gs-skip" onClick={onFinish}>
                {t('gettingStarted.tour.skip')}
              </button>
              {index > 0 && (
                <button className="gs-secondary" onClick={() => setIndex(index - 1)}>
                  {t('common.back')}
                </button>
              )}
              <button className="btn-primary gs-primary" autoFocus onClick={() => setIndex(index + 1)}>
                {t('common.next')}
              </button>
            </>
          )}
        </footer>
      </div>
    </div>,
    document.body
  )
}

/** A desktop panel with the app's tray menu open, so people know where to find it later. */
function RecordingIllustration() {
  const { t } = useTranslation()
  return (
    <div className="gs-rec">
      <div className="gs-panel-bar">
        <span className="gs-app-tile">
          <Sun size={11} strokeWidth={2.5} />
        </span>
        <Wifi size={12} />
        <BatteryMedium size={14} />
        <span>9:41</span>
      </div>
      <div className="gs-menu">
        <div className="gs-menu-rec">
          <i className="gs-pulse" />
          {t('gettingStarted.tour.recording')}
        </div>
        <div className="gs-menu-row">
          <Pause size={11} />
          {t('tray.pause')}
        </div>
        <div className="gs-menu-row">
          <AppWindow size={11} />
          {t('tray.open')}
        </div>
      </div>
    </div>
  )
}

/** Sample timeline cards dropping in one after another. */
function CardsIllustration() {
  const { t } = useTranslation()
  const samples = [
    { time: '9:00', title: t('gettingStarted.tour.reviewing'), detail: 'GitHub · Slack', color: '#5B8DEF' },
    { time: '9:15', title: t('gettingStarted.tour.planning'), detail: 'Notion · Calendar', color: '#43B581' },
    { time: '9:30', title: t('gettingStarted.tour.youtube'), detail: t('gettingStarted.tour.distraction'), color: '#F28C38' }
  ]
  return (
    <div className="gs-cards">
      {samples.map((s, i) => (
        <div key={s.time} className="gs-card-row" style={{ animationDelay: `${250 + i * 450}ms` }}>
          <span className="gs-time">{s.time}</span>
          <div className="gs-card">
            <i style={{ background: s.color }} />
            <div>
              <b>{s.title}</b>
              <span>{s.detail}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

/** The unlock ladder: what becomes available after how much recorded time. */
function UnlocksIllustration() {
  const { t } = useTranslation()
  const steps = [
    { badge: t('gettingStarted.tour.firstCardsTime'), title: t('gettingStarted.checklist.firstCards'), icon: ListTree },
    { badge: t('gettingStarted.tour.hours', { count: UNLOCK_HOURS.daily }), title: t('gettingStarted.tour.dailyMilestone'), icon: ChartPie },
    { badge: t('gettingStarted.tour.hours', { count: UNLOCK_HOURS.chat }), title: t('gettingStarted.tour.chatMilestone'), icon: MessagesSquare },
    { badge: t('gettingStarted.tour.hours', { count: UNLOCK_HOURS.weekly }), title: t('gettingStarted.tour.weeklyMilestone'), icon: CalendarRange }
  ]
  return (
    <ol className="gs-ladder">
      {steps.map((s, i) => {
        const Icon = s.icon
        return (
          <li key={i} className={i === 0 ? 'first' : ''}>
            <span className="gs-badge">{s.badge}</span>
            <span className="gs-node">
              <Icon size={12} strokeWidth={2.25} />
            </span>
            <span className="gs-title">{s.title}</span>
          </li>
        )
      })}
    </ol>
  )
}

/** The notification people get when their first cards are ready. */
function NotificationIllustration() {
  const { t } = useTranslation()
  return (
    <div className="gs-notify">
      <div className="gs-banner">
        <span className="gs-app-tile big">
          <Sun size={16} strokeWidth={2.5} />
        </span>
        <div>
          <div className="gs-banner-head">
            <b>Dayflow Electron</b>
            <span>{t('gettingStarted.tour.now')}</span>
          </div>
          <b>{t('notifications.firstCards.title')}</b>
          <p>{t('notifications.firstCards.body')}</p>
        </div>
      </div>
    </div>
  )
}

/**
 * "Your first day" on the timeline, above the day summary (upstream
 * GettingStartedChecklistCard): shown for a week after onboarding until
 * dismissed, refreshed when cards change and when the window gets focus.
 */
export function GettingStartedChecklist({ recorder, onOpenTab }: { recorder: RecorderState | null; onOpenTab: (tab: Tab) => void }) {
  const { t } = useTranslation()
  const [state, setState] = useState<{ guide: GettingStarted; hasCards: boolean; access: Record<Feature, FeatureAccess> } | null>(null)
  const load = useCallback(() => {
    void Promise.all([window.dayflow.getGettingStarted(), window.dayflow.getAccess()]).then(([g, access]) => setState({ ...g, access }))
  }, [])
  useEffect(() => {
    load()
    const offCards = window.dayflow.onCardsChanged(load)
    const offGuide = window.dayflow.onGettingStarted(load)
    window.addEventListener('focus', load)
    return () => {
      offCards()
      offGuide()
      window.removeEventListener('focus', load)
    }
  }, [load])

  if (!state || !checklistVisible(state.guide, Date.now() / 1000)) return null
  const input = { hasCards: state.hasCards, recording: recorder === 'recording', openedCard: state.guide.openedCard, access: state.access }
  const { done, total } = checklistCount(input)
  const collapsed = state.guide.collapsed
  const update = (patch: Partial<Pick<GettingStarted, 'collapsed' | 'dismissed'>>) => {
    setState({ ...state, guide: { ...state.guide, ...patch } })
    void window.dayflow.updateGettingStarted(patch)
  }

  return (
    <section className="gs-checklist" aria-label={t('gettingStarted.checklist.title')}>
      <div className="gs-check-head">
        <h3>{t('gettingStarted.checklist.title')}</h3>
        <span className="gs-count">{t('gettingStarted.of', { current: done, total })}</span>
        <button
          className="bare gs-icon"
          aria-label={collapsed ? t('gettingStarted.checklist.expand') : t('gettingStarted.checklist.collapse')}
          aria-expanded={!collapsed}
          onClick={() => update({ collapsed: !collapsed })}
        >
          {collapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
        </button>
        <button className="bare gs-icon" aria-label={t('common.dismiss')} onClick={() => update({ dismissed: true })}>
          <X size={13} />
        </button>
      </div>
      <div className="gs-bar" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
        <i style={{ width: `${(done / total) * 100}%` }} />
      </div>
      {!collapsed && (
        <ul className="gs-rows">
          {checklistItems(input).map((item) => (
            <ChecklistRow
              key={item.id}
              item={item}
              action={
                item.id === 'allDone' ? (
                  <button className="gs-row-btn" onClick={() => update({ dismissed: true })}>
                    {t('gettingStarted.checklist.done')}
                  </button>
                ) : item.open ? (
                  <button className="gs-row-btn" onClick={() => onOpenTab(item.open!)}>
                    {t('common.open')}
                  </button>
                ) : null
              }
            />
          ))}
        </ul>
      )}
    </section>
  )
}

function ChecklistRow({ item, action }: { item: ChecklistItem; action: React.ReactNode }) {
  return (
    <li className={`gs-row ${item.status}`}>
      <StatusIcon item={item} />
      <div className="gs-row-text">
        <b>{item.title}</b>
        <span>{item.subtitle}</span>
      </div>
      {action}
    </li>
  )
}

function StatusIcon({ item }: { item: ChecklistItem }) {
  if (item.status === 'done')
    return (
      <span className="gs-status done">
        <Check size={10} strokeWidth={3.5} />
      </span>
    )
  if (item.status === 'working') return <span className="gs-status spinner dark" />
  if (item.status === 'todo') return <span className="gs-status todo" />
  // A ring that fills with the recorded share, at least a sliver so it reads as started.
  const r = 7
  const length = 2 * Math.PI * r
  return (
    <svg className="gs-status ring" viewBox="0 0 18 18" aria-hidden="true">
      <circle cx="9" cy="9" r={r} className="track" />
      <circle cx="9" cy="9" r={r} className="value" strokeDasharray={`${Math.max(0.02, item.progress) * length} ${length}`} />
    </svg>
  )
}

/** Settings → Other: "Show again" for the guide, and upstream's "Reset Onboarding". */
export function GettingStartedSettings() {
  const { t } = useTranslation()
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const timer = setTimeout(() => setArmed(false), 3000)
    return () => clearTimeout(timer)
  }, [armed])
  return (
    <>
      <Row label={t('gettingStarted.settings.guide')} sub={t('gettingStarted.settings.guideSub')}>
        <button onClick={() => void window.dayflow.replayGettingStarted()}>{t('gettingStarted.settings.showAgain')}</button>
      </Row>
      <Row label={t('gettingStarted.settings.reset')} sub={t('gettingStarted.settings.resetSub')}>
        {armed ? (
          <button className="confirm-danger" onClick={() => void window.dayflow.resetOnboarding()}>
            {t('common.confirm')}
          </button>
        ) : (
          <button onClick={() => setArmed(true)}>{t('common.reset')}</button>
        )}
      </Row>
    </>
  )
}
