import Anthropic from '@anthropic-ai/sdk'
import {
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
