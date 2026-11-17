import type { RecorderState } from '../../shared/types'
import type { CaptureOptions, Platform, Stoppable } from '../platform/types'

export interface RecordedFrame {
  filePath: string
  capturedAt: number
  fileSize: number
  /** Seconds without input at capture time; 0 while the user is active. */
  idleSeconds: number
}

export type { RecorderState }

export interface RecorderStatus {
  state: RecorderState
  /** Unix seconds: end of a timed pause or of the error backoff. */
  until: number | null
  lastError: string | null
}

const nowSec = () => Math.floor(Date.now() / 1000)

/** Wait after unlock or wake so monitors and the compositor are back. */
const RESUME_DELAY_MS = 5_000
/** Waits after consecutive capture failures; the last one repeats. */
const BACKOFF_SEC = [60, 120, 300, 600]

/** Drives capture through the platform: pause, lock, sleep and error backoff. */
export class Recorder {
  private capture: Stoppable | null = null
  private session: Stoppable | null = null
  private idleSince: number | null = null
  private running = false
  private locked = false
  private sleeping = false
  private resumeTimer: ReturnType<typeof setTimeout> | null = null
  private failures = 0
  private backoffUntil: number | null = null
  private lastError: string | null = null
  private backoffTimer: ReturnType<typeof setTimeout> | null = null
  /** false: not paused; null: paused until resume(); number: paused until then. */
  private pausedUntil: number | null | false = false
  private pauseTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly platform: Platform,
    private options: CaptureOptions,
    private readonly onFrame: (frame: RecordedFrame) => void
  ) {}

  start(): void {
    this.running = true
    this.session = this.platform.watchSession(
      { idleSec: 60 },
      {
        lock: (locked) => {
          this.locked = locked
          this.update(RESUME_DELAY_MS)
        },
        sleep: (sleeping) => {
          this.sleeping = sleeping
          this.update(RESUME_DELAY_MS)
        },
        idle: (since) => {
          this.idleSince = since
        },
        warning: () => {}
      }
    )
    this.startCapture()
  }

  stop(): void {
    this.running = false
    if (this.backoffTimer) clearTimeout(this.backoffTimer)
    this.backoffTimer = null
    this.backoffUntil = null
    this.clearPauseTimer()
    this.stopCapture()
    this.session?.stop()
    this.session = null
  }

  /** Applies new capture settings, keeping pause, lock and sleep state. */
  reconfigure(options: CaptureOptions): void {
    this.options = options
    if (this.capture) {
      this.stopCapture()
      this.update(0)
    }
  }

  /** Pauses capture for `seconds`, or until resume() when null. */
  pause(seconds: number | null): void {
    this.clearPauseTimer()
    this.pausedUntil = seconds === null ? null : nowSec() + seconds
    if (seconds !== null) this.pauseTimer = setTimeout(() => this.resume(), seconds * 1000)
    this.update(0)
  }

  resume(): void {
    this.clearPauseTimer()
    this.pausedUntil = false
    this.update(0)
  }

  private clearPauseTimer(): void {
    if (this.pauseTimer) clearTimeout(this.pauseTimer)
    this.pauseTimer = null
  }

  status(): RecorderStatus {
    const state = this.currentState()
    const until = state === 'backoff' ? this.backoffUntil : state === 'paused' && this.pausedUntil !== false ? this.pausedUntil : null
    return { state, until, lastError: this.lastError }
  }

  private currentState(): RecorderState {
    if (!this.running) return 'stopped'
    // Timers do not run while suspended, so a timed pause may have ended unnoticed.
    if (typeof this.pausedUntil === 'number' && nowSec() >= this.pausedUntil) {
      this.clearPauseTimer()
      this.pausedUntil = false
    }
    if (this.pausedUntil !== false) return 'paused'
    if (this.sleeping) return 'sleeping'
    if (this.locked) return 'locked'
    if (this.backoffUntil !== null) return 'backoff'
    return 'recording'
  }

  /** Stops capture while something blocks it; otherwise (re)starts it after delayMs. */
  private update(delayMs: number): void {
    if (this.currentState() !== 'recording') {
      this.stopCapture()
      return
    }
    if (this.capture || this.resumeTimer) return
    if (delayMs <= 0) {
      this.startCapture()
      return
    }
    this.resumeTimer = setTimeout(() => {
      this.resumeTimer = null
      if (this.currentState() === 'recording' && !this.capture) this.startCapture()
    }, delayMs)
  }

  private captureFailed(message: string): void {
    this.lastError = message
    const waitSec = BACKOFF_SEC[Math.min(this.failures, BACKOFF_SEC.length - 1)]!
    this.failures++
    this.backoffUntil = nowSec() + waitSec
    this.stopCapture()
    this.backoffTimer = setTimeout(() => {
      this.backoffTimer = null
      this.backoffUntil = null
      this.update(0)
    }, waitSec * 1000)
  }

  private stopCapture(): void {
    if (this.resumeTimer) clearTimeout(this.resumeTimer)
    this.resumeTimer = null
    this.capture?.stop()
    this.capture = null
  }

  private startCapture(): void {
    this.capture = this.platform.startCapture(this.options, {
      frame: (f) => {
        this.failures = 0
        this.lastError = null
        this.onFrame({
          filePath: f.filePath,
          capturedAt: f.capturedAt,
          fileSize: f.bytes,
          idleSeconds: this.idleSince === null ? 0 : Math.max(0, nowSec() - this.idleSince)
        })
      },
      failed: (message) => this.captureFailed(message)
    })
  }
}
