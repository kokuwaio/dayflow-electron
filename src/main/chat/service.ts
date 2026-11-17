// Answers chat messages, after upstream Dayflow (Core/AI/ChatService.swift):
// stores the conversation, lets API providers look things up with the
// timeline tools, gives CLI providers the recent timeline in the prompt
// (with their tools off), and keeps the memory and suggestion blocks.

import type { Category } from '../../shared/categories'
import { chatMetadata } from '../../shared/chat-content'
import { dayRange, shiftDay, todayKey } from '../../shared/day'
import type { Settings } from '../../shared/types'
import type { Store } from '../db/store'
import type { ChatMessage, Provider } from '../providers/types'
import { CHAT_MEMORY_MAX, CHAT_SUGGESTIONS_KEPT } from '../settings'
import { type ChatEvent, runChatLoop } from './loop'
import { chatContextBlock, chatSystemPrompt } from './prompt'

/** Days of timeline a CLI provider sees, and days of observations within them. */
const CONTEXT_CARD_DAYS = 7
const CONTEXT_OBSERVATION_DAYS = 2
const TITLE_MAX = 80

export interface ChatDeps {
  store: Store
  /** Configured providers, main one first. */
  providers: () => Provider[]
  settings: { get(): Settings; save(next: Partial<Settings>): Promise<Settings> }
  categories: () => Category[]
}

export interface ChatReply {
  conversationId: string
  text: string
  suggestions: string[]
  model: string
}

const nowSeconds = () => Math.floor(Date.now() / 1000)

/** The stored conversation as provider-neutral history; tool rows stay out. */
function history(store: Store, conversationId: string): ChatMessage[] {
  return store.chatMessages(conversationId).flatMap((m): ChatMessage[] =>
    m.role === 'user' ? [{ role: 'user', text: m.content }] : m.role === 'assistant' ? [{ role: 'assistant', text: m.content, toolCalls: [] }] : []
  )
}

/** One prompt for a fresh CLI session: the conversation so far, then the new question. */
function transcript(messages: ChatMessage[]): string {
  const earlier = messages.slice(0, -1).flatMap((m) =>
    m.role === 'user' ? [`User: ${m.text}`] : m.role === 'assistant' ? [`Assistant: ${m.text}`] : []
  )
  const last = messages.at(-1)
  const question = last?.role === 'user' ? last.text : ''
  return earlier.length ? `Conversation so far:\n\n${earlier.join('\n\n')}\n\nNew message from the user:\n${question}` : question
}

async function answerWith(provider: Provider, deps: ChatDeps, conversationId: string, onEvent: (e: ChatEvent) => void) {
  const s = deps.settings.get()
  const base = {
    now: new Date(),
    language: s.outputLanguage,
    memory: s.chatMemory || null,
    recentSuggestions: s.chatSuggestions,
    categories: deps.categories().map((c) => ({ name: c.name, color: c.color }))
  }
  const messages = history(deps.store, conversationId)
  if (provider.chatTurn) {
    return runChatLoop({
      provider,
      system: chatSystemPrompt({ ...base, mode: 'tools' }),
      history: messages,
      data: deps.store,
      onEvent: (e) => {
        if (e.type === 'tool-end') deps.store.addChatMessage(conversationId, { role: 'toolCall', content: e.summary, now: nowSeconds() })
        onEvent(e)
      }
    })
  }
  const today = todayKey()
  const cards = deps.store.cardsBetween(dayRange(shiftDay(today, 1 - CONTEXT_CARD_DAYS)).start, dayRange(today).end)
  const observations = deps.store.observationsBetween(dayRange(shiftDay(today, 1 - CONTEXT_OBSERVATION_DAYS)).start, dayRange(today).end)
  const system = `${chatSystemPrompt({ ...base, mode: 'context' })}\n\n${chatContextBlock(cards, observations)}`
  const reply = await provider.generate({ system, turns: [{ role: 'user', parts: [{ type: 'text', text: transcript(messages) }] }] })
  onEvent({ type: 'text', delta: reply.text })
  return reply
}

/** Sends a user message in a conversation (a new one when `conversationId` is null) and stores the answer. */
export async function sendChatMessage(
  deps: ChatDeps,
  request: { conversationId: string | null; text: string },
  onEvent: (event: ChatEvent) => void
): Promise<ChatReply> {
  const providers = deps.providers()
  if (providers.length === 0) throw new Error('No AI provider configured.')
  const text = request.text.trim()
  const conversationId =
    request.conversationId ??
    deps.store.createConversation({ title: text.slice(0, TITLE_MAX) || 'New chat', provider: providers[0]!.kind, now: nowSeconds() })
  deps.store.addChatMessage(conversationId, { role: 'user', content: text, now: nowSeconds() })

  const errors: string[] = []
  for (const provider of providers) {
    try {
      const answer = await answerWith(provider, deps, conversationId, onEvent)
      const meta = chatMetadata(answer.text)
      deps.store.addChatMessage(conversationId, { role: 'assistant', content: meta.text, now: nowSeconds() })
      const s = deps.settings.get()
      await deps.settings.save({
        ...(meta.memory ? { chatMemory: meta.memory.slice(0, CHAT_MEMORY_MAX) } : {}),
        ...(meta.suggestions.length ? { chatSuggestions: [...s.chatSuggestions, ...meta.suggestions].slice(-CHAT_SUGGESTIONS_KEPT) } : {})
      })
      return { conversationId, text: meta.text, suggestions: meta.suggestions, model: answer.model }
    } catch (err) {
      errors.push(`${provider.model}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  throw new Error(errors.join(' · '))
}
