import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import { DatabaseSync, backup } from 'node:sqlite'
import { type Category, FALLBACK_COLOR, SYSTEM_CATEGORY } from '../../shared/categories'
import { dayKey, dayRange, formatClock } from '../../shared/day'
import type { GoalPlan } from '../../shared/day-summary'
import type { AppSites, CardEdit, ChatConversation, ChatRole, ChatStoredMessage, Distraction, Rating, StandupEntry, TimelineCard } from '../../shared/types'
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
  /** A placeholder: a blocked app was in front, so nothing was saved. */
  blocked: boolean
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

  /**
   * Opens the app's database for reading only (the CLI and MCP server):
   * no migrations, no file created, and writes fail at the connection.
   */
  static openReadOnly(path: string): Store {
    const db = new DatabaseSync(path, { readOnly: true })
    db.exec('PRAGMA query_only = 1; PRAGMA busy_timeout = 2000;')
    return new Store(db)
  }

  close(): void {
    this.db.close()
  }

  /** Copies the whole database to `path` while it stays in use. */
  async backupTo(path: string): Promise<void> {
    await backup(this.db, path)
  }

  /** SQLite's quick integrity check; false for a damaged database. */
  isHealthy(): boolean {
    const row = this.db.prepare('PRAGMA quick_check').get() as Record<string, unknown> | undefined
    return row !== undefined && Object.values(row)[0] === 'ok'
  }

  /** Moves the write-ahead log into the database file (upstream does this every 5 minutes). */
  checkpoint(): void {
    this.db.exec('PRAGMA wal_checkpoint(PASSIVE)')
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

  /**
   * Points screenshots stored under another folder at `recordingsDir`, keeping
   * the file name: paths are absolute, so moving the data folder (for example
   * to a new app ID) would leave them pointing at the old place. Returns how
   * many rows changed.
   */
  relocateScreenshots(recordingsDir: string): number {
    const prefix = recordingsDir.replace(/\/+$/, '') + '/'
    const rows = this.db
      .prepare("SELECT id, file_path AS filePath FROM screenshots WHERE file_path != '' AND substr(file_path, 1, ?) != ?")
      .all(prefix.length, prefix) as Array<{ id: number; filePath: string }>
    const update = this.db.prepare('UPDATE screenshots SET file_path = ? WHERE id = ?')
    this.tx(() => {
      for (const r of rows) update.run(prefix + basename(r.filePath), r.id)
    })
    return rows.length
  }

  insertScreenshot(s: Omit<Screenshot, 'id' | 'blocked'> & { blocked?: boolean }): number {
    const r = this.db
      .prepare(
        'INSERT INTO screenshots (captured_at, file_path, file_size, idle_seconds_at_capture, is_blocked) VALUES (?, ?, ?, ?, ?)'
      )
      .run(s.capturedAt, s.filePath, s.fileSize, s.idleSeconds, s.blocked ? 1 : 0)
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
      .all(since)
      .map(toScreenshot)
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
      .all(batchId)
      .map(toScreenshot)
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

  updateCard(id: number, change: CardEdit): TimelineCard | undefined {
    if (change.title !== undefined) this.db.prepare('UPDATE timeline_cards SET title = ? WHERE id = ?').run(change.title, id)
    if (change.category !== undefined) this.db.prepare('UPDATE timeline_cards SET category = ? WHERE id = ?').run(change.category, id)
    const row = this.db.prepare(`SELECT ${CARD_COLUMNS} FROM timeline_cards WHERE id = ? AND is_deleted = 0`).get(id)
    return row ? toCard(row as unknown as CardRow) : undefined
  }

  deleteCard(id: number): void {
    this.db.prepare('UPDATE timeline_cards SET is_deleted = 1 WHERE id = ?').run(id)
  }

  renameCategory(from: string, to: string): void {
    this.db.prepare('UPDATE timeline_cards SET category = ? WHERE category = ? AND is_deleted = 0').run(to, from)
  }

  /**
   * Rates a time range. Like upstream applyReviewRating, older ratings keep
   * only their parts outside the new range.
   */
  rateRange(span: Span, rating: Rating['rating'], feedback: string | null = null): void {
    if (span.end <= span.start) return
    this.tx(() => {
      const overlapping = this.db
        .prepare('SELECT id, start_ts AS start, end_ts AS end, rating, feedback FROM timeline_card_feedback WHERE NOT (end_ts <= ? OR start_ts >= ?)')
        .all(span.start, span.end) as unknown as Array<Span & { id: number; rating: string; feedback: string | null }>
      const insert = this.db.prepare('INSERT INTO timeline_card_feedback (start_ts, end_ts, rating, feedback) VALUES (?, ?, ?, ?)')
      for (const r of overlapping) {
        this.db.prepare('DELETE FROM timeline_card_feedback WHERE id = ?').run(r.id)
        if (r.start < span.start) insert.run(r.start, Math.min(span.start, r.end), r.rating, r.feedback)
        if (r.end > span.end) insert.run(Math.max(span.end, r.start), r.end, r.rating, r.feedback)
      }
      insert.run(span.start, span.end, rating, feedback?.trim() || null)
    })
  }

  ratings(span: Span): Rating[] {
    return this.db
      .prepare(
        'SELECT start_ts AS start, end_ts AS end, rating, feedback FROM timeline_card_feedback WHERE NOT (end_ts <= ? OR start_ts >= ?) ORDER BY start_ts'
      )
      .all(span.start, span.end) as unknown as Rating[]
  }

  /**
   * Starts batches over, like upstream's reprocessing: they become pending
   * with no attempts, and their cards and observations go. A batch that is
   * being analyzed right now is left alone. Returns the ids that were reset.
   */
  private resetBatches(where: string, ...params: Array<number>): number[] {
    return this.tx(() => {
      const ids = (
        this.db
          .prepare(`SELECT id FROM analysis_batches WHERE ${where} AND status IN ('completed', 'failed', 'analyzed')`)
          .all(...params) as Array<{ id: number }>
      ).map((r) => r.id)
      for (const id of ids) {
        this.db.prepare('UPDATE timeline_cards SET is_deleted = 1 WHERE batch_id = ?').run(id)
        this.db.prepare('DELETE FROM observations WHERE batch_id = ?').run(id)
        this.db.prepare("UPDATE analysis_batches SET status = 'pending', reason = NULL, attempts = 0 WHERE id = ?").run(id)
      }
      return ids
    })
  }

  /** Analyzes one batch again (also retries a failed one). False when it cannot be reset now. */
  reprocessBatch(id: number): boolean {
    return this.resetBatches('id = ?', id).length > 0
  }

  /** Queues every failed batch again with fresh attempts; returns how many. */
  retryFailedBatches(): number {
    return this.resetBatches("status = 'failed'").length
  }

  /** Analyzes a day again; returns how many batches were reset. */
  reprocessDay(day: string): number {
    const { start, end } = dayRange(day)
    return this.resetBatches('batch_start_ts >= ? AND batch_start_ts < ?', start, end).length
  }

  /**
   * The goal plan for a day: its own, or the newest earlier one carried
   * forward (then never "skipped"). Categories are matched by id first, so
   * renames carry over. Null when no plan was ever set.
   */
  goalPlan(day: string, categories: Category[]): GoalPlan | null {
    const row = this.db
      .prepare(
        `SELECT day, focus_target_minutes AS focus, distraction_limit_minutes AS distraction, is_skipped AS skipped
         FROM day_goals WHERE day <= ? ORDER BY day DESC LIMIT 1`
      )
      .get(day) as { day: string; focus: number; distraction: number; skipped: number } | undefined
    if (!row) return null
    const names = (kind: 'focus' | 'distraction') =>
      (
        this.db
          .prepare('SELECT category_id AS id, category_name AS name FROM day_goal_categories WHERE day = ? AND kind = ? ORDER BY sort_order')
          .all(row.day, kind) as Array<{ id: string; name: string }>
      ).map((c) => categories.find((x) => x.id === c.id)?.name ?? c.name)
    return {
      focusTargetMinutes: row.focus,
      distractionLimitMinutes: row.distraction,
      focusCategories: names('focus'),
      distractionCategories: names('distraction'),
      skipped: row.day === day && row.skipped === 1
    }
  }

  setGoalPlan(day: string, plan: GoalPlan, categories: Category[]): void {
    const now = Math.floor(Date.now() / 1000)
    this.tx(() => {
      this.db
        .prepare(
          `INSERT INTO day_goals (day, focus_target_minutes, distraction_limit_minutes, is_skipped, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(day) DO UPDATE SET focus_target_minutes = excluded.focus_target_minutes,
             distraction_limit_minutes = excluded.distraction_limit_minutes, is_skipped = excluded.is_skipped,
             updated_at = excluded.updated_at`
        )
        .run(day, plan.focusTargetMinutes, plan.distractionLimitMinutes, plan.skipped ? 1 : 0, now, now)
      this.db.prepare('DELETE FROM day_goal_categories WHERE day = ?').run(day)
      const insert = this.db.prepare(
        'INSERT OR IGNORE INTO day_goal_categories (day, kind, category_id, category_name, category_color_hex, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
      )
      for (const kind of ['focus', 'distraction'] as const) {
        const list = kind === 'focus' ? plan.focusCategories : plan.distractionCategories
        list.forEach((name, i) => {
          const c = categories.find((x) => x.name === name)
          insert.run(day, kind, c?.id ?? name, name, c?.color ?? FALLBACK_COLOR, i)
        })
      }
    })
  }

  screenshotPath(id: number): string | undefined {
    const row = this.db.prepare('SELECT file_path AS filePath FROM screenshots WHERE id = ? AND is_deleted = 0 AND is_blocked = 0').get(id) as
      | { filePath: string }
      | undefined
    return row?.filePath || undefined
  }

  /** Saved frames of a time range, oldest first (for the slideshow and timelapse). */
  framesInRange(span: Span): Array<{ id: number; capturedAt: number; filePath: string }> {
    return this.db
      .prepare(
        `SELECT id, captured_at AS capturedAt, file_path AS filePath FROM screenshots
         WHERE captured_at >= ? AND captured_at < ? AND is_deleted = 0 AND is_blocked = 0 AND file_path != ''
         ORDER BY captured_at`
      )
      .all(span.start, span.end) as unknown as Array<{ id: number; capturedAt: number; filePath: string }>
  }

  standup(day: string): StandupEntry | null {
    const row = this.db.prepare('SELECT payload_json AS json FROM daily_standup_entries WHERE standup_day = ?').get(day) as
      | { json: string }
      | undefined
    return row ? parseStandup(row.json) : null
  }

  saveStandup(day: string, entry: StandupEntry): void {
    this.db
      .prepare(
        `INSERT INTO daily_standup_entries (standup_day, payload_json) VALUES (?, ?)
         ON CONFLICT(standup_day) DO UPDATE SET payload_json = excluded.payload_json, updated_at = CURRENT_TIMESTAMP`
      )
      .run(day, JSON.stringify(entry))
  }

  /** Days already summarized by the standups of other days. */
  usedSourceDays(exceptDay: string): Set<string> {
    const rows = this.db.prepare('SELECT payload_json AS json FROM daily_standup_entries WHERE standup_day != ?').all(exceptDay) as Array<{
      json: string
    }>
    const days = new Set<string>()
    for (const r of rows) {
      const day = parseStandup(r.json)?.sourceDay
      if (day) days.add(day)
    }
    return days
  }

  // ---------------------------------------------------------------- chat

  /** Starts a conversation; returns its id. */
  createConversation(c: { title: string; provider: string; now: number }): string {
    const id = randomUUID()
    this.db
      .prepare('INSERT INTO chat_conversations (id, title, provider, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, c.title, c.provider, c.now, c.now)
    return id
  }

  /** Appends a message and moves the conversation to the top of the history. */
  addChatMessage(conversationId: string, m: { role: ChatRole; content: string; now: number }): void {
    this.tx(() => {
      const next = (
        this.db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM chat_messages WHERE conversation_id = ?').get(conversationId) as {
          n: number
        }
      ).n
      this.db
        .prepare('INSERT INTO chat_messages (id, conversation_id, role, content, created_at, sort_order) VALUES (?, ?, ?, ?, ?, ?)')
        .run(randomUUID(), conversationId, m.role, m.content, m.now, next)
      this.db.prepare('UPDATE chat_conversations SET updated_at = ? WHERE id = ?').run(m.now, conversationId)
    })
  }

  conversations(): ChatConversation[] {
    return this.db
      .prepare('SELECT id, title, provider, created_at AS createdAt, updated_at AS updatedAt FROM chat_conversations ORDER BY updated_at DESC')
      .all() as unknown as ChatConversation[]
  }

  chatMessages(conversationId: string): ChatStoredMessage[] {
    return this.db
      .prepare('SELECT id, role, content, created_at AS createdAt FROM chat_messages WHERE conversation_id = ? ORDER BY sort_order')
      .all(conversationId) as unknown as ChatStoredMessage[]
  }

  /** Deletes a conversation and its messages right away, like upstream. */
  deleteConversation(id: string): void {
    this.db.prepare('DELETE FROM chat_conversations WHERE id = ?').run(id)
  }

  /** Batches that produced cards; each stands for 15 minutes (feature unlocks). */
  analyzedBatchCount(): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM analysis_batches WHERE status IN ('completed', 'analyzed')").get() as { n: number }).n
  }

  /** True once analysis produced a real card (not an error card); upstream's first-cards check. */
  hasTimelineCards(): boolean {
    return !!this.db.prepare('SELECT 1 FROM timeline_cards WHERE is_deleted = 0 AND category != ? LIMIT 1').get(SYSTEM_CATEGORY)
  }

  /** Minutes covered by the cards that start on a day (upstream's minimum-activity measure). */
  cardMinutesOn(day: string): number {
    const { start, end } = dayRange(day)
    const row = this.db
      .prepare('SELECT COALESCE(SUM(end_ts - start_ts), 0) AS sec FROM timeline_cards WHERE start_ts >= ? AND start_ts < ? AND is_deleted = 0')
      .get(start, end) as { sec: number }
    return Math.floor(row.sec / 60)
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
      .prepare(`SELECT ${CARD_COLUMNS} FROM timeline_cards WHERE ${OVERLAPS} AND category != '${SYSTEM_CATEGORY}' ORDER BY start_ts`)
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
             AND (category != '${SYSTEM_CATEGORY}' OR batch_id = :batch)
             AND NOT (start_ts > :keepAfter AND COALESCE(batch_id, -1) IN
                      (SELECT id FROM analysis_batches WHERE batch_start_ts > :keepAfter))`
        )
        .run({ from: span.start, to: span.end, batch: batchId, keepAfter: keepAfter ?? Number.MAX_SAFE_INTEGER })
      this.insertCards(batchId, cards)
    })
  }

  /** Adds cards without replacing anything. */
  addCards(batchId: number, cards: NewCard[]): void {
    this.tx(() => this.insertCards(batchId, cards))
  }

  private insertCards(batchId: number, cards: NewCard[]): void {
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
          category: SYSTEM_CATEGORY,
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

  /** Cards starting in [from, to), oldest first, without error cards (the chat tools' view). */
  cardsBetween(from: number, to: number): TimelineCard[] {
    const rows = this.db
      .prepare(`SELECT ${CARD_COLUMNS} FROM timeline_cards WHERE start_ts >= ? AND start_ts < ? AND is_deleted = 0 AND category != ? ORDER BY start_ts, id`)
      .all(from, to, SYSTEM_CATEGORY) as unknown as CardRow[]
    return rows.map(toCard)
  }

  /** Observations starting in [from, to), oldest first. */
  observationsBetween(from: number, to: number): Observation[] {
    return this.db
      .prepare('SELECT start_ts AS start, end_ts AS end, observation AS text FROM observations WHERE start_ts >= ? AND start_ts < ? ORDER BY start_ts')
      .all(from, to) as unknown as Observation[]
  }

  /** One live card. */
  card(id: number): TimelineCard | undefined {
    const row = this.db.prepare(`SELECT ${CARD_COLUMNS} FROM timeline_cards WHERE id = ? AND is_deleted = 0`).get(id)
    return row ? toCard(row as unknown as CardRow) : undefined
  }

  /** Live cards overlapping [from, to), error cards included, oldest first (upstream CLI range reads). */
  cardsOverlapping(from: number, to: number): TimelineCard[] {
    const rows = this.db
      .prepare(`SELECT ${CARD_COLUMNS} FROM timeline_cards WHERE start_ts < ? AND end_ts > ? AND is_deleted = 0 ORDER BY start_ts, id`)
      .all(to, from) as unknown as CardRow[]
    return rows.map(toCard)
  }

  /** Live cards whose title or summary contains `text` (case-insensitive for ASCII), newest first. */
  searchCards(text: string, limit: number): TimelineCard[] {
    const pattern = `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
    const rows = this.db
      .prepare(
        `SELECT ${CARD_COLUMNS} FROM timeline_cards
         WHERE (title LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\') AND is_deleted = 0
         ORDER BY start_ts DESC, id DESC LIMIT ?`
      )
      .all(pattern, pattern, limit) as unknown as CardRow[]
    return rows.map(toCard)
  }

  /** The newest capture and the analysis backlog (upstream CLI fetchStatus). */
  captureStatus(): { lastCaptureAt: number | null; pendingBatches: number; failedBatches: number } {
    const last = this.db.prepare('SELECT MAX(captured_at) AS ts FROM screenshots WHERE is_deleted = 0').get() as { ts: number | null }
    const counts = this.db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN status IN ('pending', 'processing') THEN 1 ELSE 0 END), 0) AS pending,
                COALESCE(SUM(CASE WHEN status LIKE 'failed%' THEN 1 ELSE 0 END), 0) AS failed
         FROM analysis_batches`
      )
      .get() as { pending: number; failed: number }
    return { lastCaptureAt: last.ts ?? null, pendingBatches: counts.pending, failedBatches: counts.failed }
  }

  countCardsInCategory(name: string): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM timeline_cards WHERE category = ? AND is_deleted = 0').get(name) as { n: number }).n
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

/** A stored standup, or null when the row is unreadable. */
function parseStandup(json: string): StandupEntry | null {
  try {
    return JSON.parse(json) as StandupEntry
  } catch {
    return null
  }
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

const toScreenshot = (row: unknown): Screenshot => {
  const r = row as Omit<Screenshot, 'blocked'> & { blocked: number }
  return { ...r, blocked: r.blocked === 1 }
}

const SHOT_COLUMNS =
  'id, captured_at AS capturedAt, file_path AS filePath, file_size AS fileSize, idle_seconds_at_capture AS idleSeconds, is_blocked AS blocked'
const BATCH_COLUMNS =
  'id, batch_start_ts AS start, batch_end_ts AS end, status, reason, attempts'
