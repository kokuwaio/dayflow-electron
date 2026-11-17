import type { ProviderKind } from './types'

/**
 * A server on this computer or the local network (Ollama, LM Studio): it
 * needs no API key, and small requests suit the models it runs.
 */
export function isLocalUrl(url: string): boolean {
  let host: string
  try {
    host = new URL(url).hostname.replace(/^\[|\]$/g, '')
  } catch {
    return false
  }
  if (['localhost', '0.0.0.0', '::1'].includes(host) || host.endsWith('.localhost') || host.endsWith('.local')) return true
  const ip = host.split('.').map(Number)
  if (ip.length !== 4 || ip.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false
  const [a, b] = ip as [number, number, number, number]
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)
}

/** Whether a provider can only run with an API key. */
export function needsApiKey(kind: ProviderKind, openaiBaseUrl: string): boolean {
  return kind !== 'openai' || !isLocalUrl(openaiBaseUrl)
}
