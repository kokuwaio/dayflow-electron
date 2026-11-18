import { describe, expect, it } from 'vitest'
import { historyGroups } from './chat-history'
import type { ChatConversation } from './types'

const at = (d: number, h: number) => new Date(2026, 10, d, h).getTime() / 1000
const chat = (id: string, updatedAt: number): ChatConversation => ({ id, title: id, provider: 'anthropic', createdAt: updatedAt, updatedAt })

describe('historyGroups (upstream ChatHistoryPanel)', () => {
  it('groups conversations into today, yesterday, this week and earlier, by the 4 AM day', () => {
    const groups = historyGroups(
      [chat('now', at(17, 10)), chat('late', at(17, 2)), chat('mon', at(16, 9)), chat('fri', at(13, 9)), chat('old', at(9, 9))],
      '2026-11-17'
    )
    expect(groups.map((g) => [g.name, g.items.map((c) => c.id)])).toEqual([
      ['TODAY', ['now']],
      ['YESTERDAY', ['late', 'mon']],
      ['THIS WEEK', ['fri']],
      ['EARLIER', ['old']]
    ])
    expect(historyGroups([], '2026-11-17')).toEqual([])
  })
})
