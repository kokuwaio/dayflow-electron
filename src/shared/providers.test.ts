import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from './types'
import { OLLAMA_BASE_URL, OLLAMA_MODEL, isLocalUrl, providerChoice } from './providers'

describe('isLocalUrl', () => {
  it('treats IPv6 loopback, unique-local and link-local hosts as local', () => {
    expect(isLocalUrl('http://[fd12:3456:789a::10]:11434/v1')).toBe(true)
    expect(isLocalUrl('http://[fe80::1]:11434/v1')).toBe(true)
    expect(isLocalUrl('http://[::1]:11434/v1')).toBe(true)
    expect(isLocalUrl('https://[2606:4700::1111]/v1')).toBe(false)
  })
})

describe('providerChoice (onboarding columns)', () => {
  const base = { openaiBaseUrl: DEFAULT_SETTINGS.openaiBaseUrl, models: DEFAULT_SETTINGS.models }

  it('presets Ollama and qwen3-vl:2b-instruct for local AI', () => {
    expect(providerChoice('local', 'openai', base)).toEqual({
      provider: 'openai',
      openaiBaseUrl: OLLAMA_BASE_URL,
      models: { ...DEFAULT_SETTINGS.models, openai: OLLAMA_MODEL }
    })
    expect(OLLAMA_MODEL).toBe('qwen3-vl:2b-instruct')
  })

  it('puts the API defaults back for a custom endpoint, but only over the Ollama presets', () => {
    const local = { openaiBaseUrl: OLLAMA_BASE_URL, models: { ...DEFAULT_SETTINGS.models, openai: OLLAMA_MODEL } }
    expect(providerChoice('endpoint', 'openai', local)).toEqual({ provider: 'openai', openaiBaseUrl: DEFAULT_SETTINGS.openaiBaseUrl, models: DEFAULT_SETTINGS.models })
    const typed = { openaiBaseUrl: 'https://openrouter.ai/api/v1', models: { ...DEFAULT_SETTINGS.models, openai: 'qwen/qwen3-vl' } }
    expect(providerChoice('endpoint', 'openai', typed)).toEqual({ provider: 'openai' })
  })

  it('only switches the provider for the others', () => {
    expect(providerChoice('gemini', 'gemini', base)).toEqual({ provider: 'gemini' })
  })
})
