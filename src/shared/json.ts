// Models wrap JSON in fences and chatter. jsonCandidates() returns every
// plausible JSON value in a reply, most likely first, so each caller can pick
// the first one with the shape it expects.

/**
 * Top-level balanced [...] spans, string-aware so brackets inside JSON
 * strings do not count. An unclosed stray '[' in prose is skipped, so it
 * cannot hide a later array.
 */
function arraySpans(text: string): string[] {
  const spans: string[] = []
  for (let start = text.indexOf('['); start >= 0; start = text.indexOf('[', start + 1)) {
    let depth = 0
    let inString = false
    for (let i = start; i < text.length; i++) {
      const c = text[i]
      if (inString) {
        if (c === '\\') i++
        else if (c === '"') inString = false
      } else if (c === '"') inString = true
      else if (c === '[') depth++
      else if (c === ']' && --depth === 0) {
        spans.push(text.slice(start, i + 1))
        start = i // continue after this array: nested ones are not candidates of their own
        break
      }
    }
  }
  return spans
}

export function jsonCandidates(text: string): unknown[] {
  const found: unknown[] = []
  const tryParse = (s: string) => {
    try {
      found.push(JSON.parse(s))
    } catch {
      // not JSON
    }
  }
  const cleaned = text.replace(/```(?:json)?/g, '').trim()
  tryParse(cleaned)
  // Arrays, the last one first (models put the answer after their notes).
  for (const span of arraySpans(cleaned).reverse()) tryParse(span)
  const a = cleaned.indexOf('{')
  const b = cleaned.lastIndexOf('}')
  if (a >= 0 && b > a) tryParse(cleaned.slice(a, b + 1))
  return found
}

/** The first candidate that is an array, or that holds an array under `key`. */
export function jsonArray(text: string, key: string): unknown[] | null {
  for (const v of jsonCandidates(text)) {
    if (Array.isArray(v)) return v
    const inner = v && typeof v === 'object' ? (v as Record<string, unknown>)[key] : undefined
    if (Array.isArray(inner)) return inner
  }
  return null
}

/** The first candidate that is a plain object. */
export function jsonObject(text: string): Record<string, unknown> | null {
  for (const v of jsonCandidates(text)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>
  }
  return null
}
