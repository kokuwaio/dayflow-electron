// The app's log file, for "Copy debug logs" and bug reports: one line per
// message in logs/dayflow-electron.log in the data folder. When the next line
// would push it over 1 MB it becomes dayflow-electron.1.log (replacing the
// one before), so the log never takes more than about 2 MB. Lines go through
// redactSecrets, so API keys and the home folder never reach the disk.
// Writing is best effort: a full disk or a read-only folder never breaks the app.

import { appendFileSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { redactSecrets, timestamp } from '../shared/debug-report'

export const LOG_NAME = 'dayflow-electron.log'
export const ROTATED_LOG_NAME = 'dayflow-electron.1.log'
export const MAX_LOG_BYTES = 1024 * 1024
const MAX_MESSAGE_CHARS = 4000

/** Whether writing `incoming` bytes to a file of `size` bytes needs a fresh file first. An empty file takes any line. */
export function needsRotation(size: number, incoming: number, maxBytes: number): boolean {
  return size > 0 && size + incoming > maxBytes
}

/** One log line: local time, then the message on a single line, without secrets. */
export function logLine(at: Date, message: string, home?: string): string {
  const text = redactSecrets(message.replace(/\s*[\r\n]+\s*/g, ' ').trim(), home)
  const short = text.length > MAX_MESSAGE_CHARS ? `${text.slice(0, MAX_MESSAGE_CHARS - 1)}…` : text
  return `${timestamp(at)} ${short}\n`
}

export interface LogFileOptions {
  maxBytes?: number
  now?: () => Date
  home?: string
}

export class LogFile {
  private size: number | null = null
  private readonly maxBytes: number
  private readonly now: () => Date
  private readonly home: string | undefined

  constructor(
    readonly dir: string,
    options: LogFileOptions = {}
  ) {
    this.maxBytes = options.maxBytes ?? MAX_LOG_BYTES
    this.now = options.now ?? (() => new Date())
    this.home = options.home
  }

  get path(): string {
    return join(this.dir, LOG_NAME)
  }

  write(message: string): void {
    try {
      const line = logLine(this.now(), message, this.home)
      const bytes = Buffer.byteLength(line)
      if (this.size === null) {
        mkdirSync(this.dir, { recursive: true, mode: 0o700 })
        this.size = sizeOf(this.path)
      }
      if (needsRotation(this.size, bytes, this.maxBytes)) {
        renameSync(this.path, join(this.dir, ROTATED_LOG_NAME))
        this.size = 0
      }
      appendFileSync(this.path, line, { mode: 0o600 })
      this.size += bytes
    } catch {
      // Best effort: the message still went to the console. Look at the disk again next time.
      this.size = null
    }
  }

  /** The newest `maxLines` lines across both files, oldest first. */
  tail(maxLines: number): string[] {
    const lines = [ROTATED_LOG_NAME, LOG_NAME].flatMap((name) => readLines(join(this.dir, name)))
    return lines.slice(-maxLines)
  }
}

function sizeOf(path: string): number {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

function readLines(path: string): string[] {
  try {
    return readFileSync(path, 'utf8').split('\n').filter(Boolean)
  } catch {
    return []
  }
}
