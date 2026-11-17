// Builds the one-step card request like upstream ClaudeProvider+Timeline.swift.

import { formatClock } from '../../shared/day'
import type { TimelineCard } from '../../shared/types'
import type { GenerateRequest, Part } from '../providers/types'
import {
  CARD_TEMPLATE,
  FRAMES_IRREGULAR,
  FRAMES_PER_MINUTE,
  NAME_GIVEN,
  NAME_MISSING,
  OUTPUT_BLOCK,
  SYSTEM_PROMPT,
  correctionPrompt
} from './prompt-template'

export interface Category {
  name: string
  description: string
  isIdle?: boolean
}

export const DEFAULT_CATEGORIES: Category[] = [
  { name: 'Work', description: 'Career, school, or productivity-focused activities (projects, emails, assignments, video calls, learning skills, etc.)' },
  { name: 'Personal', description: 'Purposeful non-work activities or life tasks (paying bills, fitness tracking, meal planning, personal research, creative hobbies, etc.)' },
  { name: 'Distraction', description: 'Passive consumption or aimless browsing (scrolling feeds, watching random videos, clicking through news, mindless games, etc.)' },
  { name: 'Idle', description: 'For when the user is idle for most of the time.', isIdle: true }
]

/** At most this many frames go to the model, evenly spaced. */
export const MAX_FRAMES = 15

export interface PromptFrame {
  /** Unix seconds. */
  capturedAt: number
  jpeg: Uint8Array
}

/** Evenly spaced pick of at most `max` items, always keeping the first and last. */
export function sampleEvenly<T>(items: readonly T[], max = MAX_FRAMES): T[] {
  if (items.length <= max) return [...items]
  return Array.from({ length: max }, (_, i) => items[Math.round((i * (items.length - 1)) / (max - 1))]!)
}

export function categoriesSection(categories: Category[]): string {
  if (categories.length === 0) {
    return 'USER CATEGORIES: No categories configured. Use consistent labels based on the activity story.'
  }
  const idle = categories.find((c) => c.isIdle)
  const lines = categories.map(
    (c, i) =>
      `${i + 1}. "${c.name}" — ${c.isIdle ? 'Use when the user is idle for more than half of this period.' : c.description}`
  )
  return [
    'USER CATEGORIES (choose exactly one label):',
    ...lines,
    ...(idle
      ? [`Only use "${idle.name}" when the user is idle for more than half of the timeframe. Otherwise pick the closest non-idle label.`]
      : []),
    `Return the category exactly as written. Allowed values: ${JSON.stringify(categories.map((c) => c.name))}.`
  ].join('\n')
}

/** One frame per minute: median gap of 45-90 s and no two frames in the same minute. */
function isOneFramePerMinute(frames: PromptFrame[]): boolean {
  if (frames.length < 2) return false
  const gaps = frames.slice(1).map((f, i) => f.capturedAt - frames[i]!.capturedAt).sort((a, b) => a - b)
  const median = gaps[Math.floor(gaps.length / 2)]!
  const minutes = new Set(frames.map((f) => Math.floor(f.capturedAt / 60)))
  return median >= 45 && median <= 90 && minutes.size === frames.length
}

function frameLabel(ts: number, withSeconds: boolean): string {
  if (!withSeconds) return formatClock(ts)
  const d = new Date(ts * 1000)
  const [hm, ampm] = formatClock(ts).split(' ')
  return `${hm}:${String(d.getSeconds()).padStart(2, '0')} ${ampm}`
}

export interface CardPromptInput {
  frames: PromptFrame[]
  previousCards: TimelineCard[]
  window: { start: number; end: number }
  categories: Category[]
  userName?: string
  language?: string
}

export function buildCardRequest(input: CardPromptInput): GenerateRequest {
  const perMinute = isOneFramePerMinute(input.frames)
  let template = CARD_TEMPLATE.replace('{{CATEGORIES}}', categoriesSection(input.categories)).replace(
    '{{LANGUAGE}}',
    input.language
      ? `The user only speaks ${input.language}. Respond in ${input.language}, but keep JSON keys in English exactly as specified. If any rule requires an exact English phrase (e.g., "Scattered apps and sites"), keep it verbatim.`
      : ''
  )
  if (!input.userName) template = template.replace(NAME_GIVEN, NAME_MISSING)
  if (!perMinute) template = template.replace(FRAMES_PER_MINUTE, FRAMES_IRREGULAR)

  const previous = input.previousCards.map((c) => ({
    startTime: c.startTime,
    endTime: c.endTime,
    category: c.category,
    subcategory: c.subcategory,
    title: c.title,
    summary: c.summary,
    detailedSummary: c.detailedSummary,
    distractions: c.distractions,
    appSites: c.appSites
  }))
  const text =
    template.trim() +
    '\n\nINPUTS:\n' +
    (input.userName ? `User: ${input.userName.replace(/\s+/g, ' ').trim()}\n` : '') +
    `Previous cards: ${JSON.stringify(previous)}\n` +
    `New screenshots: ${input.frames.length} frames, covering ${formatClock(input.window.start)} to ${formatClock(input.window.end)}. Each is attached below, labeled with its time.\n\n` +
    'Do not narrate or summarize individual frames before the answer.\n\n' +
    OUTPUT_BLOCK

  const parts: Part[] = [{ type: 'text', text }]
  for (const f of input.frames) {
    parts.push({ type: 'text', text: `Frame at ${frameLabel(f.capturedAt, !perMinute)}` })
    parts.push({ type: 'image', mediaType: 'image/jpeg', data: f.jpeg })
  }
  return { system: SYSTEM_PROMPT, turns: [{ role: 'user', parts }], json: true }
}

/** Appends the model's invalid answer and a correction request to the conversation. */
export function withCorrection(
  request: GenerateRequest,
  reply: string,
  issue: string,
  window: { start: number; end: number }
): GenerateRequest {
  return {
    ...request,
    turns: [
      ...request.turns,
      { role: 'assistant', parts: [{ type: 'text', text: reply }] },
      { role: 'user', parts: [{ type: 'text', text: correctionPrompt(issue, formatClock(window.start), formatClock(window.end)) }] }
    ]
  }
}
