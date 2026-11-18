import { isLocalUrl } from '../../shared/providers'
import {
  type ChatMessage,
  type ChatTurnRequest,
  type ChatTurnResult,
  type GenerateRequest,
  type Part,
  type Provider,
  type ProviderOptions,
  ProviderError,
  isRetryableStatus,
  postJson,
  postSse,
  toBase64
} from './types'

export const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1'

const toContent = (p: Part) =>
  p.type === 'text'
    ? { type: 'text', text: p.text }
    : { type: 'image_url', image_url: { url: `data:${p.mediaType};base64,${toBase64(p.data)}` } }

/** Chat history as chat-completions messages, tool calls and results included. */
function toMessages(system: string, messages: ChatMessage[]) {
  return [
    { role: 'system', content: system },
    ...messages.flatMap((m) => {
      if (m.role === 'user') return [{ role: 'user', content: m.text }]
      if (m.role === 'assistant') {
        return [
          {
            role: 'assistant',
            content: m.text,
            ...(m.toolCalls.length
              ? { tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) }
              : {})
          }
        ]
      }
      return m.results.map((r) => ({ role: 'tool', tool_call_id: r.call.id, content: JSON.stringify(r.result) }))
    })
  ]
}

/** Arguments the model streamed as a JSON string; a broken string becomes no arguments, which the tool reports back. */
function parseArgs(raw: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(raw || '{}')
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** OpenAI chat completions; also Ollama, LM Studio, OpenRouter and other compatible servers. */
export function openaiProvider(model: string, apiKey: string | undefined, baseUrl: string | undefined, options: ProviderOptions): Provider {
  const fetchImpl = options.fetch ?? fetch
  const base = (baseUrl || OPENAI_DEFAULT_BASE_URL).replace(/\/+$/, '')
  // A local server's errors name it, so a stopped Ollama reads as such (upstream "local_engine_offline").
  const label = isLocalUrl(base) ? `Ollama/LM Studio at ${base}` : 'OpenAI-compatible API'
  const headers = (): Record<string, string> => {
    if (!apiKey && !isLocalUrl(base)) throw new ProviderError(`No API key set for ${base}. Add one in Settings.`, false)
    return apiKey ? { authorization: `Bearer ${apiKey}` } : {}
  }
  return {
    kind: 'openai',
    model,
    local: isLocalUrl(base),
    async generate({ system, turns }: GenerateRequest) {
      const auth = headers()
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
        label,
        `${base}/chat/completions`,
        auth,
        { model, messages, max_completion_tokens: 16000 }
      )
      const text = data?.choices?.[0]?.message?.content
      if (typeof text !== 'string' || !text) throw new ProviderError('OpenAI-compatible API returned no text', true)
      return { text, model: typeof data.model === 'string' ? data.model : model }
    },
    async chatTurn({ system, messages, tools, onText }: ChatTurnRequest): Promise<ChatTurnResult> {
      let text = ''
      let served = model
      const calls: Array<{ id: string; name: string; arguments: string }> = []
      await postSse(
        fetchImpl,
        label,
        `${base}/chat/completions`,
        headers(),
        {
          model,
          stream: true,
          messages: toMessages(system, messages),
          tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }))
        },
        (chunk) => {
          // OpenRouter and others report failures mid-stream, after HTTP 200.
          const failed = chunk?.error ?? (chunk?.choices?.[0]?.finish_reason === 'error' ? { message: 'the model stopped with an error' } : null)
          if (failed) {
            const status = Number(failed.code) || undefined
            const message = typeof failed.message === 'string' ? failed.message : JSON.stringify(failed)
            throw new ProviderError(`${label}${status ? ` ${status}` : ''}: ${message}`, status === undefined || isRetryableStatus(status), status)
          }
          if (typeof chunk?.model === 'string') served = chunk.model
          const delta = chunk?.choices?.[0]?.delta
          if (typeof delta?.content === 'string' && delta.content) {
            text += delta.content
            onText?.(delta.content)
          }
          for (const tc of delta?.tool_calls ?? []) {
            const i = typeof tc.index === 'number' ? tc.index : calls.length
            const call = (calls[i] ??= { id: '', name: '', arguments: '' })
            if (tc.id) call.id = tc.id
            if (tc.function?.name) call.name += tc.function.name
            if (tc.function?.arguments) call.arguments += tc.function.arguments
          }
        }
      )
      const toolCalls = calls.filter(Boolean).map((c, i) => ({ id: c.id || `call_${i}`, name: c.name, args: parseArgs(c.arguments) }))
      return { text, toolCalls, native: null, model: served }
    }
  }
}
