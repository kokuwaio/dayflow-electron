// The chat's tool loop for API providers, after upstream Dayflow
// (Core/AI/GeminiDirectProvider+DashboardChat.swift, runDashboardChatLoop):
// the model may call the timeline tools for up to 20 rounds before it answers.

import type { ChatEvent } from '../../shared/types'
import type { ChatMessage, Provider } from '../providers/types'
import { CHAT_TOOLS, type ChatData, runChatTool } from './tools'

export type { ChatEvent }

export const MAX_TOOL_ROUNDS = 20

/** Answers the last user message; `history` is the conversation so far, oldest first. */
export async function runChatLoop(opts: {
  provider: Provider
  system: string
  history: ChatMessage[]
  data: ChatData
  onEvent: (event: ChatEvent) => void
}): Promise<{ text: string; model: string }> {
  const { provider } = opts
  if (!provider.chatTurn) throw new Error(`${provider.kind} cannot call tools.`)
  const messages = [...opts.history]
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const turn = await provider.chatTurn({
      system: opts.system,
      messages,
      tools: CHAT_TOOLS,
      onText: (delta) => opts.onEvent({ type: 'text', delta })
    })
    if (turn.toolCalls.length === 0) return { text: turn.text, model: turn.model }
    messages.push({ role: 'assistant', text: turn.text, toolCalls: turn.toolCalls, native: turn.native })
    const results = turn.toolCalls.map((call) => {
      opts.onEvent({ type: 'tool-start', command: `${call.name} ${JSON.stringify(call.args)}` })
      const result = runChatTool(call.name, call.args, opts.data)
      opts.onEvent({ type: 'tool-end', summary: result.summary, failed: 'error' in result })
      return { call, result }
    })
    messages.push({ role: 'tool', results })
  }
  throw new Error('The assistant exceeded the maximum tool-call rounds. Please try a narrower query.')
}
