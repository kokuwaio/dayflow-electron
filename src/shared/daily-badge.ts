// The Daily "ready" badge, after upstream Dayflow
// (Core/Notifications/NotificationBadgeManager.swift, MainView/SidebarView.swift):
// a dot on the sidebar's Daily icon (and a count on the macOS Dock or the
// Unity launcher) from the moment the scheduler writes a recap until the user
// opens Daily. The state is the recap's day, or '' when there is nothing new.

import type { Tab } from './types'

/** What the window shows: its tab, and whether it has focus (a hidden window has none). */
export interface WindowView {
  tab: Tab | null
  focused: boolean
}

const seesDaily = (view: WindowView) => view.focused && view.tab === 'daily'

/** After the scheduler wrote the recap for `day`. Manual regenerations happen on Daily and set no badge. */
export const badgeOnRecap = (_unseen: string, day: string, view: WindowView): string => (seesDaily(view) ? '' : day)

/** After the window changed tab or focus: Daily on screen clears it (upstream handleTabSelectionChange). */
export const badgeOnView = (unseen: string, view: WindowView): string => (seesDaily(view) ? '' : unseen)

export const badgeCount = (unseen: string): number => (unseen ? 1 : 0)
