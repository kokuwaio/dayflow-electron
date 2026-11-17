import type { ActiveWindow } from '../../shared/blocklist'

// The OS-specific pieces sit behind this interface, one implementation per
// platform (see docs/roadmap.md, "Platform matrix").

export interface CapturedFrame {
  filePath: string
  /** Unix seconds. */
  capturedAt: number
  bytes: number
}

export interface CaptureOptions {
  /** Directory for the JPEG frames. */
  dir: string
  intervalSec: number
  /** Frame height in pixels (720 or 1080). */
  height: number
}

export interface CaptureHandlers {
  frame(frame: CapturedFrame): void
  /** A frame was due but not saved because capture is blocked. at: Unix seconds. */
  skipped(at: number): void
  /** Capture stopped by itself; it will not produce more frames. */
  failed(message: string): void
}

export interface SessionHandlers {
  lock(locked: boolean): void
  sleep(sleeping: boolean): void
  /** idleSince: Unix seconds when input stopped; null when input resumed. */
  idle(idleSince: number | null): void
  warning(message: string): void
}

export interface Stoppable {
  stop(): void
}

export interface CaptureHandle extends Stoppable {
  /** While blocked, capture saves nothing and reports skipped() instead. */
  setBlocked(blocked: boolean): void
}

export interface WindowHandlers {
  /** The focused window changed (app ID and title). */
  window(window: ActiveWindow): void
  /** Window detection does not work here (e.g. no KWin access in Flatpak). */
  unavailable(reason: string): void
}

export interface Platform {
  readonly name: string
  startCapture(options: CaptureOptions, handlers: CaptureHandlers): CaptureHandle
  watchSession(options: { idleSec: number }, handlers: SessionHandlers): Stoppable
  watchActiveWindow(handlers: WindowHandlers): Stoppable
  /** Turns launch at login on or off. */
  setAutostart(enable: boolean): Promise<void>
}
