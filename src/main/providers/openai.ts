import { isLocalUrl } from '../../shared/providers'
import { type GenerateRequest, type Part, type Provider, type ProviderOptions, ProviderError, postJson, toBase64 } from './types'

export const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1'

const toContent = (p: Part) =>
  p.type === 'text'
    ? { type: 'text', text: p.text }
    : { type: 'image_url', image_url: { url: `data:${p.mediaType};base64,${toBase64(p.data)}` } }

/** OpenAI chat completions; also Ollama, LM Studio, OpenRouter and other compatible servers. */
export function openaiProvider(model: string, apiKey: string | undefined, baseUrl: string | undefined, options: ProviderOptions): Provider {
  const fetchImpl = options.fetch ?? fetch
  const base = (baseUrl || OPENAI_DEFAULT_BASE_URL).replace(/\/+$/, '')
  return {
    kind: 'openai',
    model,
    local: isLocalUrl(base),
    async generate({ system, turns }: GenerateRequest) {
      if (!apiKey && !isLocalUrl(base)) {
        throw new ProviderError(`No API key set for ${base}. Add one in Settings.`, false)
      }
      const messages = [
        ...(system ? [{ role: 'system', content: system }] : []),
        ...turns.map((t) =>
          t.role === 'assistant'
            ? { role: 'assistant', content: t.parts.map((p) => (p.type === 'text' ? p.text : '')).join('') }
            : { role: 'user', content: t.parts.map(toContent) }
        )
      ]
      const data = await postJson(
        fetchImpl,
        'OpenAI-compatible API',
        `${base}/chat/completions`,
        apiKey ? { authorization: `Bearer ${apiKey}` } : {},
        { model, messages, max_completion_tokens: 16000 }
      )
      const text = data?.choices?.[0]?.message?.content
      if (typeof text !== 'string' || !text) throw new ProviderError('OpenAI-compatible API returned no text', true)
      return { text, model: typeof data.model === 'string' ? data.model : model }
    }
  }
}
