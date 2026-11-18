import { describe, expect, it } from 'vitest'
import { GEMMA_BACKUP_MODEL, GeminiCooldowns, geminiChain, isGeminiPreset, nextGeminiStep } from './gemini-models'

describe('the Gemini model chain (upstream GeminiModelPreference)', () => {
  it('steps down from the chosen model to Flash-Lite, newest first', () => {
    expect(geminiChain('gemini-4-hydrogen')).toEqual([
      'gemini-4-hydrogen',
      'gemini-3.8-flash',
      'gemini-3.7-flash',
      'gemini-3.6-flash',
      'gemini-3.5-flash',
      'gemini-3.5-flash-lite'
    ])
    expect(geminiChain('gemini-3.6-flash')).toEqual(['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite'])
    expect(geminiChain('gemini-3.5-flash-lite')).toEqual(['gemini-3.5-flash-lite'])
  })

  it('keeps a custom model on its own: the user picked it on purpose', () => {
    expect(geminiChain('gemini-exp-1234')).toEqual(['gemini-exp-1234'])
    expect(geminiChain('  gemini-exp-1234 ')).toEqual(['gemini-exp-1234'])
    expect(isGeminiPreset('gemini-exp-1234')).toBe(false)
    expect(isGeminiPreset('gemini-3.7-flash')).toBe(true)
  })
})

describe('stepping down after a failure', () => {
  const chain = geminiChain('gemini-3.7-flash') // 3.7, 3.6, 3.5, 3.5-lite

  it('moves to the next model on a capacity error (403, 404, 429, 503) or a refusal', () => {
    expect(nextGeminiStep(chain, 0, { status: 429, message: 'Gemini API 429: Resource has been exhausted' })).toEqual({ action: 'model', model: 'gemini-3.6-flash' })
    expect(nextGeminiStep(chain, 1, { status: 503, message: 'Gemini API 503: The model is overloaded' })).toEqual({ action: 'model', model: 'gemini-3.5-flash' })
    expect(nextGeminiStep(chain, 2, { status: 404, message: 'Gemini API 404: models/x is not found for API version v1beta' })).toEqual({ action: 'model', model: 'gemini-3.5-flash-lite' })
    expect(nextGeminiStep(chain, 0, { refused: true, message: 'Gemini blocked the request (OTHER)' })).toEqual({ action: 'model', model: 'gemini-3.6-flash' })
  })

  it('hands the request to Gemma on the same key after the last model', () => {
    expect(nextGeminiStep(chain, 3, { status: 429, message: 'Gemini API 429: quota' })).toEqual({ action: 'model', model: GEMMA_BACKUP_MODEL })
    // Server errors skip the rest of the chain only at its end: Gemma takes over then too.
    expect(nextGeminiStep(chain, 3, { status: 500, message: 'Gemini API 500: internal error' })).toEqual({ action: 'model', model: GEMMA_BACKUP_MODEL })
  })

  it('stops when the key, the billing or the region is the problem: Gemma shares the key', () => {
    expect(nextGeminiStep(chain, 0, { status: 400, message: 'Gemini API 400: API key not valid. Please pass a valid API key.' })).toEqual({ action: 'stop' })
    expect(nextGeminiStep(chain, 0, { status: 401, message: 'Gemini API 401: unauthorized' })).toEqual({ action: 'stop' })
    expect(nextGeminiStep(chain, 3, { status: 403, message: 'Gemini API 403: Permission denied: Consumer has been suspended' })).toEqual({ action: 'stop' })
    expect(nextGeminiStep(chain, 3, { status: 400, message: 'Gemini API 400: User location is not supported for the API use.' })).toEqual({ action: 'stop' })
  })

  it('stops on errors another model would hit the same way', () => {
    // No connection: Gemma is behind the same address.
    expect(nextGeminiStep(chain, 0, { message: 'Gemini API unreachable: fetch failed' })).toEqual({ action: 'stop' })
    // A bad request is the app's, not the model's.
    expect(nextGeminiStep(chain, 0, { status: 400, message: 'Gemini API 400: Invalid JSON payload' })).toEqual({ action: 'stop' })
    // A server error in the middle of the chain is retried later, not stepped down.
    expect(nextGeminiStep(chain, 1, { status: 500, message: 'Gemini API 500: internal error' })).toEqual({ action: 'stop' })
  })

  it('stops after Gemma', () => {
    expect(nextGeminiStep([...chain, GEMMA_BACKUP_MODEL], 4, { status: 429, message: 'Gemini API 429: quota' })).toEqual({ action: 'stop' })
  })
})

describe('cooldowns (upstream GeminiModelCooldowns)', () => {
  const t0 = 1_000_000
  it('skips a model that refused for a while: 10 min for a busy model, an hour for a daily quota or a missing model', () => {
    const c = new GeminiCooldowns()
    const chain = geminiChain('gemini-3.7-flash')
    c.note('key', 'gemini-3.7-flash', 429, 'Quota exceeded for metric: generate_requests_per_minute', t0)
    expect(c.usable(chain, 'key', t0 + 60)).toEqual(chain.slice(1))
    expect(c.usable(chain, 'key', t0 + 10 * 60)).toEqual(chain)

    c.note('key', 'gemini-3.7-flash', 429, 'Quota exceeded for metric: GenerateRequestsPerDayPerProjectPerModel', t0)
    c.note('key', 'gemini-3.6-flash', 404, 'not found', t0)
    expect(c.usable(chain, 'key', t0 + 30 * 60)).toEqual(chain.slice(2))
    expect(c.usable(chain, 'key', t0 + 60 * 60)).toEqual(chain)
  })

  it('keeps quota per key, ignores other errors and never leaves nothing to try', () => {
    const c = new GeminiCooldowns()
    const chain = geminiChain('gemini-3.5-flash') // 3.5, 3.5-lite
    c.note('key', 'gemini-3.5-flash', 500, 'internal', t0)
    expect(c.usable(chain, 'key', t0)).toEqual(chain)
    c.note('key', 'gemini-3.5-flash', 503, 'overloaded', t0)
    expect(c.usable(chain, 'other key', t0)).toEqual(chain)
    c.note('key', 'gemini-3.5-flash-lite', 503, 'overloaded', t0)
    expect(c.usable(chain, 'key', t0)).toEqual(chain)
  })
})
