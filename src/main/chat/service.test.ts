import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../../shared/types'
import { Store } from '../db/store'
import type { Provider } from '../providers/types'
import { ChatError, sendChatMessage } from './service'

/** A provider without tools (the CLI path) that always gives the same reply. */
const replying = (model: string, text: string): Provider => ({
  kind: 'openai',
  model,
  local: false,
  generate: async () => ({ text, model })
})

const deps = (providers: Provider[]) => ({
  store: Store.open(':memory:'),
  providers: () => providers,
  settings: { get: () => DEFAULT_SETTINGS, save: async () => DEFAULT_SETTINGS },
  categories: () => [],
  suggestions: new Map<string, string[]>()
})

describe('sendChatMessage', () => {
  it('treats an empty answer as a failure, so the next provider answers', async () => {
    const d = deps([replying('silent', '  \n'), replying('second', 'You worked on the review overlay.')])
    const reply = await sendChatMessage(d, { conversationId: null, text: 'What did I do?' }, () => {})
    expect(reply.text).toBe('You worked on the review overlay.')
    expect(d.store.chatMessages(reply.conversationId).map((m) => m.content)).toEqual(['What did I do?', 'You worked on the review overlay.'])
  })

  it('reports an empty answer from the last provider instead of storing it', async () => {
    const d = deps([replying('silent', '')])
    await expect(sendChatMessage(d, { conversationId: null, text: 'Hi' }, () => {})).rejects.toBeInstanceOf(ChatError)
  })
})
