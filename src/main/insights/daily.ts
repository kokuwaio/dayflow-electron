// Generates the Daily standup, after upstream Dayflow
// (Core/AI/DailyRecapGenerator.swift, DailyRecapScheduler.swift).

import { SYSTEM_CATEGORY } from '../../shared/categories'
import { type StandupDraft, parseRecap, pickSourceDay } from '../../shared/daily'
import { formatClock, parseKey, shiftDay } from '../../shared/day'
import type { StandupEntry, TimelineCard } from '../../shared/types'
import type { Store } from '../db/store'
import { languageForJson } from '../analysis/two-step-prompts'
import type { Provider } from '../providers/types'
import { EVIDENCE_RECAP_PROMPT, LOCAL_RECAP_PROMPT, SOL_EVIDENCE_RULES, recapPrompt } from './daily-prompts'

/** Minimum minutes of cards on the summarized day: upstream's scheduler and manual thresholds. */
export const AUTO_MIN_MINUTES = 180
export const MANUAL_MIN_MINUTES = 120

/** "Today", "Yesterday", a weekday within the last week, else the date (upstream's labels). */
export function dayLabel(day: string, today: string): string {
  if (day === today) return 'Today'
  if (day === shiftDay(today, -1)) return 'Yesterday'
  const date = parseKey(day)
  for (let back = 2; back <= 6; back++) {
    if (day === shiftDay(today, -back)) return date.toLocaleDateString([], { weekday: 'long' })
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

/** "Timeline activities for {day}:" plus one numbered line per card (upstream's cardsText). */
function cardsText(day: string, cards: TimelineCard[]): string {
  const clock = (ts: number) => formatClock(ts).replace(' ', '')
  const lines = cards.map((c, i) => {
    const head = `${i + 1}. ${clock(c.start)} - ${clock(c.end)}: ${c.title || c.summary}`
    return c.summary && c.summary !== c.title ? `${head}\n   ${c.summary}` : head
  })
  return [`Timeline activities for ${day}:`, ...lines].join('\n')
}

/** Upstream gives local models and Gemini the "local" instructions, the others the "evidence" rules. */
function instructionsFor(provider: Provider): string {
  if (provider.local || provider.kind === 'gemini') return LOCAL_RECAP_PROMPT
  if (provider.kind === 'codex-cli') return `${EVIDENCE_RECAP_PROMPT}\n\nAdditional evidence checks:\n${SOL_EVIDENCE_RULES}`
  return EVIDENCE_RECAP_PROMPT
}

export class NoSourceDayError extends Error {
  constructor() {
    super('Not enough captured activity in the previous 3 days to generate a standup.')
  }
}

/** Writes the standup for `target` from the best recent day; tries each provider in turn. */
export async function generateStandup(opts: {
  store: Store
  providers: Provider[]
  target: string
  today: string
  language: string
  minMinutes: number
}): Promise<StandupEntry> {
  const { store, target } = opts
  const source = pickSourceDay(target, (d) => store.cardMinutesOn(d), store.usedSourceDays(target), opts.minMinutes)
  if (!source) throw new NoSourceDayError()
  const cards = store.cardsForDay(source).filter((c) => c.category !== SYSTEM_CATEGORY)

  const errors: string[] = []
  for (const provider of opts.providers) {
    try {
      const prompt = recapPrompt(instructionsFor(provider), cardsText(source, cards), languageForJson(opts.language))
      const reply = await provider.generate({ turns: [{ role: 'user', parts: [{ type: 'text', text: prompt }] }], json: true })
      const recap = parseRecap(reply.text)
      const draft: StandupDraft = {
        highlightsTitle: `Highlights from ${dayLabel(source, opts.today)}`,
        highlights: recap.highlights,
        tasksTitle: `Tasks for ${dayLabel(target, opts.today)}`,
        tasks: recap.next ? [recap.next] : [],
        blockersTitle: 'Blockers',
        blockersBody: ''
      }
      return { draft, sourceDay: source, provider: provider.kind, model: reply.model, generatedAt: Math.floor(Date.now() / 1000) }
    } catch (err) {
      errors.push(`${provider.model}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  throw new Error(errors.join(' · ') || 'No AI provider configured.')
}
