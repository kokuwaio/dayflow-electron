import { describe, expect, it } from 'vitest'
import { sanitizeDailyProvider, standupPlan } from './daily-provider'
import type { ProviderKind } from './types'

const withKeys =
  (...kinds: ProviderKind[]) =>
  (k: ProviderKind) =>
    kinds.includes(k)

describe('which provider writes the Daily standup', () => {
  const timeline = { provider: 'anthropic', fallbackProvider: 'gemini' } as const

  it('by default uses the timeline providers in order, skipping those without a key', () => {
    expect(standupPlan('auto', timeline, withKeys('anthropic', 'gemini'))).toEqual({ kind: 'ok', providers: ['anthropic', 'gemini'] })
    expect(standupPlan('auto', timeline, withKeys('gemini'))).toEqual({ kind: 'ok', providers: ['gemini'] })
    expect(standupPlan('auto', { provider: 'anthropic', fallbackProvider: null }, withKeys())).toEqual({ kind: 'ok', providers: [] })
  })

  it('a chosen provider writes it alone, also when it is not the timeline provider', () => {
    expect(standupPlan('codex-cli', timeline, withKeys('anthropic', 'codex-cli'))).toEqual({ kind: 'ok', providers: ['codex-cli'] })
    expect(standupPlan('gemini', timeline, withKeys('anthropic', 'gemini'))).toEqual({ kind: 'ok', providers: ['gemini'] })
  })

  it('a chosen provider that lost its key is reported, not swapped for another', () => {
    expect(standupPlan('openai', timeline, withKeys('anthropic'))).toEqual({ kind: 'unavailable', provider: 'openai' })
  })

  it('"none" turns generation off', () => {
    expect(standupPlan('none', timeline, withKeys('anthropic'))).toEqual({ kind: 'off' })
  })

  it('reads unknown stored values as the default', () => {
    expect(sanitizeDailyProvider('claude-cli')).toBe('claude-cli')
    expect(sanitizeDailyProvider('none')).toBe('none')
    expect(sanitizeDailyProvider('dayflow')).toBe('auto')
    expect(sanitizeDailyProvider(undefined)).toBe('auto')
  })
})
