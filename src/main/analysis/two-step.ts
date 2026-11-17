// Two-step card generation, after upstream's local-model path
// (OllamaProvider+Transcription.swift, OllamaProvider+Summaries.swift):
// 1. describe each sampled frame in its own small request, then group the
//    descriptions into 2-5 timed observations;
// 2. write one card from the observations with short text-only calls
//    (summary, title) and merge it into the previous card when the model
//    says they are the same task.
// Small local models handle these short requests far better than the
// one-step prompt with 15 images.

import { formatClock } from '../../shared/day'
import type { TimelineCard } from '../../shared/types'
import type { NewCard, Span } from '../db/store'
import { type GenerateRequest, type Provider, ProviderError } from '../providers/types'
import { normalizeCategory } from './cards'
import { type Observation, parseSegments } from './observations'
import type { Category, PromptFrame } from './prompt'
import { jsonObject } from './json'
import * as prompts from './two-step-prompts'

const JSON_ATTEMPTS = 3
const SEGMENT_ATTEMPTS = 2
/** Merge only into a previous card that ended at most this long before the new one. */
const MERGE_MAX_GAP_SEC = 5 * 60
/** Never merge into a card that is already this long... */
const MERGE_MAX_PREVIOUS_SEC = 40 * 60
/** ...or when the merged card would be longer than this. */
const MERGE_MAX_TOTAL_SEC = 60 * 60
/** Assumed length of a frame when observations fall back to one per frame. */
const FRAME_SEC = 10

const textRequest = (prompt: string, json: boolean): GenerateRequest => ({
  system: json ? prompts.JSON_SYSTEM : prompts.TEXT_SYSTEM,
  turns: [{ role: 'user', parts: [{ type: 'text', text: prompt }] }],
  json
})

const mmss = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.round(sec % 60)).padStart(2, '0')}`

/** Step 1: frames to observations. Throws when no frame could be described. */
export async function transcribe(provider: Provider, frames: PromptFrame[]): Promise<Observation[]> {
  const described: Array<{ at: number; text: string }> = []
  let lastError: unknown = null
  for (const frame of frames) {
    try {
      const reply = await provider.generate({
        system: prompts.TEXT_SYSTEM,
        turns: [
          {
            role: 'user',
            parts: [
              { type: 'text', text: prompts.DESCRIBE_FRAME_PROMPT },
              { type: 'image', mediaType: 'image/jpeg', data: frame.jpeg }
            ]
          }
        ]
      })
      const text = reply.text.trim()
      if (text) described.push({ at: frame.capturedAt, text })
    } catch (err) {
      lastError = err
      // An unreachable server will not answer the next frame either.
      if (err instanceof ProviderError && err.retryable && err.status === undefined) break
    }
  }
  const first = described[0]
  const last = described[described.length - 1]
  if (!first || !last) throw lastError instanceof Error ? lastError : new Error('No screenshot could be described.')

  const recording = { start: first.at, durationSec: last.at - first.at }
  const perFrame = described.map((d, i) => ({
    start: d.at,
    end: Math.max(d.at + 1, Math.min(d.at + FRAME_SEC, described[i + 1]?.at ?? d.at + FRAME_SEC)),
    text: d.text
  }))
  if (recording.durationSec < 60) return perFrame

  const lines = described.map((d) => `[${mmss(d.at - first.at)}] ${d.text}\n`).join('')
  const base = prompts.segmentPrompt(described.length, mmss(recording.durationSec), lines)
  let prompt = base
  for (let attempt = 1; attempt <= SEGMENT_ATTEMPTS; attempt++) {
    const reply = await provider.generate(textRequest(prompt, true))
    const parsed = parseSegments(reply.text, recording)
    if (parsed.ok) return parsed.observations
    prompt =
      base +
      (parsed.coverage !== undefined
        ? prompts.segmentRetryCoverage(Math.round(parsed.coverage * 100), mmss(recording.durationSec))
        : prompts.segmentRetryInvalid(parsed.issue))
  }
  // Like upstream: keep the frame descriptions rather than losing the batch.
  return perFrame
}

/** A reader's verdict on a reply: the value, or what to tell the model on retry. */
type Parsed<T> = { value: T } | { issue: string }

/** Asks until `read` accepts the reply, adding the issue to the prompt each retry. */
async function askUntilValid<T>(
  provider: Provider,
  prompt: string,
  json: boolean,
  retryInstruction: string,
  read: (reply: string) => Parsed<T>
): Promise<T> {
  let current = prompt
  let issue = ''
  for (let attempt = 1; attempt <= JSON_ATTEMPTS; attempt++) {
    const reply = (await provider.generate(textRequest(current, json))).text
    const result = read(reply)
    if ('value' in result) return result.value
    issue = result.issue
    current = prompt + prompts.retrySuffix(issue, retryInstruction)
  }
  throw new Error(`The model gave no usable answer: ${issue}`)
}

const trimmed = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

function readTitle(reply: string): string {
  const firstLine = reply.trim().split('\n')[0] ?? ''
  return firstLine.replace(/^title:\s*/i, '').replace(/^["'“”]+|["'“”]+$/g, '').trim()
}

const withoutUser = (text: string) => text.replace(/\b(the|a) user\b\s*/gi, '').trim()

export interface TwoStepCard {
  card: NewCard
  /** The time the card replaces: its own span, or the merged previous card's too. */
  span: Span
}

/** Step 2: observations to one card, merged into `previous` when it is the same task. */
export async function cardFromObservations(
  provider: Provider,
  observations: Observation[],
  categories: Category[],
  language: string,
  previous: TimelineCard | null
): Promise<TwoStepCard> {
  const names = categories.map((c) => c.name)
  const timed = observations.map((o) => `[${formatClock(o.start)} - ${formatClock(o.end)}]: ${withoutUser(o.text)}`).join('\n\n')
  const categoryLines = categories
    .map((c) => {
      const description = c.description || (c.isIdle ? 'Use when the user is idle for most of the period.' : '')
      return description ? `- "${c.name}" — ${description}` : `- "${c.name}"`
    })
    .join('\n')
  const jsonLanguage = language ? `\n\n${prompts.languageForJson(language)}` : ''

  const summary = await askUntilValid<{ summary: string; category: string; appSites: TimelineCard['appSites'] }>(
    provider,
    prompts.summaryPrompt(timed, categoryLines, names.map((n) => `"${n}"`).join(', '), jsonLanguage),
    true,
    prompts.SUMMARY_RETRY,
    (reply) => {
      const o = jsonObject(reply)
      if (!o || !trimmed(o.summary)) return { issue: 'missing "summary"' }
      const sites = (o.app_sites ?? {}) as Record<string, unknown>
      return {
        value: {
          summary: trimmed(o.summary),
          category: normalizeCategory(o.category, names),
          appSites: {
            ...(trimmed(sites.primary) ? { primary: trimmed(sites.primary) } : {}),
            ...(trimmed(sites.secondary) ? { secondary: trimmed(sites.secondary) } : {})
          }
        }
      }
    }
  )
  const title = await askUntilValid<string>(
    provider,
    prompts.titlePrompt(
      observations.map((o) => `- ${o.text.trim()}`).join('\n'),
      language ? `\n\n${prompts.languageForText(language)}` : ''
    ),
    false,
    prompts.TITLE_RETRY,
    (reply) => {
      const title = readTitle(reply)
      return title ? { value: title } : { issue: 'empty title' }
    }
  )

  const first = observations[0]!
  const last = observations[observations.length - 1]!
  const card: NewCard = {
    start: first.start,
    end: last.end,
    title,
    summary: summary.summary,
    category: summary.category,
    subcategory: '',
    detailedSummary: observations.map((o) => `${formatClock(o.start)} - ${formatClock(o.end)}: ${o.text}`).join('\n'),
    distractions: [],
    appSites: summary.appSites
  }

  // Without a merge the new card starts where the previous one ends, so the
  // replace below never deletes it.
  const unmerged = (): TwoStepCard => {
    const start = previous && previous.end > card.start && previous.end < card.end ? previous.end : card.start
    return { card: { ...card, start }, span: { start, end: card.end } }
  }
  const mergeable =
    previous &&
    card.start - previous.end <= MERGE_MAX_GAP_SEC &&
    previous.end - previous.start < MERGE_MAX_PREVIOUS_SEC &&
    card.end - previous.start <= MERGE_MAX_TOTAL_SEC
  if (!previous || !mergeable) return unmerged()

  const prevText = { startTime: previous.startTime, endTime: previous.endTime, title: previous.title, summary: previous.summary }
  const nextText = { startTime: formatClock(card.start), endTime: formatClock(card.end), title: card.title, summary: card.summary }
  const combine = await askUntilValid<boolean>(provider, prompts.mergeCheckPrompt(prevText, nextText), true, 'Return ONLY the JSON object described above with "reason" and "combine" fields.', (reply) => {
    const o = jsonObject(reply)
    return o && typeof o.combine === 'boolean' ? { value: o.combine } : { issue: 'missing boolean "combine"' }
  }).catch(() => false) // when unsure, do not merge
  if (!combine) return unmerged()

  const merged = await askUntilValid<{ title: string; summary: string }>(
    provider,
    prompts.mergeCardsPrompt(prevText, nextText, prompts.languageForJson(language)),
    true,
    'Respond with ONLY the JSON object described above containing merged "title" and "summary" fields.',
    (reply) => {
      const o = jsonObject(reply)
      return o && trimmed(o.title) && trimmed(o.summary)
        ? { value: { title: trimmed(o.title), summary: trimmed(o.summary) } }
        : { issue: 'missing "title" or "summary"' }
    }
  ).catch(() => null)
  if (!merged) return unmerged()

  return {
    card: {
      start: previous.start,
      end: card.end,
      title: merged.title,
      summary: merged.summary,
      category: previous.category,
      subcategory: previous.subcategory,
      detailedSummary: [previous.detailedSummary, card.detailedSummary].filter(Boolean).join('\n'),
      distractions: previous.distractions,
      appSites: previous.appSites.primary ? previous.appSites : card.appSites
    },
    span: { start: previous.start, end: card.end }
  }
}
