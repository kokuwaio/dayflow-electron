// The analysis loop, after upstream AnalysisManager.swift and LLMService.swift:
// every minute, group new screenshots into batches and turn each batch into
// timeline cards. Card generation runs one batch at a time. A batch whose
// providers are offline, busy or signed out waits instead of failing
// (upstream ProviderAvailability.swift, see ./availability.ts) and goes out
// again by itself.

import { readFile } from 'node:fs/promises'
import type { PromptOverrides } from '../../shared/types'
import type { Batch, NewCard, Screenshot, Store } from '../db/store'
import { type Provider, ProviderError } from '../providers/types'
import { BATCHING, planBatches } from './batching'
import { parseCards } from './cards'
import { assessIdleBatch, idleCardSpan } from './idle'
import { type Category, PRIVATE_CATEGORY, idleCategory } from '../../shared/categories'
import { type PromptFrame, buildCardRequest, sampleEvenly, withCorrection } from './prompt'
import { cardFromObservations, transcribe } from './two-step'
import { errorMessage } from '../../shared/errors'
import { type FailureKind, needsUser } from '../../shared/failures'
import { providerLabel, waitingCardTexts } from '../../shared/provider-problem'
import type { ProviderKind } from '../../shared/types'
import { type BatchOutcome, type ProviderFailure, ProviderHolds, batchOutcome, classifyFailure, waits } from './availability'

const TICK_MS = 60_000
/** Screenshots older than this are never batched; failed batches older than this are not retried. */
const MAX_LOOKBACK_SEC = 24 * 3600
const MAX_ATTEMPTS_PER_CALL = 3
const MAX_BATCH_RETRIES = 3

export interface PipelineDeps {
  store: Store
  /** Configured providers, primary first, or a message saying why there are none. */
  providers(): Provider[] | string
  categories(): Category[]
  /** Output language for card text; empty for English. */
  language(): string
  /** The user's replacements for the prompt's title, summary and detail rules. */
  overrides(): PromptOverrides
  onCardsChanged(): void
  log(message: string): void
  /**
   * Runs on each frame sent to a provider, e.g. to hide secrets in it; the
   * file on disk stays as recorded. A throw fails the batch, so no frame goes
   * out unfiltered.
   */
  prepareFrame?(jpeg: Uint8Array): Promise<Uint8Array>
  /** False while the computer has no network; batches for cloud providers wait then. */
  online?(): boolean
  /** A provider's name on waiting cards, e.g. "Claude Code". */
  providerLabel?(kind: ProviderKind): string
}

/** A provider problem the user can fix, before the app adds what it can offer. */
export interface PipelineProblem {
  kind: FailureKind
  provider: ProviderKind
  message: string
  /** Batches wait for it (true) or the backup works around it (false). */
  waiting: boolean
}

export interface PipelineStatus {
  busy: boolean
  lastRunAt: number | null
  lastError: string | null
  problem: PipelineProblem | null
}

type Wait = Extract<BatchOutcome, { action: 'wait' }>

/** Every provider failed this batch; one entry per provider, primary first. */
class AllProvidersFailed extends Error {
  constructor(
    readonly failures: ProviderFailure[],
    models: string[]
  ) {
    super(failures.map((f, i) => `${models[i]}: ${f.message}`).join(' · '))
  }
}

const nowSec = () => Math.floor(Date.now() / 1000)

export class Pipeline {
  private timer: ReturnType<typeof setInterval> | null = null
  private busy = false
  private runAgain = false
  private lastRunAt: number | null = null
  private lastError: string | null = null
  private problem: PipelineProblem | null = null
  private readonly holds = new ProviderHolds()

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
    return { busy: this.busy, lastRunAt: this.lastRunAt, lastError: this.lastError, problem: this.problem }
  }

  /**
   * Lets waiting batches go out now: the internet or the computer is back, the
   * window came to the front. `fixed` also forgets the holds and the problem
   * (a sign-in, changed provider settings).
   */
  resume(fixed = false): Promise<void> {
    if (fixed) {
      this.holds.clearAll()
      this.problem = null
    } else {
      this.holds.allowNow(nowSec())
    }
    return this.tick()
  }

  /** Plans new batches and analyzes pending ones. A call while busy runs again right after. */
  async tick(): Promise<void> {
    if (this.busy) {
      this.runAgain = true
      return
    }
    this.busy = true
    try {
      const { store } = this.deps
      const now = nowSec()
      for (const plan of planBatches(store.unbatchedScreenshots(now - MAX_LOOKBACK_SEC), now)) {
        store.createBatch(plan)
      }
      let succeeded = false
      // Waiting batches go out with the new ones, oldest first.
      const batches = [...store.waitingBatches(), ...store.pendingBatches()].sort((a, b) => a.start - b.start)
      for (const batch of batches) {
        // A batch that still has nothing to go to keeps its waiting card as it is.
        if (batch.status === 'waiting' && this.blocked() !== null) continue
        if ((await this.process(batch)) === 'completed') succeeded = true
      }
      if (succeeded) await this.retryFailed()
      this.lastRunAt = nowSec()
    } catch (err) {
      this.deps.log(`analysis tick failed: ${String(err)}`)
    } finally {
      this.busy = false
      if (this.runAgain) {
        this.runAgain = false
        void this.tick()
      }
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
      // Its frames went (storage limit) while it waited: the waiting card would stay forever.
      if (batch.status === 'waiting') store.writeErrorCard(batch.id, { start: batch.start, end: batch.end }, 'The screenshots were removed before they could be analyzed.')
      return 'failed_empty'
    }
    if (last.capturedAt - first.capturedAt < BATCHING.minDurationSec) {
      store.finishBatch(batch.id, 'skipped_short')
      return 'skipped_short'
    }
    const span = { start: batch.start, end: batch.end }

    // Placeholders of blocked apps never reach a model.
    const visible = shots.filter((s) => !s.blocked)
    if (visible.length === 0) {
      store.replaceCards(span, batch.id, [privateCard(span)], batch.start)
      store.finishBatch(batch.id, 'analyzed', 'blocked_app')
      this.deps.onCardsChanged()
      return 'analyzed'
    }

    const idle = assessIdleBatch(shots)
    // Like upstream: extend an Idle card that just ended, else a new one in whole minutes.
    const categories = this.deps.categories()
    const firstShot = Math.min(...shots.map((s) => s.capturedAt))
    const idleSpan = idle ? idleCardSpan(shots, store.cardEndingLastBefore(firstShot, batch.id), categories) : null
    if (idleSpan) {
      const { start, end, extend } = idleSpan
      if (extend === null || !store.extendCard(extend, end, batch.id)) {
        // A card that is gone by now cannot be extended: a new one from this batch's own start.
        const own = extend === null ? { start, end } : idleCardSpan(shots, null)
        if (own) store.replaceBatchCards(batch.id, [idleCard({ start: own.start, end: own.end }, idleCategory(categories)?.name ?? 'Idle')])
      }
      store.finishBatch(batch.id, 'analyzed', 'idle_shortcut_applied')
      this.deps.onCardsChanged()
      return 'analyzed'
    }

    const providers = this.deps.providers()
    if (typeof providers === 'string' || providers.length === 0) {
      // Nothing to do until a provider is configured; keep the batch pending.
      this.lastError = typeof providers === 'string' ? providers : 'No AI provider configured.'
      return 'pending'
    }

    const blocked = this.blocked(providers)
    if (blocked) {
      // Nothing to send to: the batch waits without a request (upstream waitReason).
      this.wait(batch, span, blocked, false)
      return 'waiting'
    }
    const ready = this.readyProviders(providers)

    store.startAttempt(batch.id)
    try {
      const used = await this.generateWithFailover(batch, ready, visible)
      for (const span of blockedEdges(shots, visible)) store.addCards(batch.id, [privateCard(span)])
      store.finishBatch(batch.id, 'completed')
      this.lastError = null
      this.holds.clear(used.kind)
      // The primary works again. When the backup did the work, the primary's problem stays.
      if (used.kind === providers[0]!.kind) this.problem = null
      return 'completed'
    } catch (err) {
      const failures: ProviderFailure[] =
        err instanceof AllProvidersFailed ? err.failures : [{ provider: ready[0]!.kind, message: errorMessage(err), local: ready[0]!.local }]
      const outcome = batchOutcome(failures, this.online())
      if (outcome.action === 'wait') {
        this.wait(batch, span, outcome, true)
        return 'waiting'
      }
      const message = errorMessage(err)
      this.lastError = message
      if (needsUser(outcome.kind)) this.problem = { kind: outcome.kind, provider: outcome.provider, message: failures[0]!.message, waiting: false }
      this.deps.log(`batch ${batch.id} failed: ${message}`)
      store.finishBatch(batch.id, 'failed', message)
      store.replaceObservations(batch.id, [], '')
      store.writeErrorCard(batch.id, span, message)
      return 'failed'
    } finally {
      this.deps.onCardsChanged()
    }
  }

  private online(): boolean {
    return this.deps.online?.() ?? true
  }

  /** The providers a batch may go to now: not held back, and only local ones while offline. */
  private readyProviders(providers: Provider[]): Provider[] {
    const now = nowSec()
    const online = this.online()
    return providers.filter((p) => this.holds.ready(p.kind, now) && (online || p.local))
  }

  /** Why no batch can go out right now, or null when one can (or no provider is set up). */
  private blocked(providers = this.deps.providers()): Wait | null {
    if (typeof providers === 'string' || providers.length === 0) return null
    if (this.readyProviders(providers).length > 0) return null
    const primary = providers[0]!
    if (!this.online() && providers.some((p) => !p.local)) return { action: 'wait', reason: 'offline', provider: primary.kind, kind: 'transient' }
    const held = providers.find((p) => this.holds.hold(p.kind)) ?? primary
    return { action: 'wait', reason: 'provider', provider: held.kind, kind: this.holds.hold(held.kind)?.kind ?? 'transient' }
  }

  /** Marks a batch as waiting, with a card that says for what; a started attempt does not count. */
  private wait(batch: Batch, span: { start: number; end: number }, outcome: Wait, attempted: boolean): void {
    const { store } = this.deps
    const label = this.deps.providerLabel?.(outcome.provider) ?? providerLabel(outcome.provider, '')
    const texts = waitingCardTexts(outcome.reason, outcome.kind, label)
    const what = outcome.reason === 'offline' ? 'offline' : `${outcome.provider} ${outcome.kind}`
    this.deps.log(`batch ${batch.id} waits: ${what}`)
    if (outcome.reason === 'provider' && needsUser(outcome.kind)) {
      const message = this.problem?.provider === outcome.provider ? this.problem.message : texts.summary
      this.problem = { kind: outcome.kind, provider: outcome.provider, message, waiting: true }
    }
    store.holdBatch(batch.id, `waiting: ${what}`, attempted)
    store.replaceObservations(batch.id, [], '')
    store.writeWaitingCard(batch.id, span, texts.title, texts.summary)
  }

  /**
   * Tries each provider in turn and returns the one that made the cards.
   * Providers that failed in a way the next batch would hit too are held
   * back for a while. Throws with every provider's error when all fail.
   */
  private async generateWithFailover(batch: Batch, providers: Provider[], shots: Screenshot[]): Promise<Provider> {
    const frames = await this.readFrames(shots)
    const failures: ProviderFailure[] = []
    for (const provider of providers) {
      try {
        await this.generateCards(batch, provider, frames)
        return provider
      } catch (err) {
        const failure: ProviderFailure = {
          provider: provider.kind,
          message: errorMessage(err),
          local: provider.local,
          ...(err instanceof ProviderError && err.status ? { status: err.status } : {})
        }
        failures.push(failure)
        this.deps.log(`batch ${batch.id}: ${provider.model}: ${failure.message}`)
        const kind = classifyFailure(failure)
        // Offline, every provider fails alike; the batch waits for the internet, not for them.
        if (waits(kind) && this.online()) {
          this.holds.record(provider.kind, kind, nowSec())
          if (needsUser(kind)) this.problem = { kind, provider: provider.kind, message: failure.message, waiting: false }
        }
      }
    }
    throw new AllProvidersFailed(failures, providers.map((p) => p.model))
  }

  /**
   * Local models go straight to two steps. Others try one step first and fall
   * back to two steps when their cards keep failing validation; provider
   * errors go up to the failover.
   */
  private async generateCards(batch: Batch, provider: Provider, frames: PromptFrame[]): Promise<void> {
    const logged = this.loggedProvider(provider, batch.id)
    if (!provider.local) {
      try {
        await this.oneStep(batch, logged, frames)
        return
      } catch (err) {
        if (!(err instanceof CardValidationError)) throw err
        this.deps.log(`batch ${batch.id}: ${err.message}; trying two steps`)
      }
    }
    await this.twoStep(batch, logged, frames)
  }

  /** The sample of frames sent to providers, read and prepared once per batch. */
  private async readFrames(shots: Screenshot[]): Promise<PromptFrame[]> {
    const sampled = sampleEvenly(shots)
    const frames = await Promise.all(
      sampled.map(async (s) => ({ capturedAt: s.capturedAt, jpeg: await readFile(s.filePath) }))
    )
    const { prepareFrame } = this.deps
    if (!prepareFrame) return frames
    const prepared: PromptFrame[] = []
    try {
      // One at a time: OCR is CPU-heavy and runs on one worker.
      for (const f of frames) prepared.push({ ...f, jpeg: await prepareFrame(f.jpeg) })
    } catch (err) {
      throw new Error(`Hiding secrets failed: ${errorMessage(err)}`)
    }
    return prepared
  }

  private async twoStep(batch: Batch, provider: Provider, frames: PromptFrame[]): Promise<void> {
    const { store } = this.deps
    const observations = await transcribe(provider, frames)
    store.replaceObservations(batch.id, observations, provider.model)
    const firstStart = observations[0]!.start
    // The last card that started before this batch's observations.
    const previous =
      store
        .contextCards({ start: batch.end - BATCHING.cardLookbackSec, end: batch.end })
        .filter((c) => c.start < firstStart)
        .at(-1) ?? null
    const { card, span } = await cardFromObservations(provider, observations, this.deps.categories(), this.deps.language(), previous, this.deps.overrides())
    // keepAfter: cards of newer batches survive when an old batch is analyzed late.
    store.replaceCards(span, batch.id, [card], batch.start)
  }

  /** Wraps a provider so every call lands in llm_calls. */
  private loggedProvider(provider: Provider, batchId: number): Provider {
    const { store } = this.deps
    let attempt = 0
    return {
      kind: provider.kind,
      model: provider.model,
      local: provider.local,
      async generate(request) {
        attempt++
        const started = Date.now()
        const base = { batchId, attempt, provider: provider.kind, model: provider.model, operation: 'generate' }
        try {
          const result = await provider.generate(request)
          store.logLlmCall({ ...base, ok: true, latencyMs: Date.now() - started, responseBody: result.text })
          return result
        } catch (err) {
          store.logLlmCall({
            ...base, ok: false, latencyMs: Date.now() - started, error: String(err),
            ...(err instanceof ProviderError && err.status ? { httpStatus: err.status } : {})
          })
          throw err
        }
      }
    }
  }

  private async oneStep(batch: Batch, provider: Provider, frames: PromptFrame[]): Promise<void> {
    const { store } = this.deps
    const window = {
      start: Math.floor(frames[0]!.capturedAt / 60) * 60,
      end: Math.floor(frames[frames.length - 1]!.capturedAt / 60) * 60 + 60
    }
    const lookbackStart = batch.end - BATCHING.cardLookbackSec
    const previousCards = store.contextCards({ start: lookbackStart, end: batch.end })
    const categories = this.deps.categories()

    let request = buildCardRequest({ frames, previousCards, window, categories, language: this.deps.language(), overrides: this.deps.overrides() })
    let lastIssue = ''
    for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_CALL; attempt++) {
      const text = (await provider.generate(request)).text
      const parsed = parseCards(text, {
        window,
        previous: previousCards.map((c) => ({ start: c.start, end: c.end })),
        categories: categories.map((c) => c.name),
        idleCategory: idleCategory(categories)?.name
      })
      if (!parsed.ok) {
        store.logLlmCall({
          batchId: batch.id, attempt, provider: provider.kind, model: provider.model, operation: 'validate_cards',
          ok: false, latencyMs: 0, error: parsed.issue
        })
      }
      if (parsed.ok) {
        const range = { start: Math.min(lookbackStart, ...previousCards.map((c) => c.start)), end: Math.max(batch.end, window.end) }
        store.replaceCards(range, batch.id, parsed.cards)
        return
      }
      lastIssue = parsed.issue
      request = withCorrection(request, text, parsed.issue, window)
    }
    throw new CardValidationError(`The model's cards failed validation: ${lastIssue}`)
  }
}

/** The model answered, but its cards broke the timeline rules after every correction. */
class CardValidationError extends Error {}

/**
 * Blocked stretches at the start or end of a partly blocked batch, outside the
 * minutes the model's cards cover. Blocked time in the middle is folded into
 * the surrounding card (its frames never reach the model).
 */
function blockedEdges(shots: Screenshot[], visible: Screenshot[]): Array<{ start: number; end: number }> {
  const first = shots[0]
  const last = shots[shots.length - 1]
  const firstVisible = visible[0]
  const lastVisible = visible[visible.length - 1]
  if (!first || !last || !firstVisible || !lastVisible) return []
  const edges: Array<{ start: number; end: number }> = []
  if (first.blocked) edges.push({ start: first.capturedAt, end: Math.floor(firstVisible.capturedAt / 60) * 60 })
  if (last.blocked) edges.push({ start: Math.floor(lastVisible.capturedAt / 60) * 60 + 60, end: last.capturedAt })
  return edges.filter((e) => e.end - e.start >= 60)
}

function privateCard(span: { start: number; end: number }): NewCard {
  return {
    ...span,
    title: 'Private',
    category: PRIVATE_CATEGORY,
    subcategory: '',
    summary: 'Not recorded: a blocked app, such as a password manager, was in front.',
    detailedSummary: '',
    distractions: [],
    appSites: {}
  }
}

function idleCard(span: { start: number; end: number }, category: string): NewCard {
  return {
    ...span,
    title: 'Idle',
    category,
    subcategory: '',
    summary: 'You were idle during this period.',
    detailedSummary: 'Idle period. Dayflow Electron skipped activity summarization for this block.',
    distractions: [],
    appSites: {}
  }
}
