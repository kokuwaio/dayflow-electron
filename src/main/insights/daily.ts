// Generates the Daily standup, after upstream Dayflow
// (Core/AI/DailyRecapGenerator.swift, DailyRecapScheduler.swift).

import { SYSTEM_CATEGORY } from '../../shared/categories'
import { type StandupDraft, parseRecap, pickSourceDay } from '../../shared/daily'
import { formatClock } from '../../shared/day'
import type { StandupEntry, TimelineCard } from '../../shared/types'
import type { Store } from '../db/store'
import { languageForJson } from '../analysis/two-step-prompts'
import type { Provider } from '../providers/types'
import { EVIDENCE_RECAP_PROMPT, LOCAL_RECAP_PROMPT, SOL_EVIDENCE_RULES, recapPrompt } from './daily-prompts'
import { errorMessage } from '../../shared/errors'

/** Minimum minutes of cards on the summarized day: upstream's scheduler and manual thresholds. */
export const AUTO_MIN_MINUTES = 180
export const MANUAL_MIN_MINUTES = 120

/** "Timeline activities for {day}:", a blank line, then one numbered line per card (upstream's cardsText). */
function cardsText(day: string, cards: TimelineCard[]): string {
  const clock = (ts: number) => formatClock(ts).replace(' ', '').toLowerCase()
  const lines = cards.map((c, i) => {
    const title = c.title.trim() || 'Untitled activity'
    const summary = c.summary.trim()
    const head = `${i + 1}. ${clock(c.start)} - ${clock(c.end)}: ${title}`
    return summary && summary !== title ? `${head}\n   ${summary}` : head
  })
  return [`Timeline activities for ${day}:`, '', ...lines].join('\n')
}

/** Upstream gives the Claude CLI the "evidence" rules, Codex those plus extra checks, and everything else the "local" ones. */
function instructionsFor(provider: Provider): string {
  if (provider.kind === 'claude-cli') return EVIDENCE_RECAP_PROMPT
  if (provider.kind === 'codex-cli') return `${EVIDENCE_RECAP_PROMPT}\n\nAdditional evidence checks:\n${SOL_EVIDENCE_RULES}`
  return LOCAL_RECAP_PROMPT
}

export class NoSourceDayError extends Error {
  constructor() {
    super('Not enough captured activity in the previous 3 days to generate a standup.')
  }
}

/** The day a standup for `target` would summarize, or null when no recent day has enough activity. */
export const standupSourceDay = (store: Store, target: string, minMinutes: number): string | null =>
  pickSourceDay(target, (d) => store.cardMinutesOn(d), store.usedSourceDays(target), minMinutes)

/** Writes the standup for `target` from the best recent day; tries each provider in turn. */
export async function generateStandup(opts: {
  store: Store
  providers: Provider[]
  target: string
  language: string
  minMinutes: number
}): Promise<StandupEntry> {
  const { store, target } = opts
  const source = standupSourceDay(store, target, opts.minMinutes)
  if (!source) throw new NoSourceDayError()
  const cards = store.cardsForDay(source).filter((c) => c.category !== SYSTEM_CATEGORY)
  if (cards.length === 0) throw new NoSourceDayError()

  const errors: string[] = []
  for (const provider of opts.providers) {
    try {
      const prompt = recapPrompt(instructionsFor(provider), cardsText(source, cards), languageForJson(opts.language))
      const reply = await provider.generate({ turns: [{ role: 'user', parts: [{ type: 'text', text: prompt }] }], json: true })
      const recap = parseRecap(reply.text)
      // The view and the copy text show titles for the current date (standupTitles); these are upstream's stored defaults.
      const draft: StandupDraft = {
        highlightsTitle: "Yesterday's highlights",
        highlights: recap.highlights,
        tasksTitle: "Today's tasks",
        tasks: recap.next ? [recap.next] : [],
        blockersTitle: 'Blockers',
        blockersBody: ''
      }
      return { draft, sourceDay: source, provider: provider.kind, model: reply.model, generatedAt: Math.floor(Date.now() / 1000) }
    } catch (err) {
      errors.push(`${provider.model}: ${errorMessage(err)}`)
    }
  }
  throw new Error(errors.join(' · ') || 'No AI provider configured.')
}
