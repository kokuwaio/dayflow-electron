// Which provider writes the Daily standup, after upstream Dayflow
// (Core/AI/DailyRecapModels.swift DailyRecapProvider, Views/UI/DailyView+Provider.swift).
// Upstream lists its own fixed set (hosted backend, Gemini, ChatGPT, Claude,
// local); here the choices are "the timeline's providers" (the default), one
// of the configured provider kinds, or none, which turns generation off.

import { PROVIDER_KINDS } from './providers'
import type { ProviderKind } from './types'

export type DailyProviderChoice = 'auto' | 'none' | ProviderKind

export const sanitizeDailyProvider = (raw: unknown): DailyProviderChoice =>
  raw === 'none' || PROVIDER_KINDS.includes(raw as ProviderKind) ? (raw as DailyProviderChoice) : 'auto'

export type StandupPlan = { kind: 'ok'; providers: ProviderKind[] } | { kind: 'off' } | { kind: 'unavailable'; provider: ProviderKind }

/**
 * The providers to try for a standup, in order. `usable` says whether a kind
 * can run (has its key, or needs none). The automatic and manual paths both use it.
 */
export function standupPlan(
  choice: DailyProviderChoice,
  timeline: { provider: ProviderKind; fallbackProvider: ProviderKind | null },
  usable: (kind: ProviderKind) => boolean
): StandupPlan {
  if (choice === 'none') return { kind: 'off' }
  if (choice !== 'auto') return usable(choice) ? { kind: 'ok', providers: [choice] } : { kind: 'unavailable', provider: choice }
  const kinds = [timeline.provider, ...(timeline.fallbackProvider ? [timeline.fallbackProvider] : [])]
  return { kind: 'ok', providers: kinds.filter(usable) }
}

/** A row of Daily's provider picker: the provider kind, its model, and whether it can run now. */
export interface DailyProviderOption {
  kind: ProviderKind
  /** The name to show, local OpenAI-compatible servers as "Ollama/LM Studio". */
  label: string
  model: string
  available: boolean
}

