// Desktop notifications with upstream Dayflow's texts
// (Core/Notifications/NotificationService.swift). Clicking one opens the
// window on the matching tab.

import { Notification } from 'electron'
import { failureKind, needsUser } from '../shared/failures'
import type { Tab } from '../shared/types'

export interface Notifier {
  standupReady(day: string): void
  firstCards(): void
  weeklyUnlocked(): void
  /** Only problems the user has to fix, at most once per day and kind, and only while the window is not focused. */
  providerProblem(message: string, waitingMinutes: number): void
}

const waiting = (minutes: number) =>
  minutes < 60 ? `${minutes} min` : minutes < 120 ? '1 hr' : minutes < 1440 ? `${Math.floor(minutes / 60)} hrs` : '1 day'

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
    standupReady: () => show('Your daily recap for yesterday is ready', 'Tap to open it in Daily view.', 'daily'),
    firstCards: () =>
      show('Your first Dayflow cards are ready', 'Take a look at what Dayflow picked up from your last few minutes of work.', 'timeline'),
    weeklyUnlocked: () => show('Weekly view is ready', 'Tap to open your weekly review.', 'weekly'),
    providerProblem(message, waitingMinutes) {
      const kind = failureKind(message)
      if (opts.windowFocused() || !needsUser(kind)) return
      const days = opts.problemDays()
      if (days[kind] === opts.today()) return
      opts.saveProblemDays({ ...days, [kind]: opts.today() })
      show('Dayflow needs a hand', `${message.slice(0, 200)} ${waiting(waitingMinutes)} of recording is waiting.`, 'timeline')
    }
  }
}
