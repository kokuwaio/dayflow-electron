import { describe, expect, it } from 'vitest'
import { anthropicProvider } from './anthropic'
import { fakeFetch } from './fake-fetch'
import { geminiProvider } from './gemini'
import { openaiProvider } from './openai'
import type { ChatMessage, ChatTurnRequest, Provider, ToolSpec } from './types'

const tools: ToolSpec[] = [
  { name: 'fetchTimeline', description: 'Fetch cards.', parameters: { type: 'object', properties: { date: { type: 'string', description: 'Day.' } } } }
]

/** Runs a tool round and the answer after it, the way the chat loop does. */
async function twoTurns(provider: Provider) {
  const streamed: string[] = []
  const request = (messages: ChatMessage[]): ChatTurnRequest => ({ system: 'Be brief.', messages, tools, onText: (d) => streamed.push(d) })
  const history: ChatMessage[] = [{ role: 'user', text: 'What did I do today?' }]
  const first = await provider.chatTurn!(request(history))
  history.push({ role: 'assistant', text: first.text, toolCalls: first.toolCalls, native: first.native })
  history.push({ role: 'tool', results: first.toolCalls.map((call) => ({ call, result: { summary: 'Fetched 1 timeline card.' } })) })
  const second = await provider.chatTurn!(request(history))
  return { first, second, streamed }
}

describe('chat turns with tools', () => {
  it('Anthropic: streams text, returns tool_use calls and sends tool_result blocks back', async () => {
    const block = (index: number, content_block: object) => ({ event: 'content_block_start', data: { type: 'content_block_start', index, content_block } })
    const delta = (index: number, d: object) => ({ event: 'content_block_delta', data: { type: 'content_block_delta', index, delta: d } })
    const stop = (index: number) => ({ event: 'content_block_stop', data: { type: 'content_block_stop', index } })
    const message = (stopReason: string, events: object[]) => ({
      sse: [
        { event: 'message_start', data: { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 0 } } } },
        ...events,
        { event: 'message_delta', data: { type: 'message_delta', delta: { stop_reason: stopReason }, usage: { output_tokens: 5 } } },
        { event: 'message_stop', data: { type: 'message_stop' } }
      ]
    })
    const { fetch, requests } = fakeFetch(
      message('tool_use', [
        block(0, { type: 'text', text: '' }), delta(0, { type: 'text_delta', text: 'Let me look.' }), stop(0),
        block(1, { type: 'tool_use', id: 'tu_1', name: 'fetchTimeline', input: {} }), delta(1, { type: 'input_json_delta', partial_json: '{"date":"2026-11-17"}' }), stop(1)
      ]),
      message('end_turn', [block(0, { type: 'text', text: '' }), delta(0, { type: 'text_delta', text: 'You coded.' }), stop(0)])
    )
    const { first, second, streamed } = await twoTurns(anthropicProvider('claude-opus-5-5', 'key', { fetch }))

    expect(first.toolCalls).toEqual([{ id: 'tu_1', name: 'fetchTimeline', args: { date: '2026-11-17' } }])
    expect(second).toMatchObject({ text: 'You coded.', toolCalls: [] })
    expect(streamed).toEqual(['Let me look.', 'You coded.'])
    expect(requests[0]!.body).toMatchObject({ stream: true, system: 'Be brief.', thinking: { type: 'adaptive' }, tools: [{ name: 'fetchTimeline', input_schema: tools[0]!.parameters }] })
    expect(requests[1]!.body.messages.slice(1)).toEqual([
      { role: 'assistant', content: [{ type: 'text', text: 'Let me look.' }, { type: 'tool_use', id: 'tu_1', name: 'fetchTimeline', input: { date: '2026-11-17' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: '{"summary":"Fetched 1 timeline card."}' }] }
    ])
  })

  it('Gemini: streams parts, returns functionCalls and sends functionResponses with the thought signature', async () => {
    const { fetch, requests } = fakeFetch(
      { sse: [{ candidates: [{ content: { role: 'model', parts: [{ text: 'Checking.' }, { functionCall: { name: 'fetchTimeline', args: { date: '2026-11-17' } }, thoughtSignature: 'sig' }] } }] }] },
      { sse: [{ candidates: [{ content: { role: 'model', parts: [{ text: 'You ' }] } }] }, { candidates: [{ content: { role: 'model', parts: [{ text: 'coded.' }] } }], modelVersion: 'gemini-x' }] }
    )
    const { first, second, streamed } = await twoTurns(geminiProvider('gemini-x', 'key', { fetch }))

    expect(first.toolCalls).toMatchObject([{ name: 'fetchTimeline', args: { date: '2026-11-17' } }])
    expect(second.text).toBe('You coded.')
    expect(streamed).toEqual(['Checking.', 'You ', 'coded.'])
    expect(requests[0]!.url).toContain(':streamGenerateContent?alt=sse')
    expect(requests[0]!.body).toMatchObject({
      systemInstruction: { parts: [{ text: 'Be brief.' }] },
      tools: [{ functionDeclarations: [{ name: 'fetchTimeline' }] }],
      toolConfig: { functionCallingConfig: { mode: 'AUTO' } }
    })
    expect(requests[1]!.body.contents.slice(1)).toEqual([
      { role: 'model', parts: [{ text: 'Checking.' }, { functionCall: { name: 'fetchTimeline', args: { date: '2026-11-17' } }, thoughtSignature: 'sig' }] },
      { role: 'user', parts: [{ functionResponse: { name: 'fetchTimeline', response: { summary: 'Fetched 1 timeline card.' } } }] }
    ])
  })

  it('OpenAI-compatible: assembles streamed tool_calls and sends tool messages back', async () => {
    const chunk = (delta: object) => ({ model: 'qwen3-vl', choices: [{ index: 0, delta }] })
    const { fetch, requests } = fakeFetch(
      { sse: [chunk({ role: 'assistant', content: 'Checking.' }), chunk({ tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'fetchTimeline', arguments: '{"date":' } }] }), chunk({ tool_calls: [{ index: 0, function: { arguments: '"2026-11-17"}' } }] }), '[DONE]'] },
      { sse: [chunk({ content: 'You coded.' }), '[DONE]'] }
    )
    const { first, second, streamed } = await twoTurns(openaiProvider('qwen3-vl', undefined, 'http://localhost:11434/v1', { fetch }))

    expect(first.toolCalls).toEqual([{ id: 'call_1', name: 'fetchTimeline', args: { date: '2026-11-17' } }])
    expect(second.text).toBe('You coded.')
    expect(streamed).toEqual(['Checking.', 'You coded.'])
    expect(requests[0]!.body).toMatchObject({ stream: true, tools: [{ type: 'function', function: { name: 'fetchTimeline', parameters: tools[0]!.parameters } }] })
    expect(requests[1]!.body.messages.slice(2)).toEqual([
      { role: 'assistant', content: 'Checking.', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'fetchTimeline', arguments: '{"date":"2026-11-17"}' } }] },
      { role: 'tool', tool_call_id: 'call_1', content: '{"summary":"Fetched 1 timeline card."}' }
    ])
  })

  it('OpenAI-compatible: an error event after HTTP 200 fails the turn instead of passing as an answer', async () => {
    const { fetch } = fakeFetch({ sse: [{ choices: [{ index: 0, delta: { content: 'Partial' } }] }, { error: { code: 502, message: 'Provider returned error' }, choices: [{ index: 0, delta: {}, finish_reason: 'error' }] }] })
    const provider = openaiProvider('m', 'key', 'https://openrouter.ai/api/v1', { fetch })
    await expect(provider.chatTurn!({ system: 'S', messages: [{ role: 'user', text: 'Q' }], tools })).rejects.toThrow(/502.*Provider returned error/)
  })
})
