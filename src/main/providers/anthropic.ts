import Anthropic from '@anthropic-ai/sdk'
import {
  type ChatMessage,
  type ChatTurnRequest,
  type ChatTurnResult,
  type GenerateRequest,
  type GenerateResult,
  type Part,
  type Provider,
  ProviderError,
  type ProviderOptions,
  isRetryableStatus,
  toBase64
} from './types'

const toBlock = (p: Part) =>
  p.type === 'text'
    ? { type: 'text' as const, text: p.text }
    : { type: 'image' as const, source: { type: 'base64' as const, media_type: p.mediaType, data: toBase64(p.data) } }

/** Chat history as Messages API turns; assistant turns replay their own content blocks (thinking included). */
function toMessages(messages: ChatMessage[]) {
  return messages.map((m) => {
    if (m.role === 'user') return { role: 'user' as const, content: m.text }
    if (m.role === 'assistant') return { role: 'assistant' as const, content: (m.native as Anthropic.Beta.BetaContentBlockParam[] | undefined) ?? m.text }
    return {
      role: 'user' as const,
      content: m.results.map((r) => ({ type: 'tool_result' as const, tool_use_id: r.call.id, content: JSON.stringify(r.result) }))
    }
  })
}

export function anthropicProvider(model: string, apiKey: string, options: ProviderOptions): Provider {
  const client = new Anthropic({ apiKey, ...(options.fetch ? { fetch: options.fetch, maxRetries: 0 } : {}) })
  return {
    kind: 'anthropic',
    model,
    local: false,
    async generate({ system, turns }: GenerateRequest): Promise<GenerateResult> {
      const response = await client.beta.messages
        .create({
        model,
        max_tokens: 16000,
        // Refusals are retried server-side on a model chosen per refusal category.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        ...(system ? { system } : {}),
          messages: turns.map((t) => ({ role: t.role, content: t.parts.map(toBlock) }))
        })
        .catch((err: unknown) => {
          throw toProviderError(err)
        })
      if (response.stop_reason === 'refusal') {
        throw new ProviderError(`Anthropic refused the request (${response.stop_details?.category ?? 'no category'})`, false)
      }
      const text = response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n')
      return { text, model: response.model }
    },
    async chatTurn({ system, messages, tools, onText }: ChatTurnRequest): Promise<ChatTurnResult> {
      const stream = client.beta.messages.stream({
        model,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        thinking: { type: 'adaptive' },
        system,
        // Tool inputs are checked by the tools themselves (src/main/chat/tools.ts).
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters as Anthropic.Beta.BetaTool.InputSchema,
          eager_input_streaming: true
        })),
        messages: toMessages(messages)
      })
      stream.on('text', (delta) => onText?.(delta))
      const message = await stream.finalMessage().catch((err: unknown) => {
        throw toProviderError(err)
      })
      if (message.stop_reason === 'refusal') {
        throw new ProviderError(`Anthropic refused the request (${message.stop_details?.category ?? 'no category'})`, false)
      }
      return {
        text: message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join(''),
        toolCalls: message.content.flatMap((b) =>
          b.type === 'tool_use' ? [{ id: b.id, name: b.name, args: (b.input ?? {}) as Record<string, unknown> }] : []
        ),
        native: message.content,
        model: message.model
      }
    }
  }
}

function toProviderError(err: unknown): ProviderError {
  if (err instanceof Anthropic.APIError && typeof err.status === 'number') {
    const detail = (err.error as { error?: { message?: string } } | undefined)?.error?.message ?? err.message
    return new ProviderError(`Anthropic API ${err.status}: ${detail}`, isRetryableStatus(err.status), err.status)
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new ProviderError(`Anthropic API unreachable: ${err.message}`, true)
  }
  return new ProviderError(`Anthropic API: ${err instanceof Error ? err.message : String(err)}`, false)
}
