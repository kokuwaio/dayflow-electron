import { type GenerateRequest, type Part, type Provider, type ProviderOptions, ProviderError, postJson, toBase64 } from './types'

const toPart = (p: Part) =>
  p.type === 'text' ? { text: p.text } : { inlineData: { mimeType: p.mediaType, data: toBase64(p.data) } }

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
    }
  }
}
