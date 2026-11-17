// Screen capture through Electron for Windows and macOS: every interval a
// desktopCapturer screenshot of the display under the mouse, saved as a JPEG
// with the Linux helper's file names and reported with the same frame event.
// Approach after dayflow-windows (src/main/capture.js, MIT, see NOTICE.md),
// which grabs the display under the cursor the same way.

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { type DisplayInfo, type Point, displayUnderCursor, frameFileName, sourceForDisplay, thumbnailSize } from './frames'
import type { CaptureHandle, CaptureHandlers, CaptureOptions } from './types'

/** JPEG quality, the same as the Linux helper. */
const JPEG_QUALITY = 75
/** Failed screenshots in a row before capture gives up and the recorder backs off. */
const MAX_FAILURES = 3

/** The parts of Electron's screen and desktopCapturer modules capture uses. */
export interface CaptureDeps {
  screen: { getCursorScreenPoint(): Point; getAllDisplays(): DisplayInfo[] }
  desktopCapturer: {
    getSources(options: { types: Array<'screen' | 'window'>; thumbnailSize?: { width: number; height: number } }): Promise<
      Array<{ display_id: string; thumbnail: { isEmpty(): boolean; toJPEG(quality: number): Buffer } }>
    >
  }
  /** Writes a frame; defaults to the file system. */
  writeFile?(path: string, data: Buffer): Promise<void>
  /** Why capture may not run (e.g. a missing macOS permission), or null. Checked before each frame. */
  checkAccess?(): string | null
}

async function writeFrame(path: string, data: Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, data)
}

const seconds = (d: Date) => Math.floor(d.getTime() / 1000)

export function startElectronCapture(options: CaptureOptions, handlers: CaptureHandlers, deps: CaptureDeps): CaptureHandle {
  const write = deps.writeFile ?? writeFrame
  let blocked = false
  let stopped = false
  let failures = 0
  let timer: ReturnType<typeof setTimeout> | null = null

  const stop = () => {
    stopped = true
    if (timer) clearTimeout(timer)
    timer = null
  }

  const fail = (message: string) => {
    stop()
    handlers.failed(message)
  }

  const captureOnce = async (at: Date) => {
    if (blocked) return handlers.skipped(seconds(at))
    const denied = deps.checkAccess?.()
    if (denied) return fail(denied)
    try {
      const displays = deps.screen.getAllDisplays()
      const display = displayUnderCursor(displays, deps.screen.getCursorScreenPoint())
      if (!display) throw new Error('no display found')
      const sources = await deps.desktopCapturer.getSources({ types: ['screen'], thumbnailSize: thumbnailSize(display, options.height) })
      if (stopped) return
      // The recorder may have blocked capture while the screenshot was taken.
      if (blocked) return handlers.skipped(seconds(at))
      const source = sourceForDisplay(sources, display, displays.length)
      if (!source) throw new Error(`no capture source for display ${display.id}`)
      if (source.thumbnail.isEmpty()) throw new Error('the screenshot was empty')
      const jpeg = source.thumbnail.toJPEG(JPEG_QUALITY)
      const filePath = join(options.dir, frameFileName(at, displays.indexOf(display)))
      await write(filePath, jpeg)
      failures = 0
      handlers.frame({ filePath, capturedAt: seconds(at), bytes: jpeg.length })
    } catch (err) {
      if (stopped) return
      failures++
      if (failures >= MAX_FAILURES) fail(`Screenshot failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const tick = async () => {
    timer = null
    const started = Date.now()
    await captureOnce(new Date(started))
    if (!stopped) timer = setTimeout(() => void tick(), Math.max(0, options.intervalSec * 1000 - (Date.now() - started)))
  }

  // Not synchronously: the recorder calls setBlocked right after this returns.
  timer = setTimeout(() => void tick(), 0)
  return {
    stop,
    setBlocked(value) {
      blocked = value
    }
  }
}
