// The analysis loop, after upstream AnalysisManager.swift and LLMService.swift:
// every minute, group new screenshots into batches and turn each batch into
// timeline cards. Card generation runs one batch at a time.

import { readFile } from 'node:fs/promises'
import type { Batch, NewCard, Store } from '../db/store'
import { type Provider, ProviderError } from '../providers/types'
import { BATCHING, planBatches } from './batching'
import { parseCards } from './cards'
import { assessIdleBatch } from './idle'
import { type Category, buildCardRequest, sampleEvenly, withCorrection } from './prompt'

const TICK_MS = 60_000
/** Screenshots older than this are never batched; failed batches older than this are not retried. */
const MAX_LOOKBACK_SEC = 24 * 3600
const MAX_ATTEMPTS_PER_CALL = 3
const MAX_BATCH_RETRIES = 3

export interface PipelineDeps {
  store: Store
  /** The configured provider, or a message saying why there is none. */
  provider(): Provider | string
  categories(): Category[]
  onCardsChanged(): void
  log(message: string): void
}

export interface PipelineStatus {
  busy: boolean
  lastRunAt: number | null
  lastError: string | null
}

const nowSec = () => Math.floor(Date.now() / 1000)

export class Pipeline {
  private timer: ReturnType<typeof setInterval> | null = null
  private busy = false
  private lastRunAt: number | null = null
  private lastError: string | null = null

  constructor(private readonly deps: PipelineDeps) {}

  start(): void {
    this.deps.store.resetInterruptedBatches()
    void this.tick()
    this.timer = setInterval(() => void this.tick(), TICK_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  status(): PipelineStatus {
    return { busy: this.busy, lastRunAt: this.lastRunAt, lastError: this.lastError }
  }

  /** Plans new batches and analyzes pending ones. Overlapping calls are skipped. */
  async tick(): Promise<void> {
    if (this.busy) return
    this.busy = true
    try {
      const { store } = this.deps
      const now = nowSec()
      for (const plan of planBatches(store.unbatchedScreenshots(now - MAX_LOOKBACK_SEC), now)) {
        store.createBatch(plan)
      }
      let succeeded = false
      for (const batch of store.pendingBatches()) {
        if ((await this.process(batch)) === 'completed') succeeded = true
      }
      if (succeeded) await this.retryFailed()
      this.lastRunAt = nowSec()
    } catch (err) {
      this.deps.log(`analysis tick failed: ${String(err)}`)
    } finally {
      this.busy = false
    }
  }

  /** After a success, retry failed batches oldest first and stop at the first new failure. */
  private async retryFailed(): Promise<void> {
    for (const batch of this.deps.store.retryableBatches(nowSec() - MAX_LOOKBACK_SEC, MAX_BATCH_RETRIES)) {
      if ((await this.process(batch)) !== 'completed') return
    }
  }

  private async process(batch: Batch): Promise<string> {
    const { store } = this.deps
    const shots = store.batchScreenshots(batch.id)
    const first = shots[0]
    const last = shots[shots.length - 1]
    if (!first || !last) {
      store.finishBatch(batch.id, 'failed_empty')
      return 'failed_empty'
    }
    if (last.capturedAt - first.capturedAt < BATCHING.minDurationSec) {
      store.finishBatch(batch.id, 'skipped_short')
      return 'skipped_short'
    }
    const span = { start: batch.start, end: batch.end }

    const idle = assessIdleBatch(shots)
    if (idle) {
      store.replaceCards(span, batch.id, [idleCard(span)], batch.start)
      store.finishBatch(batch.id, 'analyzed', 'idle_shortcut_applied')
      this.deps.onCardsChanged()
      return 'analyzed'
    }

    const provider = this.deps.provider()
    if (typeof provider === 'string') {
      // Nothing to do until a provider is configured; keep the batch pending.
      this.lastError = provider
      return 'pending'
    }

    store.startAttempt(batch.id)
    try {
      await this.generateCards(batch, provider, shots)
      store.finishBatch(batch.id, 'completed')
      this.lastError = null
      return 'completed'
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.lastError = message
      this.deps.log(`batch ${batch.id} failed: ${message}`)
      store.finishBatch(batch.id, 'failed', message)
      store.writeErrorCard(batch.id, span, message)
      return 'failed'
    } finally {
      this.deps.onCardsChanged()
    }
  }

  private async generateCards(batch: Batch, provider: Provider, shots: ReturnType<Store['batchScreenshots']>) {
    const { store } = this.deps
    const sampled = sampleEvenly(shots)
    const frames = await Promise.all(
      sampled.map(async (s) => ({ capturedAt: s.capturedAt, jpeg: await readFile(s.filePath) }))
    )
    const window = {
      start: Math.floor(sampled[0]!.capturedAt / 60) * 60,
      end: Math.floor(sampled[sampled.length - 1]!.capturedAt / 60) * 60 + 60
    }
    const lookbackStart = batch.end - BATCHING.cardLookbackSec
    const previousCards = store.contextCards({ start: lookbackStart, end: batch.end })
    const categories = this.deps.categories()

    let request = buildCardRequest({ frames, previousCards, window, categories })
    let lastIssue = ''
    for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_CALL; attempt++) {
      const started = Date.now()
      let text: string
      try {
        text = (await provider.generate(request)).text
      } catch (err) {
        store.logLlmCall({
          batchId: batch.id, attempt, provider: provider.kind, model: provider.model, operation: 'generate_cards',
          ok: false, latencyMs: Date.now() - started, error: String(err),
          ...(err instanceof ProviderError && err.status ? { httpStatus: err.status } : {})
        })
        throw err
      }
      const parsed = parseCards(text, {
        window,
        previous: previousCards.map((c) => ({ start: c.start, end: c.end })),
        categories: categories.map((c) => c.name)
      })
      store.logLlmCall({
        batchId: batch.id, attempt, provider: provider.kind, model: provider.model, operation: 'generate_cards',
        ok: parsed.ok, latencyMs: Date.now() - started, responseBody: text,
        ...(parsed.ok ? {} : { error: parsed.issue })
      })
      if (parsed.ok) {
        const range = { start: Math.min(lookbackStart, ...previousCards.map((c) => c.start)), end: Math.max(batch.end, window.end) }
        store.replaceCards(range, batch.id, parsed.cards)
        return
      }
      lastIssue = parsed.issue
      request = withCorrection(request, text, parsed.issue, window)
    }
    throw new Error(`The model's cards failed validation: ${lastIssue}`)
  }
}

function idleCard(span: { start: number; end: number }): NewCard {
  return {
    ...span,
    title: 'Idle',
    category: 'Idle',
    subcategory: '',
    summary: 'You were idle during this period.',
    detailedSummary: 'Idle period. Dayflow skipped activity summarization for this block.',
    distractions: [],
    appSites: {}
  }
}
