// Hides secrets in a frame before it goes to an AI provider: read the text
// (OCR), run upstream's rules on it and black out what they mask. The analysis
// pipeline calls this on the frames it sends; the files on disk stay as recorded.

import { redactJpeg, jpegSize } from './redact'
import { type OcrLine, secretRects } from './regions'

/** Reads the text of a JPEG frame. Tesseract in the app, a fake in tests. */
export interface OcrEngine {
  read(frame: Uint8Array): Promise<OcrLine[]>
  /** Frees the engine; the next read starts it again. */
  close(): Promise<void>
}

/** The frame with every secret the rules find blacked out; the same bytes when there is none. */
export async function hideSecrets(frame: Uint8Array, ocr: OcrEngine): Promise<Uint8Array> {
  const size = jpegSize(frame)
  if (!size) throw new Error('The frame is not a JPEG.')
  const rects = secretRects(await ocr.read(frame), size.height)
  return rects.length ? redactJpeg(frame, rects) : frame
}

/**
 * A frame filter for the pipeline: hides secrets while `enabled()` says so.
 * While it is off, frames pass unchanged and the OCR engine is released.
 */
export function secretFilter(ocr: OcrEngine, enabled: () => boolean): (frame: Uint8Array) => Promise<Uint8Array> {
  return async (frame) => {
    if (enabled()) return hideSecrets(frame, ocr)
    await ocr.close()
    return frame
  }
}
