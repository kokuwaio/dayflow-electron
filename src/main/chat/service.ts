// Answers chat messages, after upstream Dayflow (Core/AI/ChatService.swift):
// stores the conversation, lets API providers look things up with the
// timeline tools, gives CLI providers the recent timeline in the prompt
// (with their tools off), and keeps the memory and suggestion blocks.

import type { Category } from '../../shared/categories'
import { chatMetadata } from '../../shared/chat-content'
import { dayRange, shiftDay, todayKey } from '../../shared/day'
import type { ChatEvent, ChatReply, ProviderKind, Settings } from '../../shared/types'
import type { Store } from '../db/store'
import type { ChatMessage, Provider } from '../providers/types'
import { runChatLoop } from './loop'
import { chatContextBlock, chatSystemPrompt } from './prompt'
import { errorMessage } from '../../shared/errors'

/** Days of timeline a CLI provider sees, and days of observations within them. */
const CONTEXT_CARD_DAYS = 7
const CONTEXT_OBSERVATION_DAYS = 2
const TITLE_MAX = 80
/** Upstream remembers this many recent suggestions per conversation, so the model avoids repeating them. */
const SUGGESTIONS_KEPT = 12

export interface ChatDeps {
  store: Store
  /** Configured providers, main one first. */
  providers: () => Provider[]
  settings: { get(): Settings; save(next: Partial<Settings>): Promise<Settings> }
  categories: () => Category[]
  /** Recent suggestions per conversation, for this run of the app (upstream keeps them in memory). */
  suggestions: Map<string, string[]>
}

const nowSeconds = () => Math.floor(Date.now() / 1000)

/** Upstream's title: the first message on one line, cut to 80 characters. */
const titleOf = (text: string) => text.split(/\s*\n\s*/).join(' ').trim().slice(0, TITLE_MAX) || 'New chat'

/** The stored conversation as provider-neutral history; only user and assistant turns count. */
function history(store: Store, conversationId: string): ChatMessage[] {
  return store.chatMessages(conversationId).flatMap((m): ChatMessage[] => {
    if (m.role === 'user') return [{ role: 'user', text: m.content }]
    if (m.role === 'assistant') return [{ role: 'assistant', text: m.content, toolCalls: [] }]
    return []
  })
}

/** One prompt for a fresh CLI session: the conversation so far, then the new question. */
function transcript(messages: ChatMessage[]): string {
  const lines = messages.map((m) => (m.role === 'user' ? `User: ${m.text}` : m.role === 'assistant' ? `Assistant: ${m.text}` : ''))
  const question = lines.pop()?.replace(/^User: /, '') ?? ''
  const earlier = lines.filter(Boolean)
  return earlier.length ? `Conversation so far:\n\n${earlier.join('\n\n')}\n\nNew message from the user:\n${question}` : question
}

/** Adds suggestions to a conversation's recent list: case-insensitive, newest last (upstream appendRecentSuggestions). */
function remember(list: string[], suggestions: string[]): string[] {
  let next = [...list]
  for (const raw of suggestions) {
    const suggestion = raw.trim()
    if (!suggestion) continue
    next = next.filter((s) => s.toLowerCase() !== suggestion.toLowerCase())
    next.push(suggestion)
  }
  return next.slice(-SUGGESTIONS_KEPT)
}

async function answerWith(provider: Provider, deps: ChatDeps, conversationId: string, onEvent: (e: ChatEvent) => void) {
  const settings = deps.settings.get()
  const base = {
    now: new Date(),
    language: settings.outputLanguage,
    memory: settings.chatMemory || null,
    recentSuggestions: deps.suggestions.get(conversationId) ?? [],
    categories: deps.categories().map((c) => ({ name: c.name, color: c.color }))
  }
  const messages = history(deps.store, conversationId)
  if (provider.chatTurn) {
    return runChatLoop({ provider, system: chatSystemPrompt({ ...base, mode: 'tools' }), history: messages, data: deps.store, onEvent })
  }
  const today = todayKey()
  const cards = deps.store.cardsBetween(dayRange(shiftDay(today, 1 - CONTEXT_CARD_DAYS)).start, dayRange(today).end)
  const observations = deps.store.observationsBetween(dayRange(shiftDay(today, 1 - CONTEXT_OBSERVATION_DAYS)).start, dayRange(today).end)
  const system = `${chatSystemPrompt({ ...base, mode: 'context' })}\n\n${chatContextBlock(cards, observations)}`
  const reply = await provider.generate({ system, turns: [{ role: 'user', parts: [{ type: 'text', text: transcript(messages) }] }] })
  onEvent({ type: 'text', delta: reply.text })
  return reply
}

export class ChatError extends Error {
  constructor(
    message: string,
    readonly conversationId: string
  ) {
    super(message)
  }
}

/**
 * Sends a user message in a conversation (a new one when `conversationId` is
 * null) and stores the answer. `preferred` puts that provider first.
 * When every provider fails, the error is kept in the conversation as an
 * assistant message, like upstream, and thrown as a ChatError.
 */
export async function sendChatMessage(
  deps: ChatDeps,
  request: { conversationId: string | null; text: string; preferred?: ProviderKind },
  onEvent: (event: ChatEvent) => void
): Promise<ChatReply> {
  const configured = deps.providers()
  if (configured.length === 0) throw new Error('No AI provider configured.')
  const providers = [...configured].sort((a, b) => Number(b.kind === request.preferred) - Number(a.kind === request.preferred))
  const text = request.text.trim()
  const conversationId =
    request.conversationId ?? deps.store.createConversation({ title: titleOf(text), provider: providers[0]!.kind, now: nowSeconds() })
  deps.store.addChatMessage(conversationId, { role: 'user', content: text, now: nowSeconds() })

  const errors: string[] = []
  for (const [i, provider] of providers.entries()) {
    if (i > 0) onEvent({ type: 'reset' })
    try {
      const answer = await answerWith(provider, deps, conversationId, onEvent)
      const meta = chatMetadata(answer.text)
      deps.store.addChatMessage(conversationId, { role: 'assistant', content: meta.text, now: nowSeconds() })
      if (meta.memory) await deps.settings.save({ chatMemory: meta.memory })
      deps.suggestions.set(conversationId, remember(deps.suggestions.get(conversationId) ?? [], meta.suggestions))
      return { conversationId, text: meta.text, suggestions: meta.suggestions, model: answer.model }
    } catch (err) {
      errors.push(`${provider.model}: ${errorMessage(err)}`)
    }
  }
  const message = errors.join(' · ')
  deps.store.addChatMessage(conversationId, { role: 'assistant', content: `I encountered an error: ${message}`, now: nowSeconds() })
  throw new ChatError(message, conversationId)
}
