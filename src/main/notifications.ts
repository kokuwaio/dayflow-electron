// Desktop notifications with upstream Dayflow's texts
// (Core/Notifications/NotificationService.swift). Clicking one opens the
// window on the matching tab.

import { Notification } from 'electron'
import { failureKind, needsUser } from '../shared/failures'
import { t } from '../shared/i18n'
import type { Tab } from '../shared/types'

export interface Notifier {
  standupReady(day: string): void
  firstCards(): void
  weeklyUnlocked(): void
  /** Only problems the user has to fix, at most once per day and kind, and only while the window is not focused. */
  providerProblem(message: string, waitingMinutes: number): void
}

const waiting = (minutes: number) =>
  minutes < 60
    ? t('notifications.waitingMinutes', { count: minutes })
    : minutes < 1440
      ? t('notifications.waitingHours', { count: Math.floor(minutes / 60) })
      : t('notifications.waitingDay')

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
    providerProblem(message, waitingMinutes) {
      const kind = failureKind(message)
      if (opts.windowFocused() || !needsUser(kind)) return
      const days = opts.problemDays()
      if (days[kind] === opts.today()) return
      opts.saveProblemDays({ ...days, [kind]: opts.today() })
      show(t('notifications.problem.title'), `${message.slice(0, 200)} ${t('notifications.problem.waiting', { time: waiting(waitingMinutes) })}`, 'timeline')
    }
  }
}
