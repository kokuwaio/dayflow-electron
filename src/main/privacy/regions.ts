// Where the secrets are on a frame: OCR lines in, pixel rectangles out. After
// upstream Core/PrivacyShield/PrivacyShieldFrameMasker.swift (line order, run
// boxes and padding), with Tesseract's word boxes in place of Apple Vision's
// per-character boxes.

import { maskLabels, maskedRuns } from './rules'

/** Pixels from the top-left corner; x1 and y1 are exclusive. */
export interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface OcrWord {
  text: string
  box: Rect
}

/** One line of text read off a frame; its text is the words joined by single spaces. */
export interface OcrLine {
  words: OcrWord[]
}

/** Padding around each box, as upstream pads before pixelating. */
const PAD = 3

/** Python's round(): halves to even. */
function roundHalfEven(x: number): number {
  const r = Math.round(x)
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r
}

const lineBox = (line: OcrLine): Rect => ({
  x0: Math.min(...line.words.map((w) => w.box.x0)),
  y0: Math.min(...line.words.map((w) => w.box.y0)),
  x1: Math.max(...line.words.map((w) => w.box.x1)),
  y1: Math.max(...line.words.map((w) => w.box.y1))
})

/**
 * Top to bottom in bands of 1% of the image height, then left to right, as
 * upstream orders Vision's lines (the rules look at the lines above).
 */
export function orderLines(lines: readonly OcrLine[], imageHeight: number): OcrLine[] {
  const band = 0.01 * imageHeight
  const keyed = lines
    .filter((l) => l.words.length > 0)
    .map((line) => {
      const box = lineBox(line)
      return { line, row: roundHalfEven(box.y0 / band), x: box.x0 }
    })
  keyed.sort((a, b) => a.row - b.row || a.x - b.x)
  return keyed.map((k) => k.line)
}

/** Pixel rectangles of every masked run on the frame, padded. */
export function secretRects(lines: readonly OcrLine[], imageHeight: number): Rect[] {
  const ordered = orderLines(lines, imageHeight)
  const layouts = ordered.map(layout)
  const labels = maskLabels(layouts.map((l) => l.text))
  const rects: Rect[] = []
  layouts.forEach((lay, n) => {
    for (const [start, end] of maskedRuns(labels[n]!)) {
      const box = runBox(lay, start, end)
      if (box) rects.push({ x0: box.x0 - PAD, y0: box.y0 - PAD, x1: box.x1 + PAD, y1: box.y1 + PAD })
    }
  })
  return rects
}

interface Layout {
  text: string
  /** Each word with its [start, end) in `text`. */
  spans: Array<{ word: OcrWord; start: number; end: number }>
}

function layout(line: OcrLine): Layout {
  const spans: Layout['spans'] = []
  let cursor = 0
  for (const word of line.words) {
    spans.push({ word, start: cursor, end: cursor + word.text.length })
    cursor += word.text.length + 1
  }
  return { text: line.words.map((w) => w.text).join(' '), spans }
}

/**
 * The box over characters [start, end) of a line: the union of the words they
 * touch. Where the run starts or ends inside a word, the cut is placed by the
 * characters' share of the word's width and widened by one character, since
 * OCR does not give character boxes.
 */
function runBox(lay: Layout, start: number, end: number): Rect | null {
  let box: Rect | null = null
  for (const { word, start: ws, end: we } of lay.spans) {
    if (we <= start || ws >= end) continue
    const length = Math.max(1, we - ws)
    const charWidth = (word.box.x1 - word.box.x0) / length
    const from = Math.max(start, ws)
    const to = Math.min(end, we)
    const x0 = word.box.x0 + (from - ws) * charWidth - (from > ws ? charWidth : 0)
    const x1 = word.box.x0 + (to - ws) * charWidth + (to < we ? charWidth : 0)
    const part = { x0: Math.max(word.box.x0, x0), y0: word.box.y0, x1: Math.min(word.box.x1, x1), y1: word.box.y1 }
    box = box
      ? { x0: Math.min(box.x0, part.x0), y0: Math.min(box.y0, part.y0), x1: Math.max(box.x1, part.x1), y1: Math.max(box.y1, part.y1) }
      : part
  }
  return box
}
