// The first-day guide after onboarding, after upstream Dayflow
// (Views/UI/GettingStarted/GettingStarted.swift, GettingStartedChecklistCard.swift):
// a short welcome tour, then a "Your first day" checklist on the timeline for
// a week. Every item ticks itself from real state. Upstream's "Turn on
// notifications" item is left out: Electron cannot read whether the desktop
// allows the app's notifications.

import type { Feature, FeatureAccess } from './daily'
import { t } from './i18n'

export interface GettingStarted {
  /** Set when onboarding finishes (or from Settings → Other → Show again); installs from before never get the guide. */
  active: boolean
  /** Unix seconds; the checklist retires a week later. */
  startedAt: number
  /** The welcome tour opens on the next window. */
  tourPending: boolean
  openedCard: boolean
  dismissed: boolean
  collapsed: boolean
}

/** The checklist retires itself after the first week even if unfinished (upstream checklistLifetime). */
export const CHECKLIST_LIFETIME_SEC = 7 * 24 * 3600

export const INACTIVE_GUIDE: GettingStarted = { active: false, startedAt: 0, tourPending: false, openedCard: false, dismissed: false, collapsed: false }

export function sanitizeGuide(raw: unknown): GettingStarted {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof GettingStarted, unknown>>
  const flag = (k: Exclude<keyof GettingStarted, 'startedAt'>) => r[k] === true
  const startedAt = Number(r.startedAt)
  return {
    active: flag('active'),
    startedAt: Number.isFinite(startedAt) && startedAt > 0 ? startedAt : 0,
    tourPending: flag('tourPending'),
    openedCard: flag('openedCard'),
    dismissed: flag('dismissed'),
    collapsed: flag('collapsed')
  }
}

/** Called when onboarding completes (upstream GettingStarted.begin). */
export const beginGuide = (now: number): GettingStarted => ({ active: true, startedAt: now, tourPending: true, openedCard: false, dismissed: false, collapsed: false })

/** Settings → Show again: the tour once more and the checklist back for a fresh week (upstream replay). */
export const replayGuide = (guide: GettingStarted, now: number): GettingStarted => ({ ...guide, active: true, startedAt: now, tourPending: true, dismissed: false, collapsed: false })

export const checklistVisible = (guide: GettingStarted, now: number): boolean =>
  guide.active && !guide.dismissed && guide.startedAt > 0 && now - guide.startedAt <= CHECKLIST_LIFETIME_SEC

/** Ticks "Open a card"; returns the same object when nothing changes. */
export const markCardOpened = (guide: GettingStarted): GettingStarted => (guide.active && !guide.openedCard ? { ...guide, openedCard: true } : guide)

export type ChecklistStatus = 'todo' | 'working' | 'progress' | 'done'

export interface ChecklistItem {
  id: 'firstCards' | 'openCard' | Feature | 'allDone'
  status: ChecklistStatus
  title: string
  subtitle: string
  /** 0 to 1 for the progress ring. */
  progress: number
  /** The tab its "Open" button switches to, once unlocked. */
  open: 'daily' | 'chat' | null
}

export interface ChecklistInput {
  /** Cards the model wrote (not just failed batches) are on the timeline. */
  hasCards: boolean
  recording: boolean
  openedCard: boolean
  access: Record<Feature, FeatureAccess>
}

const steps = (input: ChecklistInput) => [input.hasCards, input.openedCard, input.access.daily.unlocked, input.access.chat.unlocked]

export function checklistCount(input: ChecklistInput): { done: number; total: number } {
  const all = steps(input)
  return { done: all.filter(Boolean).length, total: all.length }
}

/** The checklist's rows in upstream's order, or one "all set" row when everything is done. */
export function checklistItems(input: ChecklistInput): ChecklistItem[] {
  const { done, total } = checklistCount(input)
  if (done === total) {
    return [{ id: 'allDone', status: 'done', title: t('gettingStarted.checklist.allDone'), subtitle: t('gettingStarted.checklist.allDoneSub'), progress: 1, open: null }]
  }
  const unlock = (feature: 'daily' | 'chat', title: string): ChecklistItem => {
    const access = input.access[feature]
    return access.unlocked
      ? { id: feature, status: 'done', title, subtitle: t('gettingStarted.checklist.readyToOpen'), progress: 1, open: feature }
      : { id: feature, status: 'progress', title, subtitle: t('gettingStarted.checklist.recorded', { progress: access.label }), progress: access.progress, open: null }
  }
  return [
    {
      id: 'firstCards',
      status: input.hasCards ? 'done' : input.recording ? 'working' : 'todo',
      title: t('gettingStarted.checklist.firstCards'),
      subtitle: input.hasCards
        ? t('gettingStarted.checklist.firstCardsDone')
        : input.recording
          ? t('gettingStarted.checklist.firstCardsWorking')
          : t('gettingStarted.checklist.firstCardsPaused'),
      progress: input.hasCards ? 1 : 0,
      open: null
    },
    {
      id: 'openCard',
      status: input.openedCard ? 'done' : 'todo',
      title: t('gettingStarted.checklist.openCard'),
      subtitle: t('gettingStarted.checklist.openCardSub'),
      progress: input.openedCard ? 1 : 0,
      open: null
    },
    unlock('daily', t('gettingStarted.checklist.unlockDaily')),
    unlock('chat', t('gettingStarted.checklist.unlockChat'))
  ]
}
