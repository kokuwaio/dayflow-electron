import { describe, expect, it } from 'vitest'
import type { ChatTurnRequest, ChatTurnResult, Provider } from '../providers/types'
import { MAX_TOOL_ROUNDS, runChatLoop } from './loop'
import type { ChatData } from './tools'

const noData: ChatData = { cardsBetween: () => [], observationsBetween: () => [] }

/** A provider that answers each turn from a script and records what it was sent. */
function scripted(turns: Array<Partial<ChatTurnResult>>) {
  const seen: ChatTurnRequest[] = []
  const provider: Provider = {
    kind: 'anthropic',
    model: 'm',
    local: false,
    generate: async () => ({ text: '', model: 'm' }),
    chatTurn: async (request) => {
      seen.push({ ...request, messages: [...request.messages] })
      const turn = turns.shift() ?? { text: 'again' , toolCalls: [{ id: 'x', name: 'fetchTimeline', args: { date: '2026-11-17' } }] }
      if (turn.text) request.onText?.(turn.text)
      return { text: '', toolCalls: [], native: null, model: 'm', ...turn }
    }
  }
  return { provider, seen }
}

describe('chat tool loop (upstream runDashboardChatLoop)', () => {
  it('runs the requested tools, feeds their results back and keeps the text of every round', async () => {
    const { provider, seen } = scripted([
      { text: 'Let me check.', toolCalls: [{ id: 'a', name: 'fetchTimeline', args: { date: '2026-11-17' } }] },
      { text: 'You had no cards today.' }
    ])
    const events: string[] = []
    const answer = await runChatLoop({
      provider,
      system: 'S',
      history: [{ role: 'user', text: 'Today?' }],
      data: noData,
      onEvent: (e) => {
        if (e.type === 'text') events.push(`text:${e.delta}`)
        else if (e.type === 'tool-start') events.push(`start:${e.command}`)
        else if (e.type === 'tool-end') events.push(`end:${e.summary}:${e.failed}`)
      }
    })
    expect(answer).toEqual({ text: 'Let me check. You had no cards today.', model: 'm' })
    expect(events).toEqual([
      'text:Let me check.',
      'start:fetchTimeline {"date":"2026-11-17"}',
      'end:Fetched 0 timeline cards for Tue, Nov 17.:false',
      'text: You had no cards today.'
    ])
    expect(seen[1]!.messages.at(-1)).toMatchObject({ role: 'tool', results: [{ call: { id: 'a' }, result: { itemCount: 0 } }] })
  })

  it('reports a failed tool and stops after too many tool rounds', async () => {
    const { provider } = scripted([{ toolCalls: [{ id: 'b', name: 'fetchTimeline', args: {} }] }])
    const failures: boolean[] = []
    await expect(
      runChatLoop({ provider, system: 'S', history: [{ role: 'user', text: 'Q' }], data: noData, onEvent: (e) => e.type === 'tool-end' && failures.push(e.failed) })
    ).rejects.toThrow('The assistant exceeded the maximum tool-call rounds. Please try a narrower query.')
    expect(failures[0]).toBe(true)
    expect(failures).toHaveLength(MAX_TOOL_ROUNDS)
  })
})
