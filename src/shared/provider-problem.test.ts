import { describe, expect, it } from 'vitest'
import { problemActions, problemTexts, providerLabel, waitingCardTexts, waitingLabel } from './provider-problem'

describe('how long recording has been waiting (upstream waitingText)', () => {
  it('reads in minutes, then hours, then one day', () => {
    expect(waitingLabel(0)).toBeNull()
    expect(waitingLabel(25)).toBe('25 min')
    expect(waitingLabel(60)).toBe('1 hr')
    expect(waitingLabel(185)).toBe('3 hrs')
    expect(waitingLabel(3000)).toBe('1 day')
  })
})

describe('what the problem card offers', () => {
  const routing = { primary: 'claude-cli' as const, fallback: null, configured: ['claude-cli', 'gemini', 'codex-cli'] as const }

  it('offers Sign in when a CLI provider is signed out, and another configured provider as backup', () => {
    expect(problemActions({ kind: 'provider_login_expired', provider: 'claude-cli' }, { ...routing, configured: [...routing.configured] })).toEqual({
      signIn: 'claude',
      backup: 'gemini'
    })
  })

  it('offers no Sign in for an API provider, whose fix is a key', () => {
    expect(problemActions({ kind: 'api_key_problem', provider: 'gemini' }, { primary: 'gemini', fallback: null, configured: ['gemini', 'anthropic'] })).toEqual({
      signIn: null,
      backup: 'anthropic'
    })
  })

  it('offers no backup that is already the fallback, nor one that is not set up', () => {
    expect(problemActions({ kind: 'usage_limit_hit', provider: 'codex-cli' }, { primary: 'codex-cli', fallback: 'gemini', configured: ['codex-cli', 'gemini'] })).toEqual({
      signIn: null,
      backup: null
    })
    expect(problemActions({ kind: 'provider_login_expired', provider: 'codex-cli' }, { primary: 'codex-cli', fallback: null, configured: ['codex-cli'] })).toEqual({
      signIn: 'codex',
      backup: null
    })
  })

  it('offers nothing when the fallback is the one in trouble: the primary is not', () => {
    expect(problemActions({ kind: 'provider_login_expired', provider: 'claude-cli' }, { primary: 'gemini', fallback: 'claude-cli', configured: ['gemini', 'claude-cli', 'anthropic'] })).toEqual({
      signIn: 'claude',
      backup: null
    })
  })
})

describe('the problem card\'s words (upstream TimelineFailureClassifier.toastContent)', () => {
  it('names the provider and what to do', () => {
    expect(problemTexts('provider_login_expired', 'Claude Code', 'raw')).toEqual({
      title: 'Claude Code is signed out',
      body: "Your Claude Code login expired, so recent activity hasn't been turned into cards yet."
    })
    expect(problemTexts('api_key_problem', 'Gemini', 'raw').title).toBe("Your Gemini API key isn't working")
  })

  it('falls back to the error itself for problems without their own words', () => {
    expect(problemTexts('cli_not_installed', 'Codex', 'Codex was not found. Install it with "npm install -g @openai/codex".')).toEqual({
      title: 'Dayflow Electron needs a hand',
      body: 'Codex was not found. Install it with "npm install -g @openai/codex".'
    })
  })
})

describe('the waiting card (upstream BatchHeldError)', () => {
  it('waits for the internet while offline', () => {
    expect(waitingCardTexts('offline', 'transient', 'Anthropic')).toEqual({
      title: 'Waiting for internet',
      summary: 'Recorded and saved. This computer was offline, so Dayflow Electron will make these cards when the internet is back.'
    })
  })

  it('waits for the provider and says why', () => {
    expect(waitingCardTexts('provider', 'provider_login_expired', 'Claude Code')).toEqual({
      title: 'Waiting for Claude Code',
      summary: 'Recorded and saved. Claude Code is signed out. Sign in again and Dayflow Electron catches up on its own.'
    })
    expect(waitingCardTexts('provider', 'transient', 'Gemini').summary).toBe('Recorded and saved. Gemini was busy or out of reach, so Dayflow Electron will try again on its own.')
  })
})

describe('provider names', () => {
  it('calls a local OpenAI-compatible server what it is', () => {
    expect(providerLabel('claude-cli', '')).toBe('Claude Code')
    expect(providerLabel('openai', 'http://localhost:11434/v1')).toBe('Ollama/LM Studio')
    expect(providerLabel('openai', 'https://api.openai.com/v1')).toBe('OpenAI-compatible')
  })
})
