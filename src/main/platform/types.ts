// The OS-specific pieces sit behind this interface, one implementation per
// platform (see ROADMAP.md, "Platform matrix").

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

export interface Platform {
  readonly name: string
  startCapture(options: CaptureOptions, handlers: CaptureHandlers): Stoppable
  watchSession(options: { idleSec: number }, handlers: SessionHandlers): Stoppable
  /** Turns launch at login on or off. */
  setAutostart(enable: boolean): Promise<void>
}
