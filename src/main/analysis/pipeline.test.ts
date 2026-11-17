import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Store } from '../db/store'
import { type GenerateRequest, type Provider, ProviderError, type ProviderKind } from '../providers/types'
import { Pipeline } from './pipeline'
import { DEFAULT_CATEGORIES } from './prompt'

const at = (h: number, m: number, s = 0) => new Date(2026, 10, 17, h, m, s).getTime() / 1000

/** A provider that answers from a script: each entry is a reply or an error to throw. */
function scriptedProvider(kind: ProviderKind, model: string, script: Array<string | Error>) {
  const requests: GenerateRequest[] = []
  const provider: Provider = {
    kind,
    model,
    local: false,
    async generate(request) {
      requests.push(request)
      const next = script.shift()
      if (next === undefined) throw new Error(`${model}: no scripted reply left`)
      if (next instanceof Error) throw next
      return { text: next, model }
    }
  }
  return { provider, requests }
}

const card = (startTime: string, endTime: string, title: string) =>
  ({ startTime, endTime, category: 'Work', subcategory: '', title, summary: 's', detailedSummary: 'd' })

let dir: string
let store: Store

/** 15 minutes of frames from 2:00 PM, every 10 s, written as files. */
function recordQuarterHour() {
  for (let t = at(14, 0); t <= at(14, 15); t += 10) {
    const file = join(dir, `${t}.jpg`)
    writeFileSync(file, 'jpeg')
    store.insertScreenshot({ capturedAt: t, filePath: file, fileSize: 4, idleSeconds: 0 })
  }
}

function pipelineWith(...providers: Provider[]) {
  return new Pipeline({
    store,
    providers: () => providers,
    categories: () => DEFAULT_CATEGORIES,
    language: () => '',
    onCardsChanged: () => {},
    log: () => {}
  })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: at(14, 18) * 1000 })
  dir = mkdtempSync(join(tmpdir(), 'dayflow-pipeline-'))
  store = Store.open(':memory:')
  recordQuarterHour()
})
afterEach(() => {
  vi.useRealTimers()
  store.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('Pipeline card generation', () => {
  it('turns a batch into the cards of a valid one-step reply', async () => {
    const primary = scriptedProvider('anthropic', 'claude', [JSON.stringify([card('2:00 PM', '2:16 PM', 'Wrote the pipeline')])])

    await pipelineWith(primary.provider).tick()

    expect(store.cardsForDay('2026-11-17')).toMatchObject([{ title: 'Wrote the pipeline', startTime: '2:00 PM', endTime: '2:16 PM' }])
    expect(primary.requests).toHaveLength(1)
  })

  it('hands the batch to the secondary provider when the primary fails', async () => {
    const primary = scriptedProvider('openai', 'qwen3-vl', [new ProviderError('OpenAI-compatible API unreachable: ECONNREFUSED', true)])
    const secondary = scriptedProvider('gemini', 'gemini', [JSON.stringify([card('2:00 PM', '2:16 PM', 'From the secondary')])])

    await pipelineWith(primary.provider, secondary.provider).tick()

    expect(store.cardsForDay('2026-11-17').map((c) => c.title)).toEqual(['From the secondary'])
    expect(store.pendingBatches()).toEqual([])
    expect(store.retryableBatches(0, 3)).toEqual([])
  })

  it('leaves one error card naming every provider when all of them fail', async () => {
    const primary = scriptedProvider('openai', 'qwen3-vl', [new ProviderError('unreachable', true)])
    const secondary = scriptedProvider('gemini', 'gemini', [new ProviderError('Gemini API 429: quota', true, 429)])

    await pipelineWith(primary.provider, secondary.provider).tick()

    const cards = store.cardsForDay('2026-11-17')
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({ title: 'Processing failed', category: 'System', start: at(14, 0), end: at(14, 15) })
    expect(cards[0]!.summary).toMatch(/qwen3-vl: unreachable.*gemini: Gemini API 429: quota/)
    expect(store.retryableBatches(0, 3)).toHaveLength(1)
  })
})

/** Which call of the card pipeline a request is, judged by its prompt. */
function callType(request: GenerateRequest): string {
  const text = request.turns.flatMap((t) => t.parts.flatMap((p) => (p.type === 'text' ? [p.text] : []))).join('\n')
  if (text.includes('INPUTS:')) return 'one-step'
  if (text.startsWith('Describe what you see')) return 'describe'
  if (text.includes('Group these snapshots')) return 'segments'
  if (text.includes('Create a summary that captures')) return 'summary'
  if (text.startsWith('Write one activity title')) return 'title'
  if (text.startsWith('Decide if two consecutive')) return 'merge-check'
  if (text.startsWith('Create a single activity card')) return 'merge-cards'
  return 'unknown'
}

/** A provider that answers each call type with a fixed reply and counts the calls. */
function respondingProvider(local: boolean, replies: Record<string, string>) {
  const calls: string[] = []
  const provider: Provider = {
    kind: 'openai',
    model: local ? 'qwen3-vl:8b' : 'gpt-x',
    local,
    async generate(request) {
      const type = callType(request)
      calls.push(type)
      const reply = replies[type]
      if (reply === undefined) throw new Error(`unexpected ${type} call`)
      return { text: reply, model: this.model }
    }
  }
  return { provider, calls }
}

const twoStepReplies = {
  describe: 'VS Code with pipeline.ts open, adding the two-step fallback.',
  segments: JSON.stringify({
    reasoning: 'one task',
    segments: [
      { startTimestamp: '00:00', endTimestamp: '08:00', description: 'Wrote the two-step code in VS Code' },
      { startTimestamp: '08:00', endTimestamp: '15:00', description: 'Ran Vitest in the terminal' }
    ]
  }),
  summary: JSON.stringify({ reasoning: 'r', summary: 'Built the two-step fallback and ran its tests.', category: 'work', app_sites: { primary: 'code.visualstudio.com' } }),
  title: 'Built the two-step fallback'
}

describe('Pipeline two-step path', () => {
  it('falls back to two steps when the one-step cards keep failing validation', async () => {
    const { provider, calls } = respondingProvider(false, { ...twoStepReplies, 'one-step': '[]' })

    await pipelineWith(provider).tick()

    expect(calls.filter((c) => c === 'one-step')).toHaveLength(3)
    expect(store.cardsForDay('2026-11-17')).toMatchObject([
      {
        title: 'Built the two-step fallback',
        summary: 'Built the two-step fallback and ran its tests.',
        category: 'Work',
        startTime: '2:00 PM',
        endTime: '2:15 PM',
        appSites: { primary: 'code.visualstudio.com' }
      }
    ])
    expect(store.cardsForDay('2026-11-17')[0]!.detailedSummary).toContain('Ran Vitest in the terminal')
    expect(store.retryableBatches(0, 3)).toEqual([])
  })

  it('goes straight to two steps for a local model', async () => {
    const { provider, calls } = respondingProvider(true, twoStepReplies)

    await pipelineWith(provider).tick()

    expect(calls).not.toContain('one-step')
    expect(calls.filter((c) => c === 'describe')).toHaveLength(15)
    expect(store.cardsForDay('2026-11-17').map((c) => c.title)).toEqual(['Built the two-step fallback'])
  })

  it('merges the new card into the previous one when the model says they are the same task', async () => {
    const earlier = store.createBatch({ start: at(13, 50), end: at(13, 59, 50), shotIds: [] })
    store.finishBatch(earlier, 'completed')
    store.replaceCards({ start: at(13, 50), end: at(14, 0) }, earlier, [
      { start: at(13, 50), end: at(14, 0), title: 'Planned the two-step fallback', category: 'Work', subcategory: '',
        summary: 'Read the upstream code.', detailedSummary: '1:50 PM - 2:00 PM: read upstream', distractions: [], appSites: {} }
    ])
    const { provider } = respondingProvider(true, {
      ...twoStepReplies,
      'merge-check': '{"combine": true, "reason": "same task"}',
      'merge-cards': '{"title": "Designed and built the two-step fallback", "summary": "Read upstream, then built it."}'
    })

    await pipelineWith(provider).tick()

    expect(store.cardsForDay('2026-11-17')).toMatchObject([
      { title: 'Designed and built the two-step fallback', startTime: '1:50 PM', endTime: '2:15 PM', category: 'Work' }
    ])
    expect(store.cardsForDay('2026-11-17')[0]!.detailedSummary).toMatch(/read upstream[\s\S]*Ran Vitest/)
  })

  it('keeps an overlapping previous card when the model says it is a different task', async () => {
    const earlier = store.createBatch({ start: at(13, 45), end: at(13, 59, 50), shotIds: [] })
    store.finishBatch(earlier, 'completed')
    // One-step cards end a minute after their last frame, so they overlap the next batch.
    store.replaceCards({ start: at(13, 45), end: at(14, 1) }, earlier, [
      { start: at(13, 45), end: at(14, 1), title: 'Answered support tickets', category: 'Work', subcategory: '',
        summary: 'Cleared the queue.', detailedSummary: '', distractions: [], appSites: {} }
    ])
    const { provider } = respondingProvider(true, { ...twoStepReplies, 'merge-check': '{"combine": false, "reason": "different"}' })

    await pipelineWith(provider).tick()

    expect(store.cardsForDay('2026-11-17')).toMatchObject([
      { title: 'Answered support tickets', startTime: '1:45 PM', endTime: '2:01 PM' },
      { title: 'Built the two-step fallback', startTime: '2:01 PM', endTime: '2:15 PM' }
    ])
  })

  it('does not delete a newer batch\'s card when an older batch is analyzed late', async () => {
    const newer = store.createBatch({ start: at(14, 15, 10), end: at(14, 30), shotIds: [] })
    store.finishBatch(newer, 'completed')
    store.replaceCards({ start: at(14, 14), end: at(14, 30) }, newer, [
      { start: at(14, 14), end: at(14, 30), title: 'Later work', category: 'Work', subcategory: '',
        summary: '', detailedSummary: '', distractions: [], appSites: {} }
    ])
    const { provider } = respondingProvider(true, twoStepReplies)

    await pipelineWith(provider).tick()

    expect(store.cardsForDay('2026-11-17').map((c) => c.title)).toContain('Later work')
  })
})
