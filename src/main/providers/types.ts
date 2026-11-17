import type { ProviderKind } from '../../shared/types'

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
}

export interface ProviderOptions {
  fetch?: typeof fetch
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

/** POSTs JSON and maps transport and HTTP failures to ProviderError. */
export async function postJson(
  fetchImpl: typeof fetch,
  label: string,
  url: string,
  headers: Record<string, string>,
  body: unknown
): Promise<any> {
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
  const text = await res.text()
  if (!res.ok) {
    let detail = text.slice(0, 300)
    try {
      const parsed = JSON.parse(text)
      detail = parsed?.error?.message ?? (typeof parsed?.error === 'string' ? parsed.error : detail)
    } catch {
      // keep the raw body excerpt
    }
    throw new ProviderError(`${label} ${res.status}: ${detail}`, isRetryableStatus(res.status), res.status)
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new ProviderError(`${label}: response is not JSON`, true, res.status)
  }
}
