import type { CliName, ProviderKind } from '../../shared/types'
import type { CliEnv } from './cli/cli-providers'
import type { ProcessRunner } from './cli/host'

export type { ProviderKind }

export interface ProviderSettings {
  kind: ProviderKind
  model: string
  /** OpenAI-compatible only: e.g. http://localhost:11434/v1 for Ollama. */
  baseUrl?: string
}

export type Part =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: 'image/jpeg'; data: Uint8Array }

export interface Turn {
  role: 'user' | 'assistant'
  parts: Part[]
}

export interface GenerateRequest {
  system?: string
  turns: Turn[]
  /** Ask for a JSON reply where the provider supports a JSON mode. */
  json?: boolean
}

export interface GenerateResult {
  text: string
  model: string
}

export interface Provider {
  readonly kind: ProviderKind
  readonly model: string
  /** A model on this computer (Ollama, LM Studio): small requests work better. */
  readonly local: boolean
  generate(request: GenerateRequest): Promise<GenerateResult>
  /** One streamed chat turn that may call tools; API providers only. */
  chatTurn?(request: ChatTurnRequest): Promise<ChatTurnResult>
}

/** A tool the chat model may call; parameters are JSON Schema. */
export interface ToolSpec {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
}

/**
 * Chat history in provider-neutral form. An assistant turn keeps the
 * provider's own content (`native`) too: Anthropic thinking blocks and Gemini
 * thought signatures must go back unchanged in the next tool round.
 */
export type ChatMessage =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string; toolCalls: ToolCall[]; native?: unknown }
  | { role: 'tool'; results: Array<{ call: ToolCall; result: unknown }> }

export interface ChatTurnRequest {
  system: string
  messages: ChatMessage[]
  tools: ToolSpec[]
  /** Called with each piece of answer text as it streams in. */
  onText?: (delta: string) => void
}

export interface ChatTurnResult {
  text: string
  toolCalls: ToolCall[]
  native: unknown
  model: string
}

export interface ProviderOptions {
  fetch?: typeof fetch
  /** For the agent CLI providers: how to reach the host and where to put temporary files. */
  cli?: CliEnv & { runner: ProcessRunner; paths: Record<CliName, string> }
}

/** A failed provider call. retryable: worth trying again later (rate limit, outage). */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}

export const toBase64 = (data: Uint8Array): string => Buffer.from(data).toString('base64')

/** Rate limits, timeouts and server-side failures are worth another try later. */
export const isRetryableStatus = (status: number): boolean => status === 408 || status === 429 || status >= 500

/** POSTs JSON; transport and HTTP failures become ProviderError. Returns the successful response. */
async function post(fetchImpl: typeof fetch, label: string, url: string, headers: Record<string, string>, body: unknown): Promise<Response> {
  let res: Response
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10 * 60_000)
    })
  } catch (err) {
    throw new ProviderError(`${label} unreachable: ${err instanceof Error ? err.message : String(err)}`, true)
  }
  if (res.ok) return res
  const text = await res.text()
  let detail = text.slice(0, 300)
  try {
    const parsed = JSON.parse(text)
    detail = parsed?.error?.message ?? (typeof parsed?.error === 'string' ? parsed.error : detail)
  } catch {
    // keep the raw body excerpt
  }
  throw new ProviderError(`${label} ${res.status}: ${detail}`, isRetryableStatus(res.status), res.status)
}

/** POSTs JSON and parses the JSON reply. */
export async function postJson(
  fetchImpl: typeof fetch,
  label: string,
  url: string,
  headers: Record<string, string>,
  body: unknown
): Promise<any> {
  const res = await post(fetchImpl, label, url, headers, body)
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new ProviderError(`${label}: response is not JSON`, true, res.status)
  }
}

/** POSTs JSON and calls `onData` with each server-sent event's parsed data; "[DONE]" ends the stream. */
export async function postSse(
  fetchImpl: typeof fetch,
  label: string,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  onData: (data: any) => void
): Promise<void> {
  const res = await post(fetchImpl, label, url, headers, body)
  if (!res.body) throw new ProviderError(`${label}: empty response`, true, res.status)
  const decoder = new TextDecoder()
  let buffer = ''
  const flush = (event: string) => {
    const data = event
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trimStart())
      .join('\n')
    if (!data || data === '[DONE]') return
    try {
      onData(JSON.parse(data))
    } catch (err) {
      if (err instanceof SyntaxError) throw new ProviderError(`${label}: unreadable stream event`, true)
      throw err
    }
  }
  try {
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true }).replace(/\r\n/g, '\n')
      let end: number
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        flush(buffer.slice(0, end))
        buffer = buffer.slice(end + 2)
      }
    }
  } catch (err) {
    if (err instanceof ProviderError) throw err
    throw new ProviderError(`${label} stream broke off: ${err instanceof Error ? err.message : String(err)}`, true)
  }
  flush(buffer)
}
