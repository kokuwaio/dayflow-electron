// OCR with tesseract.js (Tesseract compiled to WebAssembly, in a Node worker
// thread). The English model ships with the app (@tesseract.js-data/eng,
// 4.0.0_best_int) and is read from disk: nothing is downloaded and nothing is
// cached. One worker stays alive between batches until close().

import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import Tesseract from 'tesseract.js'
import type { OcrEngine } from './masker'
import type { OcrLine } from './regions'

// Not named `require`: the bundler adds its own `require` shim to the ES module output.
const requireHere = createRequire(import.meta.url)

/**
 * A frame that takes longer than this, worker start included, has a stuck
 * worker; it is restarted and the batch retried later.
 */
const READ_TIMEOUT_MS = 120_000

export function tesseractEngine(): OcrEngine {
  let worker: Promise<Tesseract.Worker> | null = null

  const start = () =>
    Tesseract.createWorker('eng', Tesseract.OEM.LSTM_ONLY, {
      // Electron's worker threads read app.asar, so the model can stay packed.
      langPath: join(dirname(requireHere.resolve('@tesseract.js-data/eng/package.json')), '4.0.0_best_int'),
      // 'none' neither reads nor writes a traineddata cache in the working directory.
      cacheMethod: 'none',
      gzip: true,
      // Without a handler tesseract.js rethrows job errors as uncaught exceptions; the job's promise rejects anyway.
      errorHandler: () => {}
    })

  /** Drops the worker (if it is still the current one); the next read starts a new one. */
  const drop = (current: Promise<Tesseract.Worker>) => {
    if (worker !== current) return
    worker = null
    void current.then((w) => w.terminate()).catch(() => {})
  }

  return {
    async read(frame) {
      const current = (worker ??= start())
      let timer: ReturnType<typeof setTimeout> | undefined
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('OCR took too long.')), READ_TIMEOUT_MS)
      })
      try {
        const w = await Promise.race([current, timeout])
        const { data } = await Promise.race([w.recognize(Buffer.from(frame), {}, { blocks: true, text: false }), timeout])
        return toLines(data.blocks ?? [])
      } catch (err) {
        drop(current)
        throw err instanceof Error ? err : new Error(String(err))
      } finally {
        clearTimeout(timer)
      }
    },
    async close() {
      const current = worker
      worker = null
      if (current) await current.then((w) => w.terminate()).catch(() => {})
    }
  }
}

function toLines(blocks: Tesseract.Block[]): OcrLine[] {
  return blocks.flatMap((b) =>
    b.paragraphs.flatMap((p) =>
      p.lines.map((l) => ({
        words: l.words
          .filter((w) => w.text.trim() !== '')
          .map((w) => ({ text: w.text.trim(), box: { ...w.bbox }, chars: (w.symbols ?? []).map((s) => ({ ...s.bbox })) }))
      }))
    )
  )
}
