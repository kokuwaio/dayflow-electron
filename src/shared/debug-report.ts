// The text behind Settings → Other → Support → "Copy debug logs", after
// upstream Utilities/DebugLogFormatter.swift: the latest timeline cards, LLM
// calls and analysis batches, plus facts about the app and the errors from
// our own log file. Unlike upstream it leaves out the request and response
// bodies of LLM calls (they carry screenshots and whole card texts) and hides
// API keys and the home folder, since the report is meant to be pasted into a
// public GitHub issue.

export interface DebugCard {
  day: string
  startTime: string
  endTime: string
  title: string
  summary: string | null
  category: string
  subcategory: string | null
  /** Unix seconds; null when unknown. */
  createdAt: number | null
}

export interface DebugLlmCall {
  createdAt: number | null
  provider: string
  model: string | null
  operation: string
  ok: boolean
  latencyMs: number | null
  httpStatus: number | null
  batchId: number | null
  attempt: number
  error: string | null
}

export interface DebugBatch {
  id: number
  /** Unix seconds. */
  start: number
  end: number
  status: string
  reason: string | null
  attempts: number
  createdAt: number | null
}

export interface DebugReportInput {
  createdAt: Date
  /** Facts about the app, in order; entries without a value are left out. */
  about: Array<[label: string, value: string | null | undefined]>
  cards: DebugCard[]
  llmCalls: DebugLlmCall[]
  batches: DebugBatch[]
  /** The newest lines of the log file, oldest first. */
  logLines: string[]
  /** The user's home folder, shown as ~. */
  home?: string
}

/** How many of each the app puts in the report. */
export const DEBUG_REPORT_LIMITS = { cards: 5, llmCalls: 20, batches: 10, logErrors: 30, logLines: 2000 }

const MAX_ERROR_CHARS = 500

const pad = (n: number) => String(n).padStart(2, '0')
/** Local wall-clock time, "2026-11-18 09:05:07". */
export function timestamp(at: Date): string {
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`
}
const stamp = (seconds: number | null) => (seconds === null ? 'unknown' : timestamp(new Date(seconds * 1000)))

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  // Headers and JSON fields: "Authorization: Bearer …", "x-api-key": "…"
  [/\b(authorization|x-api-key|x-goog-api-key|api-key|api_key)(["']?\s*[:=]\s*["']?)(?:Bearer\s+)?[^\s"',}&]+/gi, '$1$2[redacted]'],
  // URL parameters: ?key=…, &access_token=…
  [/([?&](?:key|api_key|apikey|access_token|token)=)[^&\s"']+/gi, '$1[redacted]'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/g, 'Bearer [redacted]'],
  // Google (AIza…), OpenAI and Anthropic (sk-…) keys anywhere else.
  [/\bAIza[0-9A-Za-z_-]{30,}/g, '[redacted]'],
  [/\bsk-[A-Za-z0-9_-]{16,}/g, '[redacted]']
]

/** Replaces API keys and tokens with [redacted], and the home folder with ~. */
export function redactSecrets(text: string, home?: string): string {
  let out = text
  for (const [pattern, replacement] of SECRET_PATTERNS) out = out.replace(pattern, replacement)
  if (home && home.length > 1) out = out.replaceAll(home, '~')
  return out
}

/** Collapses whitespace like upstream's cleaned(); null when nothing is left. */
function cleaned(value: string | null | undefined): string | null {
  const text = value?.replace(/\s+/g, ' ').trim()
  return text ? text : null
}

function cut(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

const ERROR_WORDS = /\b(errors?|fail(?:ed|ure|s)?|warning|could not|cannot|unable to|denied|exception|crash(?:ed)?)\b/i

/** The log lines that report a problem, the latest `limit` of them. */
export function recentErrors(lines: string[], limit: number): string[] {
  return lines.filter((line) => ERROR_WORDS.test(line)).slice(-limit)
}

function section<T>(title: string, items: T[], render: (item: T, index: number) => string[]): string {
  if (!items.length) return `--- ${title}: none ---`
  return [`--- ${title} (latest ${items.length}) ---`, ...items.flatMap(render)].join('\n')
}

export function formatDebugReport(input: DebugReportInput): string {
  const clean = (value: string | null | undefined) => {
    const text = cleaned(value)
    return text === null ? null : redactSecrets(text, input.home)
  }
  const sections: string[] = []

  sections.push(
    [
      '--- App ---',
      ...input.about.flatMap(([label, value]) => {
        const text = clean(value)
        return text === null ? [] : [`${label}: ${text}`]
      })
    ].join('\n')
  )

  sections.push(
    section('Timeline cards', input.cards, (card, i) => {
      let header = `${i + 1}. [${card.day}] ${card.startTime}-${card.endTime}`
      const title = clean(card.title)
      if (title) header += ` | ${title}`
      header += ` | ${card.category}`
      if (card.subcategory) header += ` / ${card.subcategory}`
      header += ` | created ${stamp(card.createdAt)}`
      const summary = clean(card.summary)
      return summary ? [header, `   Summary: ${summary}`] : [header]
    })
  )

  sections.push(
    section('LLM calls', input.llmCalls, (call, i) => {
      const parts = [stamp(call.createdAt), call.provider]
      if (call.model) parts.push(call.model)
      parts.push(call.operation, call.ok ? 'success' : 'failure')
      if (call.latencyMs !== null) parts.push(`${call.latencyMs}ms`)
      if (call.httpStatus !== null) parts.push(`HTTP ${call.httpStatus}`)
      const lines = [`${i + 1}. ${parts.join(' | ')}`]
      const context: string[] = []
      if (call.batchId !== null) context.push(`batch ${call.batchId}`)
      if (call.attempt > 1) context.push(`attempt ${call.attempt}`)
      if (context.length) lines.push(`   ${context.join(', ')}`)
      const error = clean(call.error)
      if (error) lines.push(`   Error: ${cut(error, MAX_ERROR_CHARS)}`)
      return lines
    })
  )

  sections.push(
    section('Analysis batches', input.batches, (batch, i) => {
      const lines = [
        `${i + 1}. id=${batch.id} | status=${batch.status} | attempts ${batch.attempts} | created ${stamp(batch.createdAt)}`,
        `   window: ${stamp(batch.start)} → ${stamp(batch.end)}`
      ]
      const reason = clean(batch.reason)
      if (reason) lines.push(`   reason: ${cut(reason, MAX_ERROR_CHARS)}`)
      return lines
    })
  )

  const errors = recentErrors(input.logLines, DEBUG_REPORT_LIMITS.logErrors).map((line) => redactSecrets(line, input.home))
  sections.push(section('Errors in the log', errors, (line) => [line]))

  return `Dayflow Electron debug report, ${timestamp(input.createdAt)}\n\n${sections.join('\n\n')}\n`
}
