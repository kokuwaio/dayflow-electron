// The provider problem the user can help with, after upstream Dayflow
// (System/TimelineFailureToast.swift for the card and its actions,
// Core/AI/TimelineFailureClassifier.swift for the words,
// Core/AI/ProviderAvailability.swift for the waiting card). The toast, the
// tray, the notification and the waiting cards all read it.

import type { FailureKind } from './failures'
import { t } from './i18n'
import { cliOf, isLocalUrl } from './providers'
import type { CliName, ProviderKind } from './types'

/** "25 min", "3 hrs", "1 day"; null when nothing is waiting. */
export function waitingLabel(minutes: number): string | null {
  const m = Math.floor(minutes)
  if (m < 1) return null
  if (m < 60) return t('notifications.waitingMinutes', { count: m })
  if (m < 1440) return t('notifications.waitingHours', { count: Math.floor(m / 60) })
  return t('notifications.waitingDay')
}

/** A provider's name for people. */
export function providerLabel(kind: ProviderKind, openaiBaseUrl: string): string {
  switch (kind) {
    case 'anthropic':
      return 'Anthropic'
    case 'gemini':
      return 'Gemini'
    case 'openai':
      return isLocalUrl(openaiBaseUrl) ? 'Ollama/LM Studio' : t('providers.openai.label')
    case 'claude-cli':
      return 'Claude Code'
    case 'codex-cli':
      return 'Codex'
  }
}

/**
 * The fixes the card offers: signing a CLI back in, and another provider that
 * is already set up as the backup (when the primary is the one in trouble and
 * the backup is not that provider already).
 */
export function problemActions(
  problem: { kind: FailureKind; provider: ProviderKind },
  routing: { primary: ProviderKind; fallback: ProviderKind | null; configured: ProviderKind[] }
): { signIn: CliName | null; backup: ProviderKind | null } {
  const signIn = problem.kind === 'provider_login_expired' ? cliOf(problem.provider) : null
  const backup =
    problem.provider === routing.primary
      ? (routing.configured.find((k) => k !== routing.primary && k !== problem.provider && k !== routing.fallback) ?? null)
      : null
  return { signIn, backup }
}

/** The card's title and sentence; the error itself for problems without words of their own. */
export function problemTexts(kind: FailureKind, provider: string, message: string): { title: string; body: string } {
  switch (kind) {
    case 'provider_login_expired':
      return { title: t('waiting.problem.loginTitle', { provider }), body: t('waiting.problem.loginBody', { provider }) }
    case 'usage_limit_hit':
      return { title: t('waiting.problem.usageTitle', { provider }), body: t('waiting.problem.usageBody') }
    case 'local_engine_offline':
      return { title: t('waiting.problem.localTitle'), body: t('waiting.problem.localBody') }
    case 'api_key_problem':
      return { title: t('waiting.problem.keyTitle', { provider }), body: t('waiting.problem.keyBody') }
    case 'out_of_credits':
      return { title: t('waiting.problem.creditsTitle', { provider }), body: t('waiting.problem.creditsBody') }
    default:
      return { title: t('notifications.problem.title'), body: message }
  }
}

/** The title and summary of a waiting batch's card, in the app language. */
export function waitingCardTexts(reason: 'offline' | 'provider', kind: FailureKind, provider: string): { title: string; summary: string } {
  if (reason === 'offline') return { title: t('waiting.card.titleInternet'), summary: t('waiting.card.offline') }
  const title = t('waiting.card.titleProvider', { provider })
  switch (kind) {
    case 'provider_login_expired':
      return { title, summary: t('waiting.card.loginExpired', { provider }) }
    case 'usage_limit_hit':
      return { title, summary: t('waiting.card.usageLimit', { provider }) }
    case 'local_engine_offline':
      return { title, summary: t('waiting.card.localOffline') }
    default:
      return { title, summary: t('waiting.card.transient', { provider }) }
  }
}

/** The subcategory that tells a waiting batch's card from a "Processing failed" one (both are System cards). */
export const WAITING_SUBCATEGORY = 'Waiting'
