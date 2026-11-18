// What kind of problem an analysis error is, after upstream Dayflow
// (Core/AI/TimelineFailureClassifier.swift). Only the kinds a user has to fix
// are worth a notification; the app retries the others on its own.

export type FailureKind =
  | 'provider_login_expired'
  | 'cli_not_installed'
  | 'cli_outdated'
  | 'local_engine_offline'
  | 'local_model_missing'
  | 'api_key_problem'
  | 'usage_limit_hit'
  | 'out_of_credits'
  | 'geo_blocked'
  | 'account_blocked'
  | 'model_misconfigured'
  | 'not_configured'
  | 'transient'
  | 'model_flaky'
  | 'unknown'

/** Upstream's rules in upstream's order, plus the wording of this app's own errors. First match wins. */
const RULES: Array<[FailureKind, string[]]> = [
  // The app's own checks on a reply can quote a card title ("… 'Fixing OAuth login' is only 8 minutes long").
  ['model_flaky', ['minutes long', 'empty title', 'last segment', 'segment end time', 'segment out of bounds', 'missing coverage', 'gap detected', 'do not cover all', 'invalid duration']],
  ['provider_login_expired', ['could not be refreshed', 'log out and sign in', 'please run /login', 'run /login', 'not logged in', 'oauth', 'token has been revoked', 'authentication token', 'sso session', 'aws sso login', 'needs you to log in']],
  ['cli_not_installed', ['cli not found', 'enoent', 'was not found. install']],
  ['cli_outdated', ['requires a newer version of codex', 'newer version of codex']],
  ['model_misconfigured', ['is not supported when using codex with a chatgpt account', 'is not found for api version', 'not_found_error', 'cannot use this model']],
  ['local_engine_offline', ['ollama/lmstudio is running', 'unreachable']],
  ['local_model_missing', ['ollama api request failed with status 404', 'no models loaded', 'context size has been exceeded']],
  ['usage_limit_hit', ['hit your usage limit', 'hit your limit', 'usage limit', 'session limit', 'weekly limit', 'spend limit', 'accountquotaexceeded', 'usage quota', "you've hit your", 'you’ve hit your']],
  ['out_of_credits', ['prepayment credits', 'insufficient balance', 'spending cap', 'dunning', 'payment required', 'out of credits', 'credit balance', 'no credits left']],
  ['api_key_problem', ['api key not found', 'api key expired', 'has been suspended', 'api key not valid', 'invalid api key', 'service account', 'invalid x-api-key', 'no api key set']],
  ['geo_blocked', ['location is not supported']],
  ['account_blocked', ['denied access', 'organization has disabled', 'account is on hold']],
  ['not_configured', ['no llm provider configured', 'no ai provider configured', 'outside its sandbox']],
  ['transient', ['timed out', 'reconnecting', 'network connection', 'internet connection', 'tls error', 'ssl error', 'could not connect', 'unable to connect', 'connection refused', 'econnreset', 'enotfound', 'socket', 'hostname', '502', '503', '529', 'upstream', 'service unavailable', 'internal error', 'high demand', 'at capacity', 'quota exceeded', 'too many requests', 'overloaded', 'stream disconnected', 'message too long', 'cancelled']],
  ['model_flaky', ['failed to decode', 'be read because', 'failed to parse', 'reading additional input', 'failed to load', 'no stdout to parse']]
]

const LOCAL_SERVER = 'ollama/lm studio at '

export function failureKind(message: string): FailureKind {
  const lower = message.toLowerCase()
  const local = lower.includes(LOCAL_SERVER)
  // An HTTP status in "<label> 404: …" settles what the words cannot.
  const status = Number(/ (\d{3}): /.exec(lower)?.[1] ?? 0)
  if (local && status === 404) return 'local_model_missing'
  if (status === 401 || status === 403) return 'api_key_problem'
  for (const [kind, patterns] of RULES) {
    if (kind === 'local_engine_offline' && !local) continue
    if (patterns.some((p) => lower.includes(p))) return kind
  }
  return lower.includes('unreachable') ? 'transient' : 'unknown'
}

/** True for problems only the user can fix (upstream's actionable kinds). */
export const needsUser = (kind: FailureKind): boolean => !['transient', 'model_flaky', 'unknown'].includes(kind)
