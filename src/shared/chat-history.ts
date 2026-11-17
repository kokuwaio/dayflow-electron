// The chat history panel's grouping, after upstream Dayflow
// (Views/UI/ChatHistoryPanel.swift): today, yesterday, this week, earlier.

import { dayKey, shiftDay } from './day'
import type { ChatConversation } from './types'

const GROUPS = ['TODAY', 'YESTERDAY', 'THIS WEEK', 'EARLIER'] as const

/** Non-empty groups in upstream's order, conversations kept in their given order (newest first). */
export function historyGroups(conversations: ChatConversation[], today: string) {
  const groupOf = (c: ChatConversation): (typeof GROUPS)[number] => {
    const day = dayKey(c.updatedAt)
    if (day === today) return 'TODAY'
    if (day === shiftDay(today, -1)) return 'YESTERDAY'
    return day > shiftDay(today, -7) ? 'THIS WEEK' : 'EARLIER'
  }
  return GROUPS.map((name) => ({ name, items: conversations.filter((c) => groupOf(c) === name) })).filter((g) => g.items.length > 0)
}
