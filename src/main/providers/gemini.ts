import {
  type ChatMessage,
  type ChatTurnRequest,
  type ChatTurnResult,
  type GenerateRequest,
  type Part,
  type Provider,
  type ProviderOptions,
  ProviderError,
  type ToolCall,
  postJson,
  postSse,
  toBase64
} from './types'

const toPart = (p: Part) =>
  p.type === 'text' ? { text: p.text } : { inlineData: { mimeType: p.mediaType, data: toBase64(p.data) } }

type GeminiPart = { text?: string; thought?: boolean; functionCall?: { name: string; args?: Record<string, unknown> }; thoughtSignature?: string }

/** Chat history as Gemini contents; model turns replay their own parts so thought signatures go back unchanged. */
function toContents(messages: ChatMessage[]) {
  return messages.map((m) => {
    if (m.role === 'user') return { role: 'user', parts: [{ text: m.text }] }
    if (m.role === 'assistant') return { role: 'model', parts: (m.native as GeminiPart[] | undefined) ?? [{ text: m.text }] }
    // Upstream sends function responses in a user turn.
    return { role: 'user', parts: m.results.map((r) => ({ functionResponse: { name: r.call.name, response: r.result } })) }
  })
}

/** Gemini API (generateContent) with frames sent inline. */
export function geminiProvider(model: string, apiKey: string, options: ProviderOptions): Provider {
  const fetchImpl = options.fetch ?? fetch
  return {
    kind: 'gemini',
    model,
    local: false,
    async generate({ system, turns, json }: GenerateRequest) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`
      const data = await postJson(fetchImpl, 'Gemini API', url, { 'x-goog-api-key': apiKey }, {
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        contents: turns.map((t) => ({ role: t.role === 'assistant' ? 'model' : 'user', parts: t.parts.map(toPart) })),
        generationConfig: { maxOutputTokens: 65536, ...(json ? { responseMimeType: 'application/json' } : {}) }
      })
      const blocked = data?.promptFeedback?.blockReason
      if (blocked) throw new ProviderError(`Gemini blocked the request (${blocked})`, false)
      const candidate = data?.candidates?.[0]
      const parts: Array<{ text?: string; thought?: boolean }> = candidate?.content?.parts ?? []
      const text = parts.filter((p) => !p.thought && typeof p.text === 'string').map((p) => p.text).join('')
      if (!text) {
        throw new ProviderError(`Gemini returned no text (finish reason ${candidate?.finishReason ?? 'none'})`, candidate?.finishReason !== 'SAFETY')
      }
      return { text, model }
    },
    // Request shape after upstream's dashboard chat (GeminiDirectProvider+DashboardChat.swift).
    async chatTurn({ system, messages, tools, onText }: ChatTurnRequest): Promise<ChatTurnResult> {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`
      const parts: GeminiPart[] = []
      let modelVersion = model
      await postSse(
        fetchImpl,
        'Gemini API',
        url,
        { 'x-goog-api-key': apiKey },
        {
          systemInstruction: { parts: [{ text: system }] },
          contents: toContents(messages),
          tools: [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })) }],
          toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
          generationConfig: { maxOutputTokens: 8192 }
        },
        (chunk) => {
          if (chunk?.promptFeedback?.blockReason) throw new ProviderError(`Gemini blocked the request (${chunk.promptFeedback.blockReason})`, false)
          if (typeof chunk?.modelVersion === 'string') modelVersion = chunk.modelVersion
          for (const part of (chunk?.candidates?.[0]?.content?.parts ?? []) as GeminiPart[]) {
            parts.push(part)
            if (typeof part.text === 'string' && !part.thought && part.text) onText?.(part.text)
          }
        }
      )
      const toolCalls: ToolCall[] = parts.flatMap((p, i) => (p.functionCall ? [{ id: `call_${i}`, name: p.functionCall.name, args: p.functionCall.args ?? {} }] : []))
      const text = parts.filter((p) => typeof p.text === 'string' && !p.thought).map((p) => p.text).join('')
      return { text, toolCalls, native: parts, model: modelVersion }
    }
  }
}
