import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Store } from '../db/store'
import { type GenerateRequest, type Provider, ProviderError, type ProviderKind } from '../providers/types'
import { Pipeline, type PipelineDeps } from './pipeline'
import { providerLabel } from '../../shared/provider-problem'
import { DEFAULT_CATEGORIES } from '../../shared/categories'
import jpeg from 'jpeg-js'
import { type OcrEngine, secretFilter } from '../privacy/masker'

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

/**
 * 15 minutes of frames from 2:00 PM, every 10 s, written as files. Frames
 * for which `blockedAt(t)` is true are placeholders, as when a password
 * manager was in front.
 */
function recordQuarterHour(blockedAt: (t: number) => boolean = () => false) {
  for (let t = at(14, 0); t <= at(14, 15); t += 10) {
    if (blockedAt(t)) {
      store.insertScreenshot({ capturedAt: t, filePath: '', fileSize: 0, idleSeconds: 0, blocked: true })
      continue
    }
    const file = join(dir, `${t}.jpg`)
    writeFileSync(file, 'jpeg')
    store.insertScreenshot({ capturedAt: t, filePath: file, fileSize: 4, idleSeconds: 0 })
  }
}

function pipelineWith(...providers: Provider[]) {
  return pipelineWithFilter(undefined, ...providers)
}

function pipelineWithFilter(prepareFrame: ((frame: Uint8Array) => Promise<Uint8Array>) | undefined, ...providers: Provider[]) {
  return pipelineWithDeps(prepareFrame ? { prepareFrame } : {}, ...providers)
}

function pipelineWithDeps(extra: Partial<PipelineDeps>, ...providers: Provider[]) {
  return new Pipeline({
    store,
    ...extra,
    providers: () => providers,
    categories: () => DEFAULT_CATEGORIES,
    providerLabel: (kind) => providerLabel(kind),
    language: () => '',
    overrides: () => ({ title: '', summary: '', detailedSummary: '' }),
    onCardsChanged: () => {},
    log: () => {}
  })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: at(14, 18) * 1000 })
  dir = mkdtempSync(join(tmpdir(), 'dayflow-pipeline-'))
  store = Store.open(':memory:')
})
afterEach(() => {
  vi.useRealTimers()
  store.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('Pipeline card generation', () => {
  beforeEach(() => recordQuarterHour())

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

  it('leaves one error card naming every provider when all of them fail for good', async () => {
    const primary = scriptedProvider('openai', 'gpt-x', [new ProviderError('OpenAI-compatible API 401: invalid api key', false, 401)])
    const secondary = scriptedProvider('gemini', 'gemini', [new ProviderError('Gemini API 400: API key not valid.', false, 400)])

    await pipelineWith(primary.provider, secondary.provider).tick()

    const cards = store.cardsForDay('2026-11-17')
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({ title: 'Processing failed', category: 'System', subcategory: 'Error', start: at(14, 0), end: at(14, 15) })
    expect(cards[0]!.summary).toMatch(/gpt-x: OpenAI-compatible API 401: invalid api key.*gemini: Gemini API 400: API key not valid/)
    expect(store.retryableBatches(0, 3)).toHaveLength(1)
    expect(store.waitingBatches()).toEqual([])
  })
})

describe('Pipeline waiting for a provider (upstream ProviderAvailability)', () => {
  beforeEach(() => recordQuarterHour())
  const reply = JSON.stringify([card('2:00 PM', '2:16 PM', 'Caught up')])

  it('waits instead of failing when the provider is busy, and uses up no retry', async () => {
    const primary = scriptedProvider('anthropic', 'claude', [new ProviderError('Anthropic API 529: Overloaded', true, 529)])

    await pipelineWith(primary.provider).tick()

    const cards = store.cardsForDay('2026-11-17')
    expect(cards).toMatchObject([{ title: 'Waiting for Anthropic', category: 'System', subcategory: 'Waiting', start: at(14, 0), end: at(14, 15) }])
    expect(cards[0]!.summary).toBe('Recorded and saved. Anthropic was busy or out of reach, so Dayflow Electron will try again on its own.')
    expect(store.waitingBatches()).toMatchObject([{ status: 'waiting', attempts: 0 }])
    expect(store.retryableBatches(0, 3)).toEqual([])
    expect(store.waitingSummary()).toEqual({ batches: 1, minutes: 15 })
  })

  it('sends nothing to a held provider: the next batch waits without a request, and both catch up once the hold is over', async () => {
    const limit = new ProviderError("Anthropic API 429: You've hit your usage limit", true, 429)
    const primary = scriptedProvider('anthropic', 'claude', [limit, reply, JSON.stringify([card('2:00 PM', '2:16 PM', 'Caught up'), card('2:16 PM', '2:32 PM', 'Second')])])
    const pipeline = pipelineWith(primary.provider)
    await pipeline.tick()

    for (let t = at(14, 16); t <= at(14, 31); t += 10) store.insertScreenshot({ capturedAt: t, filePath: join(dir, `${at(14, 0)}.jpg`), fileSize: 4, idleSeconds: 0 })
    vi.setSystemTime(at(14, 32, 30) * 1000)
    await pipeline.tick()
    expect(primary.requests).toHaveLength(1)
    expect(store.waitingSummary().batches).toBe(2)
    expect(store.cardsForDay('2026-11-17').map((c) => c.title)).toEqual(['Waiting for Anthropic', 'Waiting for Anthropic'])

    // A usage limit holds the provider for 15 minutes; then the waiting batches go out, oldest first.
    vi.setSystemTime(at(14, 34) * 1000)
    await pipeline.tick()
    expect(primary.requests).toHaveLength(3)
    expect(store.waitingBatches()).toEqual([])
    expect(store.cardsForDay('2026-11-17').map((c) => c.title)).toEqual(['Caught up', 'Second'])
  })

  it('waits for the internet while offline and asks no cloud provider', async () => {
    const primary = scriptedProvider('anthropic', 'claude', [reply])
    let online = false
    const pipeline = pipelineWithDeps({ online: () => online }, primary.provider)

    await pipeline.tick()
    expect(primary.requests).toHaveLength(0)
    expect(store.cardsForDay('2026-11-17')).toMatchObject([{ title: 'Waiting for internet', subcategory: 'Waiting' }])

    online = true
    await pipeline.resume()
    expect(primary.requests).toHaveLength(1)
    expect(store.cardsForDay('2026-11-17').map((c) => c.title)).toEqual(['Caught up'])
  })

  it('lets held batches go out right away on resume (back online, awake, signed in)', async () => {
    const primary = scriptedProvider('claude-cli', 'haiku', [
      new ProviderError('Claude Code needs you to log in again: run "claude" in a terminal and type /login. (Not logged in)', false),
      reply
    ])
    const pipeline = pipelineWith(primary.provider)
    await pipeline.tick()
    expect(store.cardsForDay('2026-11-17')).toMatchObject([{ title: 'Waiting for Claude Code' }])
    expect(pipeline.status().problem).toMatchObject({ kind: 'provider_login_expired', provider: 'claude-cli', waiting: true })

    await pipeline.tick()
    expect(primary.requests).toHaveLength(1)

    await pipeline.resume()
    expect(primary.requests).toHaveLength(2)
    expect(store.cardsForDay('2026-11-17').map((c) => c.title)).toEqual(['Caught up'])
    expect(pipeline.status().problem).toBeNull()
  })

  it('keeps the primary\'s problem when the backup did the work', async () => {
    const primary = scriptedProvider('codex-cli', 'gpt', [new ProviderError("Codex usage limit reached: You've hit your usage limit.", false)])
    const secondary = scriptedProvider('gemini', 'gemini', [reply])

    const pipeline = pipelineWith(primary.provider, secondary.provider)
    await pipeline.tick()

    expect(store.cardsForDay('2026-11-17').map((c) => c.title)).toEqual(['Caught up'])
    expect(pipeline.status().problem).toMatchObject({ kind: 'usage_limit_hit', provider: 'codex-cli', waiting: false })
  })

  it('still fails a batch whose replies stay invalid', async () => {
    const { provider } = respondingProvider(false, { 'one-step': '[]', describe: 'x', segments: 'not json', summary: 'x', title: 'x' })

    const pipeline = pipelineWith(provider)
    await pipeline.tick()

    expect(store.cardsForDay('2026-11-17')).toMatchObject([{ title: 'Processing failed', subcategory: 'Error' }])
    expect(store.waitingBatches()).toEqual([])
    expect(pipeline.status().problem).toBeNull()
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
  beforeEach(() => recordQuarterHour())

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

describe('Pipeline with blocked apps', () => {
  const frameLabels = (request: GenerateRequest) =>
    request.turns[0]!.parts.flatMap((p) => (p.type === 'text' && p.text.startsWith('Frame at ') ? [p.text] : []))

  it('writes one Private card without asking any model when every frame was blocked', async () => {
    recordQuarterHour(() => true)
    const primary = scriptedProvider('anthropic', 'claude', [])

    await pipelineWith(primary.provider).tick()

    expect(primary.requests).toHaveLength(0)
    expect(store.cardsForDay('2026-11-17')).toMatchObject([
      { title: 'Private', category: 'Private', startTime: '2:00 PM', endTime: '2:15 PM' }
    ])
    expect(store.pendingBatches()).toEqual([])
  })

  it('sends the model only the frames taken while no blocked app was in front', async () => {
    recordQuarterHour((t) => t < at(14, 7))
    const primary = scriptedProvider('anthropic', 'claude', [JSON.stringify([card('2:07 PM', '2:16 PM', 'After the vault')])])

    await pipelineWith(primary.provider).tick()

    const labels = frameLabels(primary.requests[0]!)
    expect(labels.length).toBeGreaterThan(0)
    expect(labels.every((l) => l >= 'Frame at 2:07')).toBe(true)
    expect(store.cardsForDay('2026-11-17')).toMatchObject([
      { title: 'Private', startTime: '2:00 PM', endTime: '2:07 PM' },
      { title: 'After the vault', startTime: '2:07 PM' }
    ])
  })

  it('shows blocked time at the end of a batch as Private too', async () => {
    recordQuarterHour((t) => t >= at(14, 10))
    const primary = scriptedProvider('anthropic', 'claude', [JSON.stringify([card('2:00 PM', '2:10 PM', 'Before the vault')])])

    await pipelineWith(primary.provider).tick()

    expect(store.cardsForDay('2026-11-17')).toMatchObject([
      { title: 'Before the vault', endTime: '2:10 PM' },
      { title: 'Private', startTime: '2:10 PM', endTime: '2:15 PM' }
    ])
  })
})

describe('Pipeline with secret masking', () => {
  /** A white 200x40 JPEG, like a recorded frame. */
  const white = jpeg.encode({ width: 200, height: 40, data: new Uint8Array(200 * 40 * 4).fill(255) }, 90).data
  const images = (request: GenerateRequest) =>
    request.turns.flatMap((t) => t.parts.flatMap((p) => (p.type === 'image' ? [p.data] : [])))
  const brightness = (image: Uint8Array, x: number, y: number) => {
    const { data, width } = jpeg.decode(image, { useTArray: true })
    const i = (y * width + x) * 4
    return (data[i]! + data[i + 1]! + data[i + 2]!) / 3
  }

  /** OCR that reads an API key at x 10..120 off every frame. */
  const ocr: OcrEngine = {
    async read() {
      return [{ words: [{ text: 'sk-proj-7Fq2xL9mWc4RbT', box: { x0: 10, y0: 10, x1: 120, y1: 30 } }] }]
    },
    async close() {}
  }

  beforeEach(() => {
    recordQuarterHour()
    for (const shot of store.unbatchedScreenshots(0)) writeFileSync(shot.filePath, white)
  })

  it('sends the model frames with the secrets blacked out and leaves the files as recorded', async () => {
    const primary = scriptedProvider('anthropic', 'claude', [JSON.stringify([card('2:00 PM', '2:16 PM', 'Masked')])])
    const files = store.unbatchedScreenshots(0).map((s) => s.filePath)

    await pipelineWithFilter(secretFilter(ocr, () => true), primary.provider).tick()

    const sent = images(primary.requests[0]!)
    expect(sent).toHaveLength(15)
    for (const image of sent) {
      expect(brightness(image, 60, 20)).toBeLessThan(20)
      expect(brightness(image, 180, 20)).toBeGreaterThan(235)
    }
    for (const file of files) expect(Buffer.compare(readFileSync(file), Buffer.from(white))).toBe(0)
  })

  it('masks each frame once per batch, even when the fallback provider takes over', async () => {
    const primary = scriptedProvider('openai', 'qwen3-vl', [new ProviderError('unreachable', true)])
    const secondary = scriptedProvider('gemini', 'gemini', [JSON.stringify([card('2:00 PM', '2:16 PM', 'From the secondary')])])
    let masked = 0
    const count = async (frame: Uint8Array) => {
      masked++
      return frame
    }

    await pipelineWithFilter(count, primary.provider, secondary.provider).tick()

    expect(masked).toBe(15)
    expect(store.cardsForDay('2026-11-17').map((c) => c.title)).toEqual(['From the secondary'])
  })

  it('sends nothing and fails the batch for a retry when masking fails', async () => {
    const primary = scriptedProvider('anthropic', 'claude', [JSON.stringify([card('2:00 PM', '2:16 PM', 'Unmasked')])])
    const broken = async (): Promise<Uint8Array> => {
      throw new Error('OCR worker crashed')
    }

    await pipelineWithFilter(broken, primary.provider).tick()

    expect(primary.requests).toHaveLength(0)
    const cards = store.cardsForDay('2026-11-17')
    expect(cards).toMatchObject([{ title: 'Processing failed' }])
    expect(cards[0]!.summary).toContain('Hiding secrets failed: OCR worker crashed')
    expect(store.retryableBatches(0, 3)).toHaveLength(1)
  })
})

describe('Pipeline idle shortcut', () => {
  /** Frames every 10 s in [from, to] while nobody touched the computer since a minute before 2:00 PM. */
  function recordIdle(from: number, to: number) {
    for (let t = from; t <= to; t += 10) store.insertScreenshot({ capturedAt: t, filePath: '', fileSize: 0, idleSeconds: t - at(14, 0) + 60 })
  }

  it('extends one Idle card over consecutive idle batches without asking a model, like upstream', async () => {
    const primary = scriptedProvider('anthropic', 'claude', [])
    recordIdle(at(14, 0), at(14, 15))
    await pipelineWith(primary.provider).tick()
    expect(store.cardsForDay('2026-11-17')).toMatchObject([{ title: 'Idle', startTime: '2:00 PM', endTime: '2:15 PM' }])

    recordIdle(at(14, 15, 10), at(14, 30))
    vi.setSystemTime(at(14, 33) * 1000)
    await pipelineWith(primary.provider).tick()

    expect(store.cardsForDay('2026-11-17')).toMatchObject([{ title: 'Idle', startTime: '2:00 PM', endTime: '2:30 PM' }])
    expect(primary.requests).toHaveLength(0)
  })
})
