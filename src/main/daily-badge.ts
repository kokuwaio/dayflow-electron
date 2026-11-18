// Keeps the Daily "ready" badge (src/shared/daily-badge.ts) in settings, the
// window's sidebar and, where Electron supports it, the app icon: the macOS
// Dock and the Unity launcher on Linux (app.setBadgeCount does nothing elsewhere).

import { type WindowView, badgeCount, badgeOnRecap, badgeOnView } from '../shared/daily-badge'

export interface DailyBadge {
  /** The scheduler wrote the recap for `day`. */
  recapReady(day: string): void
  /** The window's tab or focus changed. */
  view(change: Partial<WindowView>): void
  pending(): boolean
}

export function createDailyBadge(opts: {
  unseen: () => string
  save: (unseen: string) => void
  /** Tells the window whether to show the dot. */
  send: (pending: boolean) => void
  setCount: (count: number) => void
}): DailyBadge {
  let view: WindowView = { tab: null, focused: false }
  const apply = (next: string) => {
    if (next !== opts.unseen()) {
      opts.save(next)
      opts.send(next !== '')
    }
    opts.setCount(badgeCount(next))
  }
  opts.setCount(badgeCount(opts.unseen()))
  return {
    recapReady: (day) => apply(badgeOnRecap(day, view)),
    view(change) {
      view = { ...view, ...change }
      apply(badgeOnView(opts.unseen(), view))
    },
    pending: () => opts.unseen() !== ''
  }
}
