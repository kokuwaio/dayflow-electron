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
import { GEMMA_BACKUP_MODEL, GeminiCooldowns, geminiChain, nextGeminiStep } from '../../shared/gemini-models'

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

/** A refusal: the model declined (block reason, safety stop); another model may not. */
class GeminiRefusal extends ProviderError {}

const nowSec = () => Math.floor(Date.now() / 1000)

/** Gemma on the Gemini API takes no system instruction and no JSON mode: the instruction leads the first turn. */
function gemmaRequest({ system, turns }: GenerateRequest): GenerateRequest {
  if (!system) return { turns }
  const [first, ...rest] = turns
  return { turns: first ? [{ ...first, parts: [{ type: 'text', text: system }, ...first.parts] }, ...rest] : [{ role: 'user', parts: [{ type: 'text', text: system }] }] }
}

/**
 * Gemini API (generateContent) with frames sent inline. A request walks the
 * model chain (src/shared/gemini-models.ts): capacity errors and refusals move
 * to the next model, then to Gemma on the same key, like upstream
 * GeminiDirectProvider and GemmaBackupProvider.
 */
export function geminiProvider(model: string, apiKey: string, options: ProviderOptions): Provider {
  const fetchImpl = options.fetch ?? fetch
  const cooldowns = options.geminiCooldowns ?? new GeminiCooldowns()

  async function once(useModel: string, { system, turns, json }: GenerateRequest) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(useModel)}:generateContent`
    const gemma = useModel === GEMMA_BACKUP_MODEL
    const data = await postJson(fetchImpl, 'Gemini API', url, { 'x-goog-api-key': apiKey }, {
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      contents: turns.map((t) => ({ role: t.role === 'assistant' ? 'model' : 'user', parts: t.parts.map(toPart) })),
      generationConfig: { maxOutputTokens: gemma ? 8192 : 65536, ...(json && !gemma ? { responseMimeType: 'application/json' } : {}) }
    })
    const blocked = data?.promptFeedback?.blockReason
    if (blocked) throw new GeminiRefusal(`Gemini blocked the request (${blocked})`, false)
    const candidate = data?.candidates?.[0]
    const parts: Array<{ text?: string; thought?: boolean }> = candidate?.content?.parts ?? []
    const text = parts.filter((p) => !p.thought && typeof p.text === 'string').map((p) => p.text).join('')
    if (!text) {
      const reason = candidate?.finishReason ?? 'none'
      const message = `Gemini returned no text (finish reason ${reason})`
      throw reason === 'SAFETY' ? new GeminiRefusal(message, false) : new ProviderError(message, true)
    }
    return { text, model: useModel }
  }

  return {
    kind: 'gemini',
    model,
    local: false,
    async generate(request: GenerateRequest) {
      // Models that refused this key a moment ago are skipped (unless all of them did).
      const chain = cooldowns.usable(geminiChain(model), apiKey, nowSec())
      let index = 0
      // Gemma only runs because Gemini failed, so Gemini's error is the one to report.
      let geminiError: ProviderError | null = null
      for (;;) {
        const current = chain[index]!
        try {
          return await once(current, current === GEMMA_BACKUP_MODEL ? gemmaRequest(request) : request)
        } catch (err) {
          if (!(err instanceof ProviderError)) throw err
          if (err.status) cooldowns.note(apiKey, current, err.status, err.message, nowSec())
          const step = nextGeminiStep(chain, index, { message: err.message, refused: err instanceof GeminiRefusal, ...(err.status ? { status: err.status } : {}) })
          if (step.action === 'stop') throw geminiError ?? err
          if (step.model === GEMMA_BACKUP_MODEL) {
            geminiError = err
            chain.push(GEMMA_BACKUP_MODEL)
          }
          index = chain.indexOf(step.model, index + 1)
        }
      }
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
          // A response blocked while generating carries no blockReason, only this finish reason.
          const finish = chunk?.candidates?.[0]?.finishReason
          if (finish === 'SAFETY' || finish === 'PROHIBITED_CONTENT' || finish === 'BLOCKLIST' || finish === 'SPII') {
            throw new ProviderError(`Gemini blocked the response (${finish})`, false)
          }
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
