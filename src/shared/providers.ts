import { type CliName, DEFAULT_SETTINGS, type ProviderKind, type Settings } from './types'

/** Every provider kind, in the order Settings lists them. */
export const PROVIDER_KINDS: readonly ProviderKind[] = ['anthropic', 'gemini', 'openai', 'claude-cli', 'codex-cli']

const CLI_OF: Partial<Record<ProviderKind, CliName>> = { 'claude-cli': 'claude', 'codex-cli': 'codex' }

/** The agent CLI behind a provider kind, or null for API providers. */
export const cliOf = (kind: ProviderKind): CliName | null => CLI_OF[kind] ?? null

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
  // IPv6 unique-local (fc00::/7) and link-local (fe80::/10) addresses, as URL hostnames write them.
  if (host.includes(':')) return /^(?:f[cd][0-9a-f]{0,2}|fe[89ab][0-9a-f]?):/i.test(host)
  const ip = host.split('.').map(Number)
  if (ip.length !== 4 || ip.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false
  const [a, b] = ip as [number, number, number, number]
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)
}

/** Whether a provider can only run with an API key. */
export function needsApiKey(kind: ProviderKind, openaiBaseUrl: string): boolean {
  if (cliOf(kind)) return false
  return kind !== 'openai' || !isLocalUrl(openaiBaseUrl)
}

/** Ollama's OpenAI-compatible endpoint and the model the onboarding presets for it. */
export const OLLAMA_BASE_URL = 'http://localhost:11434/v1'
/** Small and quick on a laptop GPU; qwen3-vl:8b-instruct writes better cards, slower. */
export const OLLAMA_MODEL = 'qwen3-vl:2b-instruct'

/**
 * The settings an onboarding column sets: Local AI presets Ollama and its
 * model; a custom endpoint puts the API defaults back, but only where the
 * Ollama presets still stand, so nothing typed gets lost.
 */
export function providerChoice(
  flavor: string,
  kind: ProviderKind,
  current: Pick<Settings, 'openaiBaseUrl' | 'models'>
): Partial<Pick<Settings, 'provider' | 'openaiBaseUrl' | 'models'>> {
  if (flavor === 'local') return { provider: kind, openaiBaseUrl: OLLAMA_BASE_URL, models: { ...current.models, openai: OLLAMA_MODEL } }
  if (kind !== 'openai') return { provider: kind }
  return {
    provider: kind,
    ...(current.openaiBaseUrl === OLLAMA_BASE_URL ? { openaiBaseUrl: DEFAULT_SETTINGS.openaiBaseUrl } : {}),
    ...(current.models.openai === OLLAMA_MODEL ? { models: { ...current.models, openai: DEFAULT_SETTINGS.models.openai } } : {})
  }
}
