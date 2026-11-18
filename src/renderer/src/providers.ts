import { t } from '@shared/i18n'
import type { ProviderKind } from '@shared/types'

/** The AI providers offered in Settings and Chat, in the current language (call while rendering). */
export const providerChoices = (): Array<{ kind: ProviderKind; label: string; hint: string }> => [
  { kind: 'anthropic', label: 'Anthropic', hint: t('providers.anthropic.hint') },
  { kind: 'gemini', label: 'Gemini', hint: t('providers.gemini.hint') },
  { kind: 'openai', label: t('providers.openai.label'), hint: t('providers.openai.hint') },
  { kind: 'claude-cli', label: 'Claude Code', hint: t('providers.claudeCli.hint') },
  { kind: 'codex-cli', label: 'Codex', hint: t('providers.codexCli.hint') }
]
