import type { ProviderKind } from '@shared/types'

/** The AI providers offered in Settings and onboarding. */
export const PROVIDER_CHOICES: Array<{ kind: ProviderKind; label: string; hint: string }> = [
  { kind: 'anthropic', label: 'Anthropic', hint: 'Claude models through the Anthropic API.' },
  { kind: 'gemini', label: 'Gemini', hint: 'Google Gemini API; frames are sent inline.' },
  { kind: 'openai', label: 'OpenAI-compatible', hint: 'OpenAI, OpenRouter, or a local Ollama or LM Studio server (no key needed; analyzed in small steps).' },
  { kind: 'claude-cli', label: 'Claude Code', hint: 'Your claude CLI and its subscription; no API key.' },
  { kind: 'codex-cli', label: 'Codex', hint: 'Your codex CLI and its ChatGPT subscription; no API key.' }
]
