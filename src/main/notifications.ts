// Desktop notifications with upstream Dayflow's texts
// (Core/Notifications/NotificationService.swift). Clicking one opens the
// window on the matching tab.

import { Notification } from 'electron'

export type Tab = 'timeline' | 'daily' | 'weekly' | 'chat' | 'settings'

export interface Notifier {
  standupReady(day: string): void
  firstCards(): void
  weeklyUnlocked(): void
  /** At most once per day and kind of problem, and only while the window is not focused. */
  providerProblem(message: string, waitingMinutes: number): void
}

const waiting = (minutes: number) =>
  minutes < 60 ? `${minutes} min` : minutes < 120 ? '1 hr' : minutes < 1440 ? `${Math.floor(minutes / 60)} hrs` : '1 day'

export function createNotifier(opts: {
  open: (tab: Tab) => void
  windowFocused: () => boolean
  today: () => string
}): Notifier {
  const shownProblems = new Map<string, string>()
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
      if (opts.windowFocused()) return
      // The first words name the kind of problem (provider and error class).
      const kind = message.split(':').slice(0, 2).join(':').slice(0, 80)
      if (shownProblems.get(kind) === opts.today()) return
      shownProblems.set(kind, opts.today())
      show('Dayflow needs a hand', `${message.slice(0, 200)} ${waiting(waitingMinutes)} of recording is waiting.`, 'timeline')
    }
  }
}
