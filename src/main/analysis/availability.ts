// Whether a batch waits or fails, and which providers to leave alone for a
// while, after upstream Dayflow (Core/AI/ProviderAvailability.swift and the
// batch error handling in LLMService.swift). A batch that waits is not
// failed: it uses up no retry and goes out again by itself once the internet,
// the provider or the sign-in is back.

import { type FailureKind, failureKind } from '../../shared/failures'
import type { ProviderKind } from '../../shared/types'

/** One provider's error for a batch. */
export interface ProviderFailure {
  provider: ProviderKind
  message: string
  /** The HTTP status, when the provider answered with one. */
  status?: number
  /** A model on this computer or network, which needs no internet. */
  local?: boolean
}

export type BatchOutcome =
  | { action: 'wait'; reason: 'offline' | 'provider'; provider: ProviderKind; kind: FailureKind }
  | { action: 'fail'; provider: ProviderKind; kind: FailureKind }

/** The kind of a provider error: the HTTP status first, unless the words are more specific. */
export function classifyFailure(failure: { message: string; status?: number }): FailureKind {
  const kind = failureKind(failure.message)
  const { status } = failure
  if (status !== undefined && (status === 408 || status === 429 || status >= 500)) {
    return ['usage_limit_hit', 'out_of_credits', 'provider_login_expired'].includes(kind) ? kind : 'transient'
  }
  return kind
}

/**
 * Problems that clear up on their own (a busy or unreachable provider, a used
 * up plan) or with a sign-in. Everything else (bad replies after the
 * corrections, bad keys, setup errors) fails the batch.
 */
export const waits = (kind: FailureKind): boolean =>
  kind === 'transient' || kind === 'usage_limit_hit' || kind === 'provider_login_expired' || kind === 'local_engine_offline'

/**
 * What to do with a batch every provider failed, primary first: wait while
 * offline (unless only local models failed), wait for the first provider that
 * may come back, and fail with the primary's problem otherwise.
 */
export function batchOutcome(failures: ProviderFailure[], online: boolean): BatchOutcome {
  const cloud = failures.find((f) => !f.local)
  if (!online && cloud) return { action: 'wait', reason: 'offline', provider: cloud.provider, kind: 'transient' }
  const kinds = failures.map((f) => classifyFailure(f))
  const waiting = kinds.findIndex(waits)
  if (waiting >= 0) return { action: 'wait', reason: 'provider', provider: failures[waiting]!.provider, kind: kinds[waiting]! }
  const first = failures[0]
  return { action: 'fail', provider: first?.provider ?? 'anthropic', kind: kinds[0] ?? 'unknown' }
}

/** Seconds to leave a provider alone after its `failures`-th failure in a row. */
export function holdDelaySec(kind: FailureKind, failures: number): number {
  // Busy servers come back within minutes; upstream holds account problems 15, 30, then 60 minutes.
  const delays = kind === 'transient' ? [60, 120, 300, 600, 900] : [900, 1800, 3600]
  return delays[Math.min(Math.max(failures, 1), delays.length) - 1]!
}

export interface Hold {
  kind: FailureKind
  /** Unix seconds of the first failure in this row. */
  since: number
  failures: number
  /** No batch goes to the provider before this (Unix seconds). */
  nextAttemptAt: number
}

/**
 * Providers that failed in a way that would fail the next batch too, so
 * batches wait for them instead of each paying for the same error. In memory
 * only: a restart tries everything again.
 */
export class ProviderHolds {
  private readonly holds = new Map<ProviderKind, Hold>()

  hold(provider: ProviderKind): Hold | undefined {
    return this.holds.get(provider)
  }

  /** Starts a hold, or pushes the next try further out after another failure. */
  record(provider: ProviderKind, kind: FailureKind, now: number): void {
    const previous = this.holds.get(provider)
    const failures = (previous?.failures ?? 0) + 1
    this.holds.set(provider, { kind, since: previous?.since ?? now, failures, nextAttemptAt: now + holdDelaySec(kind, failures) })
  }

  /** Lifts a provider's hold; true when there was one. */
  clear(provider: ProviderKind): boolean {
    return this.holds.delete(provider)
  }

  clearAll(): void {
    this.holds.clear()
  }

  /** Lets the next batch try every held provider, e.g. after the internet came back. */
  allowNow(now: number): void {
    for (const hold of this.holds.values()) hold.nextAttemptAt = Math.min(hold.nextAttemptAt, now)
  }

  ready(provider: ProviderKind, now: number): boolean {
    const hold = this.holds.get(provider)
    return !hold || now >= hold.nextAttemptAt
  }
}
