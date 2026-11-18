// Gemini's models and how a request steps down them, after upstream Dayflow
// (Core/AI/GeminiModelPreference.swift for the list and its order,
// GeminiDirectProvider.swift for the capacity codes and cooldowns,
// GemmaBackupProvider.swift and LLMService.gemmaCanTakeOver for the Gemma
// backup on the same API key).

import { failureKind } from './failures'

/** The models Settings offers, newest first; a request steps down this list. */
export const GEMINI_MODELS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'gemini-4-hydrogen', label: 'Gemini 4 Hydrogen' },
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
  { id: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash' },
  { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash' },
  { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite' }
]

/** The open model that takes over on the same key when every Gemini model refused (upstream's default). */
export const GEMMA_BACKUP_MODEL = 'gemma-4-31b-it'
export const GEMMA_BACKUP_LABEL = 'Gemma 4 31B'

/** HTTP statuses that mean "this model, not now": busy, out of quota, or not available to this key. */
const CAPACITY_STATUSES = [403, 404, 429, 503]

export const isGeminiPreset = (model: string): boolean => GEMINI_MODELS.some((m) => m.id === model.trim())

/** A model's name for people: the preset's label, else the ID as typed. */
export const geminiLabel = (model: string): string =>
  model === GEMMA_BACKUP_MODEL ? GEMMA_BACKUP_LABEL : (GEMINI_MODELS.find((m) => m.id === model.trim())?.label ?? model.trim())

/** The models a request tries, the chosen one first. A custom model has no chain: it was picked on purpose. */
export function geminiChain(model: string): string[] {
  const id = model.trim()
  const index = GEMINI_MODELS.findIndex((m) => m.id === id)
  return index < 0 ? [id] : GEMINI_MODELS.slice(index).map((m) => m.id)
}

export interface GeminiFailure {
  /** The HTTP status, when the API answered. */
  status?: number
  /** The model declined the request (a block reason or a safety stop). */
  refused?: boolean
  message: string
}

export type GeminiStep = { action: 'model'; model: string } | { action: 'stop' }

/**
 * What to try after `chain[index]` failed. Capacity errors and refusals move
 * to the next model without using up a retry; after the last one Gemma gets
 * the request on the same key, unless the key, its billing or the region is
 * what failed (Gemma would fail the same way). Anything else stops here and
 * goes to the app's own waiting and retries.
 */
export function nextGeminiStep(chain: string[], index: number, failure: GeminiFailure): GeminiStep {
  const current = chain[index]
  if (current === undefined || current === GEMMA_BACKUP_MODEL) return { action: 'stop' }
  if (!gemmaCanTakeOver(failure)) return { action: 'stop' }
  const capacity = failure.refused || (failure.status !== undefined && CAPACITY_STATUSES.includes(failure.status))
  const next = chain[index + 1]
  if (capacity && next !== undefined) return { action: 'model', model: next }
  const serverError = failure.status !== undefined && failure.status >= 500
  if ((capacity || serverError) && next === undefined) return { action: 'model', model: GEMMA_BACKUP_MODEL }
  return { action: 'stop' }
}

/** False when the key or the account is the problem (upstream gemmaCanTakeOver). */
function gemmaCanTakeOver(failure: GeminiFailure): boolean {
  if (failure.status === 401) return false
  // The status is left out: a 403 is often only "this model is not for this key".
  const kind = failureKind(failure.message.replace(/ \d{3}: /, ': '))
  return !['api_key_problem', 'account_blocked', 'geo_blocked', 'out_of_credits'].includes(kind)
}

/**
 * Remembers which models recently refused a key, so the next request starts
 * on one likely to answer instead of paying for the same refusals again
 * (upstream GeminiModelCooldowns). Kept in memory: a restart tries all again.
 */
export class GeminiCooldowns {
  private readonly until = new Map<string, number>()

  /** Records a refusal; `now` and the result are Unix seconds. */
  note(apiKey: string, model: string, status: number, body: string, now: number): void {
    const seconds = cooldownSeconds(status, body)
    if (seconds !== null) this.until.set(`${apiKey}|${model}`, now + seconds)
  }

  /** The chain without the models cooling down; the whole chain when all of them are. */
  usable(chain: string[], apiKey: string, now: number): string[] {
    const ready = chain.filter((m) => (this.until.get(`${apiKey}|${m}`) ?? 0) <= now)
    return ready.length ? ready : chain
  }
}

function cooldownSeconds(status: number, body: string): number | null {
  if (status === 429) {
    // A used-up daily quota does not come back in minutes; Gemini names it in the body.
    const lower = body.toLowerCase()
    return lower.includes('perday') || lower.includes('per day') || lower.includes('daily') ? 3600 : 600
  }
  if (status === 503) return 600
  // The model is not available to this key.
  if (status === 403 || status === 404) return 3600
  return null
}
