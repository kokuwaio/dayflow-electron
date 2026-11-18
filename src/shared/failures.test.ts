import { describe, expect, it } from 'vitest'
import { failureKind, needsUser } from './failures'

describe('failure kinds (upstream TimelineFailureClassifier)', () => {
  it('names problems only the user can fix', () => {
    expect(failureKind('Claude Code needs you to log in again: run claude /login. (Not logged in)')).toBe('provider_login_expired')
    expect(failureKind('Codex CLI was not found. Install it with "npm i -g @openai/codex".')).toBe('cli_not_installed')
    expect(failureKind('Anthropic API 401: invalid x-api-key')).toBe('api_key_problem')
    expect(failureKind('No API key set for https://api.openai.com/v1. Add one in Settings.')).toBe('api_key_problem')
    expect(failureKind('Ollama/LM Studio at http://localhost:11434/v1 unreachable: fetch failed')).toBe('local_engine_offline')
    expect(failureKind('Ollama/LM Studio at http://localhost:11434/v1 404: model "qwen3-vl:8b" not found')).toBe('local_model_missing')
    expect(failureKind('Claude Code usage limit reached: You\'ve hit your 5-hour limit')).toBe('usage_limit_hit')
    expect(failureKind('The app may not start programs outside its sandbox. To use agent CLIs, run "flatpak override ..."')).toBe('not_configured')
    expect(failureKind('No AI provider configured.')).toBe('not_configured')
  })

  it('leaves retries and bad replies to the app', () => {
    expect(failureKind('Anthropic API 529: overloaded')).toBe('transient')
    expect(failureKind("Card 1 'Fixing OAuth login' is only 8 minutes long")).toBe('model_flaky')
    expect(needsUser('transient')).toBe(false)
    expect(needsUser('model_flaky')).toBe(false)
    expect(needsUser('unknown')).toBe(false)
    expect(needsUser('api_key_problem')).toBe(true)
  })
})
