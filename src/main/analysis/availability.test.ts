import { describe, expect, it } from 'vitest'
import { ProviderHolds, batchOutcome, classifyFailure, holdDelaySec, waits } from './availability'

describe('classifying a provider error', () => {
  it('reads the HTTP status first: rate limits, timeouts and server errors are passing', () => {
    expect(classifyFailure({ message: 'Gemini API 429: Resource has been exhausted (e.g. check quota).', status: 429 })).toBe('transient')
    expect(classifyFailure({ message: 'Anthropic API 529: Overloaded', status: 529 })).toBe('transient')
    expect(classifyFailure({ message: 'OpenAI-compatible API 502: Bad gateway', status: 502 })).toBe('transient')
    expect(classifyFailure({ message: 'Anthropic API 408: request timeout', status: 408 })).toBe('transient')
  })

  it('keeps what the words say when they are more specific than the status', () => {
    expect(classifyFailure({ message: "OpenAI-compatible API 429: You've hit your usage limit", status: 429 })).toBe('usage_limit_hit')
    expect(classifyFailure({ message: 'Anthropic API 400: Your credit balance is too low', status: 400 })).toBe('out_of_credits')
    expect(classifyFailure({ message: 'Anthropic API 401: invalid x-api-key', status: 401 })).toBe('api_key_problem')
  })

  it('reads the app\'s own messages for errors without a status', () => {
    expect(classifyFailure({ message: 'Anthropic API unreachable: fetch failed' })).toBe('transient')
    expect(classifyFailure({ message: 'Claude Code needs you to log in again: run "claude" in a terminal and type /login. (Not logged in)' })).toBe('provider_login_expired')
    expect(classifyFailure({ message: 'Ollama/LM Studio at http://localhost:11434/v1 unreachable: fetch failed' })).toBe('local_engine_offline')
    expect(classifyFailure({ message: "The model's cards failed validation: Card 1 'Fixing OAuth login' is only 8 minutes long" })).toBe('model_flaky')
  })
})

describe('waiting instead of failing', () => {
  it('waits for problems that clear up on their own or with a sign-in', () => {
    expect(waits('transient')).toBe(true)
    expect(waits('usage_limit_hit')).toBe(true)
    expect(waits('provider_login_expired')).toBe(true)
    expect(waits('local_engine_offline')).toBe(true)
  })

  it('fails what retrying cannot fix: bad replies, bad keys, setup errors', () => {
    for (const kind of ['model_flaky', 'api_key_problem', 'out_of_credits', 'model_misconfigured', 'cli_not_installed', 'unknown'] as const) {
      expect(waits(kind), kind).toBe(false)
    }
  })
})

describe('what happens to a batch whose providers all failed', () => {
  const overloaded = { provider: 'anthropic' as const, message: 'Anthropic API 529: Overloaded', status: 529 }
  const signedOut = { provider: 'claude-cli' as const, message: 'Claude Code needs you to log in again: run "claude" in a terminal and type /login.' }
  const badKey = { provider: 'gemini' as const, message: 'Gemini API 400: API key not valid.', status: 400 }
  const badCards = { provider: 'anthropic' as const, message: "The model's cards failed validation: missing coverage" }

  it('waits for the internet while offline, whatever the cloud providers said', () => {
    expect(batchOutcome([badKey], false)).toEqual({ action: 'wait', reason: 'offline', provider: 'gemini', kind: 'transient' })
  })

  it('fails a local model\'s real error while offline: it needs no internet', () => {
    const local = { provider: 'openai' as const, local: true, message: 'Ollama/LM Studio at http://localhost:11434/v1 404: model not found', status: 404 }
    expect(batchOutcome([local], false)).toEqual({ action: 'fail', provider: 'openai', kind: 'local_model_missing' })
  })

  it('waits for the first provider that may come back: overloaded, rate-limited or signed out', () => {
    expect(batchOutcome([overloaded], true)).toEqual({ action: 'wait', reason: 'provider', provider: 'anthropic', kind: 'transient' })
    expect(batchOutcome([signedOut], true)).toEqual({ action: 'wait', reason: 'provider', provider: 'claude-cli', kind: 'provider_login_expired' })
    // The primary's key is bad, but the fallback is only busy: wait for the fallback.
    expect(batchOutcome([badKey, overloaded], true)).toEqual({ action: 'wait', reason: 'provider', provider: 'anthropic', kind: 'transient' })
  })

  it('fails when no provider can come back by itself, naming the primary\'s problem', () => {
    expect(batchOutcome([badCards], true)).toEqual({ action: 'fail', provider: 'anthropic', kind: 'model_flaky' })
    expect(batchOutcome([badKey, badCards], true)).toEqual({ action: 'fail', provider: 'gemini', kind: 'api_key_problem' })
  })
})

describe('holding a provider back (upstream ProviderHoldStore)', () => {
  const t0 = 1_000_000

  it('backs off a busy provider quickly, an account problem slowly', () => {
    expect([1, 2, 3, 4, 5, 6].map((n) => holdDelaySec('transient', n))).toEqual([60, 120, 300, 600, 900, 900])
    expect([1, 2, 3, 4].map((n) => holdDelaySec('provider_login_expired', n))).toEqual([900, 1800, 3600, 3600])
    expect(holdDelaySec('usage_limit_hit', 1)).toBe(900)
  })

  it('sends nothing to a held provider until its wait is over', () => {
    const holds = new ProviderHolds()
    expect(holds.ready('anthropic', t0)).toBe(true)
    holds.record('anthropic', 'transient', t0)
    expect(holds.ready('anthropic', t0 + 59)).toBe(false)
    expect(holds.ready('anthropic', t0 + 60)).toBe(true)
    expect(holds.ready('gemini', t0)).toBe(true)
  })

  it('waits longer after each failure in a row and remembers since when', () => {
    const holds = new ProviderHolds()
    holds.record('anthropic', 'transient', t0)
    holds.record('anthropic', 'transient', t0 + 60)
    expect(holds.hold('anthropic')).toMatchObject({ kind: 'transient', since: t0, failures: 2, nextAttemptAt: t0 + 60 + 120 })
  })

  it('lets every provider try again now, e.g. when the computer is back online or the window comes back', () => {
    const holds = new ProviderHolds()
    holds.record('claude-cli', 'provider_login_expired', t0)
    holds.allowNow(t0 + 5)
    expect(holds.ready('claude-cli', t0 + 5)).toBe(true)
    // The hold itself stays: a new failure backs off further.
    holds.record('claude-cli', 'provider_login_expired', t0 + 6)
    expect(holds.hold('claude-cli')?.nextAttemptAt).toBe(t0 + 6 + 1800)
  })

  it('lifts a hold after a success or a sign-in', () => {
    const holds = new ProviderHolds()
    holds.record('claude-cli', 'provider_login_expired', t0)
    expect(holds.clear('claude-cli')).toBe(true)
    expect(holds.clear('claude-cli')).toBe(false)
    expect(holds.ready('claude-cli', t0)).toBe(true)
  })
})
