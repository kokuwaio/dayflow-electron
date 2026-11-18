// Speed test of local models on screenshots already recorded: runs the app's
// own two-step analysis (describe each sampled frame, then write the card) on
// the latest analyzed 15-minute batches, per model. Skipped in normal test
// runs; start it with `make bench-models` (see the Makefile for the options).
// The database is opened read-only, and only a local base URL is accepted, so
// no screenshot leaves the computer.

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, it } from 'vitest'
import { cardFromObservations, transcribe } from '../src/main/analysis/two-step'
import { type PromptFrame, sampleEvenly } from '../src/main/analysis/prompt'
import { createProvider } from '../src/main/providers'
import { DEFAULT_CATEGORIES } from '../src/shared/categories'
import { isLocalUrl } from '../src/shared/providers'

const models = (process.env.BENCH_MODELS ?? '').split(/[\s,]+/).filter(Boolean)
const baseUrl = process.env.BENCH_BASE_URL || 'http://localhost:11434/v1'
const batchCount = Number(process.env.BENCH_BATCHES || 1)
/** Only the first minutes of each batch: fewer frames, a quicker run. */
const minutes = Number(process.env.BENCH_MINUTES || 15)
const dataDir =
  process.env.BENCH_DATA_DIR ||
  [join(homedir(), '.var/app/io.github.kokuwaio.DayflowElectron/config/dayflow-electron'), join(homedir(), '.config/dayflow-electron')].find((d) =>
    existsSync(join(d, 'dayflow.sqlite'))
  ) ||
  ''

interface Batch {
  id: number
  frames: PromptFrame[]
}

/** The latest analyzed batches of about 15 minutes, cut to the first `minutes`, with the frames the app would send. */
function latestBatches(): Batch[] {
  const db = new DatabaseSync(join(dataDir, 'dayflow.sqlite'), { readOnly: true })
  try {
    const batches = db
      .prepare(
        `SELECT id FROM analysis_batches WHERE status IN ('completed', 'analyzed') AND batch_end_ts - batch_start_ts >= 600
         ORDER BY batch_start_ts DESC LIMIT ?`
      )
      .all(batchCount) as Array<{ id: number }>
    return batches.map(({ id }) => {
      const shots = db
        .prepare(
          `SELECT s.captured_at AS capturedAt, s.file_path AS filePath FROM screenshots s
           JOIN batch_screenshots bs ON bs.screenshot_id = s.id WHERE bs.batch_id = ? ORDER BY s.captured_at`
        )
        .all(id) as Array<{ capturedAt: number; filePath: string }>
      const until = (shots[0]?.capturedAt ?? 0) + minutes * 60
      const kept = shots.filter((s) => s.capturedAt < until && existsSync(s.filePath))
      return { id, frames: sampleEvenly(kept).map((s) => ({ capturedAt: s.capturedAt, jpeg: readFileSync(s.filePath) })) }
    })
  } finally {
    db.close()
  }
}

/** Ollama's own API next to its OpenAI-compatible one. */
const ollama = (path: string, body: unknown) =>
  fetch(`${baseUrl.replace(/\/v1\/?$/, '')}/api/${path}`, { method: 'POST', body: JSON.stringify(body) }).then((r) => r.json())

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`

describe.skipIf(models.length === 0)('local model speed', () => {
  it('runs the two-step analysis per model', { timeout: 0 }, async () => {
    if (!isLocalUrl(baseUrl)) throw new Error(`${baseUrl} is not local; the benchmark only sends screenshots to this computer.`)
    if (!dataDir) throw new Error('No data folder found; set BENCH_DATA_DIR.')
    const batches = latestBatches().filter((b) => b.frames.length > 0)
    if (batches.length === 0) throw new Error(`No analyzed batches with screenshots in ${dataDir}.`)
    const loaded = ((await ollama('ps', {}).catch(() => ({ models: [] }))) as { models?: Array<{ name: string }> }).models ?? []
    console.log(`Data: ${dataDir}\nFirst ${minutes} min of batches: ${batches.map((b) => `#${b.id} (${b.frames.length} frames)`).join(', ')}`)
    if (loaded.length) console.log(`Note: already loaded in Ollama: ${loaded.map((m) => m.name).join(', ')}. A running app analyzing at the same time slows the results.`)

    const rows: string[][] = []
    for (const model of models) {
      const provider = createProvider({ kind: 'openai', model, baseUrl }, undefined)
      // Load first, so the first frame does not carry the load time.
      let started = Date.now()
      const load = await ollama('generate', { model, prompt: '', keep_alive: '10m' }).catch((err: unknown) => ({ error: String(err) }))
      const loadMs = Date.now() - started
      if ((load as { error?: string }).error) {
        rows.push([model, '–', '–', '–', '–', `load failed: ${(load as { error: string }).error}`])
        console.log(rows.at(-1)!.join(' · '))
        continue
      }
      for (const batch of batches) {
        let step1 = 0
        let step2 = 0
        let result = 'ok'
        try {
          started = Date.now()
          const observations = await transcribe(provider, batch.frames)
          step1 = Date.now() - started
          started = Date.now()
          const { card } = await cardFromObservations(provider, observations, DEFAULT_CATEGORIES, '', null)
          step2 = Date.now() - started
          result = `"${card.title}" (${card.category})`
        } catch (err) {
          if (!step1) step1 = Date.now() - started
          else step2 = Date.now() - started
          result = `failed: ${String(err).slice(0, 80)}`
        }
        rows.push([model, `#${batch.id}`, seconds(loadMs), `${seconds(step1)} (${seconds(step1 / batch.frames.length)}/frame)`, seconds(step2), result])
        // Each result as it comes, the table at the end.
        console.log(rows.at(-1)!.join(' · '))
      }
      // Free the memory for the next model.
      await ollama('generate', { model, keep_alive: 0 }).catch(() => {})
    }

    const head = ['Model', 'Batch', 'Load', 'Step 1: frames', 'Step 2: card', 'Result']
    const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)))
    const line = (r: string[]) => r.map((c, i) => c.padEnd(widths[i]!)).join(' | ')
    console.log(['', line(head), widths.map((w) => '-'.repeat(w)).join('-|-'), ...rows.map(line)].join('\n'))
  })
})
