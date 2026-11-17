import { DatabaseSync } from 'node:sqlite'
import { dayKey, formatClock } from '../../shared/day'
import type { AppSites, Distraction, TimelineCard } from '../../shared/types'
import type { Observation } from '../analysis/observations'
import type { StoredFrame } from '../retention'
import { MIGRATIONS } from './schema'

export type BatchStatus =
  | 'pending'
  | 'processing'
  | 'analyzed'
  | 'completed'
  | 'failed'
  | 'failed_empty'
  | 'skipped_short'

export interface Screenshot {
  id: number
  capturedAt: number
  filePath: string
  fileSize: number
  idleSeconds: number | null
}

export interface Batch {
  id: number
  start: number
  end: number
  status: BatchStatus
  reason: string | null
  attempts: number
}

export interface Span {
  start: number
  end: number
}

/** A card to store; clock labels and the day are derived from start/end. */
export interface NewCard extends Span {
  title: string
  category: string
  subcategory: string
  summary: string
  detailedSummary: string
  distractions: Distraction[]
  appSites: AppSites
}

/** The app's SQLite database (node:sqlite, so no native module to rebuild). */
export class Store {
  private constructor(private readonly db: DatabaseSync) {}

  static open(path: string): Store {
    const db = new DatabaseSync(path)
    db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
    const version = Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
    for (let v = version; v < MIGRATIONS.length; v++) {
      db.exec('BEGIN')
      try {
        db.exec(MIGRATIONS[v]!)
        db.exec(`PRAGMA user_version = ${v + 1}`)
        db.exec('COMMIT')
      } catch (err) {
        db.exec('ROLLBACK')
        throw err
      }
    }
    return new Store(db)
  }

  close(): void {
    this.db.close()
  }

  private tx<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = fn()
      this.db.exec('COMMIT')
      return result
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
  }

  insertScreenshot(s: Omit<Screenshot, 'id'>): number {
    const r = this.db
      .prepare('INSERT INTO screenshots (captured_at, file_path, file_size, idle_seconds_at_capture) VALUES (?, ?, ?, ?)')
      .run(s.capturedAt, s.filePath, s.fileSize, s.idleSeconds)
    return Number(r.lastInsertRowid)
  }

  /** Screenshots since `since` that belong to no batch yet, oldest first. */
  unbatchedScreenshots(since: number): Screenshot[] {
    return this.db
      .prepare(
        `SELECT ${SHOT_COLUMNS} FROM screenshots
         WHERE captured_at >= ? AND is_deleted = 0
           AND id NOT IN (SELECT screenshot_id FROM batch_screenshots)
         ORDER BY captured_at ASC`
      )
      .all(since) as unknown as Screenshot[]
  }

  createBatch(plan: { start: number; end: number; shotIds: number[] }): number {
    return this.tx(() => {
      const r = this.db
        .prepare('INSERT INTO analysis_batches (batch_start_ts, batch_end_ts) VALUES (?, ?)')
        .run(plan.start, plan.end)
      const id = Number(r.lastInsertRowid)
      const link = this.db.prepare('INSERT INTO batch_screenshots (batch_id, screenshot_id) VALUES (?, ?)')
      for (const shot of plan.shotIds) link.run(id, shot)
      return id
    })
  }

  batch(id: number): Batch | undefined {
    return this.db.prepare(`SELECT ${BATCH_COLUMNS} FROM analysis_batches WHERE id = ?`).get(id) as unknown as
      | Batch
      | undefined
  }

  /** The batch's screenshots that still exist, oldest first. */
  batchScreenshots(batchId: number): Screenshot[] {
    return this.db
      .prepare(
        `SELECT ${SHOT_COLUMNS.replace(/(^|, )/g, '$1s.')} FROM screenshots s
         JOIN batch_screenshots bs ON bs.screenshot_id = s.id
         WHERE bs.batch_id = ? AND s.is_deleted = 0
         ORDER BY s.captured_at ASC`
      )
      .all(batchId) as unknown as Screenshot[]
  }

  pendingBatches(): Batch[] {
    return this.db
      .prepare(`SELECT ${BATCH_COLUMNS} FROM analysis_batches WHERE status = 'pending' ORDER BY batch_start_ts`)
      .all() as unknown as Batch[]
  }

  /** Failed batches since `since` with attempts left, oldest first. */
  retryableBatches(since: number, maxAttempts: number): Batch[] {
    return this.db
      .prepare(
        `SELECT ${BATCH_COLUMNS} FROM analysis_batches
         WHERE status = 'failed' AND batch_start_ts >= ? AND attempts < ? ORDER BY batch_start_ts`
      )
      .all(since, maxAttempts) as unknown as Batch[]
  }

  startAttempt(id: number): void {
    this.db.prepare("UPDATE analysis_batches SET status = 'processing', attempts = attempts + 1 WHERE id = ?").run(id)
  }

  finishBatch(id: number, status: BatchStatus, reason: string | null = null): void {
    this.db.prepare('UPDATE analysis_batches SET status = ?, reason = ? WHERE id = ?').run(status, reason, id)
  }

  /** A batch still "processing" at startup was cut off by a quit or crash. */
  resetInterruptedBatches(): void {
    this.db.prepare("UPDATE analysis_batches SET status = 'pending' WHERE status = 'processing'").run()
  }

  logLlmCall(call: {
    batchId: number | null
    attempt: number
    provider: string
    model: string
    operation: string
    ok: boolean
    latencyMs: number
    httpStatus?: number
    responseBody?: string
    error?: string
  }): void {
    this.db
      .prepare(
        `INSERT INTO llm_calls (batch_id, attempt, provider, model, operation, status, latency_ms, http_status,
           response_body, error_message) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        call.batchId,
        call.attempt,
        call.provider,
        call.model,
        call.operation,
        call.ok ? 'success' : 'failure',
        call.latencyMs,
        call.httpStatus ?? null,
        call.responseBody ?? null,
        call.error ?? null
      )
  }

  /** Replaces a batch's observations (two-step path). */
  replaceObservations(batchId: number, observations: Observation[], model: string): void {
    this.tx(() => {
      this.db.prepare('DELETE FROM observations WHERE batch_id = ?').run(batchId)
      const insert = this.db.prepare(
        'INSERT INTO observations (batch_id, start_ts, end_ts, observation, llm_model) VALUES (?, ?, ?, ?, ?)'
      )
      for (const o of observations) insert.run(batchId, o.start, o.end, o.text, model)
    })
  }

  storedFrames(): StoredFrame[] {
    return this.db
      .prepare('SELECT id, captured_at AS capturedAt, COALESCE(file_size, 0) AS bytes FROM screenshots WHERE is_deleted = 0 ORDER BY captured_at')
      .all() as unknown as StoredFrame[]
  }

  /** Marks screenshots deleted and returns their file paths for removal. */
  deleteScreenshots(ids: number[]): string[] {
    if (ids.length === 0) return []
    return this.tx(() => {
      const select = this.db.prepare('SELECT file_path AS filePath FROM screenshots WHERE id = ? AND is_deleted = 0')
      const mark = this.db.prepare('UPDATE screenshots SET is_deleted = 1 WHERE id = ?')
      const paths: string[] = []
      for (const id of ids) {
        const row = select.get(id) as { filePath: string } | undefined
        if (row) paths.push(row.filePath)
        mark.run(id)
      }
      return paths
    })
  }

  /** Live cards overlapping the span that the model may revise (no System cards). */
  contextCards(span: Span): TimelineCard[] {
    const rows = this.db
      .prepare(`SELECT ${CARD_COLUMNS} FROM timeline_cards WHERE ${OVERLAPS} AND category != 'System' ORDER BY start_ts`)
      .all({ from: span.start, to: span.end }) as unknown as CardRow[]
    return rows.map(toCard)
  }

  /**
   * Soft-deletes the live cards overlapping `span` and inserts `cards` for
   * `batchId`. Error cards of other batches survive. With keepAfter, cards of
   * newer batches starting after it survive too.
   */
  replaceCards(span: Span, batchId: number, cards: NewCard[], keepAfter?: number): void {
    this.tx(() => {
      this.db
        .prepare(
          `UPDATE timeline_cards SET is_deleted = 1
           WHERE ${OVERLAPS}
             AND (category != 'System' OR batch_id = :batch)
             AND NOT (start_ts > :keepAfter AND COALESCE(batch_id, -1) IN
                      (SELECT id FROM analysis_batches WHERE batch_start_ts > :keepAfter))`
        )
        .run({ from: span.start, to: span.end, batch: batchId, keepAfter: keepAfter ?? Number.MAX_SAFE_INTEGER })
      const insert = this.db.prepare(
        `INSERT INTO timeline_cards (batch_id, start, end, start_ts, end_ts, day, title, summary, category,
           subcategory, detailed_summary, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      for (const c of cards) {
        insert.run(
          batchId,
          formatClock(c.start),
          formatClock(c.end),
          c.start,
          c.end,
          dayKey(c.start),
          c.title,
          c.summary,
          c.category,
          c.subcategory,
          c.detailedSummary,
          JSON.stringify({ distractions: c.distractions, appSites: c.appSites })
        )
      }
    })
  }

  /** Puts a "Processing failed" card over the batch's time, like upstream. */
  writeErrorCard(batchId: number, span: Span, message: string): void {
    this.replaceCards(
      span,
      batchId,
      [
        {
          ...span,
          title: 'Processing failed',
          category: 'System',
          subcategory: 'Error',
          summary: `${message} Your recording is saved.`,
          detailedSummary: '',
          distractions: [],
          appSites: {}
        }
      ],
      span.start
    )
  }

  cardsForDay(day: string): TimelineCard[] {
    const rows = this.db
      .prepare(`SELECT ${CARD_COLUMNS} FROM timeline_cards WHERE day = ? AND is_deleted = 0 ORDER BY start_ts, id`)
      .all(day) as unknown as CardRow[]
    return rows.map(toCard)
  }
}

interface CardRow {
  id: number
  batchId: number | null
  startTime: string
  endTime: string
  start: number
  end: number
  day: string
  title: string
  summary: string | null
  category: string
  subcategory: string | null
  detailedSummary: string | null
  metadata: string | null
}

function toCard(r: CardRow): TimelineCard {
  let meta: { distractions?: Distraction[]; appSites?: AppSites } = {}
  try {
    meta = r.metadata ? JSON.parse(r.metadata) : {}
  } catch {
    // keep defaults for unreadable metadata
  }
  return {
    id: r.id,
    batchId: r.batchId,
    startTime: r.startTime,
    endTime: r.endTime,
    start: r.start,
    end: r.end,
    day: r.day,
    title: r.title,
    summary: r.summary ?? '',
    category: r.category,
    subcategory: r.subcategory ?? '',
    detailedSummary: r.detailedSummary ?? '',
    distractions: meta.distractions ?? [],
    appSites: meta.appSites ?? {}
  }
}

const CARD_COLUMNS = `id, batch_id AS batchId, start AS startTime, end AS endTime, start_ts AS start, end_ts AS end,
  day, title, summary, category, subcategory, detailed_summary AS detailedSummary, metadata`
const OVERLAPS = '((start_ts < :to AND end_ts > :from) OR (start_ts >= :from AND start_ts < :to)) AND is_deleted = 0'

const SHOT_COLUMNS =
  'id, captured_at AS capturedAt, file_path AS filePath, file_size AS fileSize, idle_seconds_at_capture AS idleSeconds'
const BATCH_COLUMNS =
  'id, batch_start_ts AS start, batch_end_ts AS end, status, reason, attempts'
