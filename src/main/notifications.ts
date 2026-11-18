// Desktop notifications with upstream Dayflow's texts
// (Core/Notifications/NotificationService.swift). Clicking one opens the
// window on the matching tab.

import { Notification } from 'electron'
import { type FailureKind, needsUser } from '../shared/failures'
import { t } from '../shared/i18n'
import { waitingLabel } from '../shared/provider-problem'
import type { Tab } from '../shared/types'

export interface Notifier {
  standupReady(day: string): void
  firstCards(): void
  weeklyUnlocked(): void
  /**
   * Only problems the user has to fix, at most once per day and kind, and only
   * while the window is not focused (upstream notifyProviderProblem). Clicking
   * it opens the window with the problem's card.
   */
  providerProblem(problem: { kind: FailureKind; title: string; body: string }, waitingMinutes: number): void
}

export function createNotifier(opts: {
  open: (tab: Tab) => void
  windowFocused: () => boolean
  today: () => string
  /** The day each kind of problem was last reported; kept across restarts. */
  problemDays: () => Record<string, string>
  saveProblemDays: (days: Record<string, string>) => void
}): Notifier {
  const show = (title: string, body: string, tab: Tab) => {
    if (!Notification.isSupported()) return
    const n = new Notification({ title, body })
    n.on('click', () => opts.open(tab))
    n.show()
  }
  return {
    standupReady: () => show(t('notifications.standupReady.title'), t('notifications.standupReady.body'), 'daily'),
    firstCards: () => show(t('notifications.firstCards.title'), t('notifications.firstCards.body'), 'timeline'),
    weeklyUnlocked: () => show(t('notifications.weeklyUnlocked.title'), t('notifications.weeklyUnlocked.body'), 'weekly'),
    providerProblem({ kind, title, body }, waitingMinutes) {
      if (opts.windowFocused() || !needsUser(kind)) return
      const days = opts.problemDays()
      if (days[kind] === opts.today()) return
      opts.saveProblemDays({ ...days, [kind]: opts.today() })
      const time = waitingLabel(waitingMinutes)
      show(title, `${body.slice(0, 200)}${time ? ` ${t('notifications.problem.waiting', { time })}` : ''}`, 'timeline')
    }
  }
}
