// Models wrap JSON in fences and chatter. jsonCandidates() returns every
// plausible JSON value in a reply, most likely first, so each caller can pick
// the first one with the shape it expects.

/**
 * Top-level balanced spans between `open` and `close` ([...] or {...}),
 * string-aware so brackets inside JSON strings do not count. An unclosed
 * stray bracket in prose is skipped, so it cannot hide a later value.
 */
function balancedSpans(text: string, open: '[' | '{', close: ']' | '}'): string[] {
  const spans: string[] = []
  for (let start = text.indexOf(open); start >= 0; start = text.indexOf(open, start + 1)) {
    let depth = 0
    let inString = false
    for (let i = start; i < text.length; i++) {
      const c = text[i]
      if (inString) {
        if (c === '\\') i++
        else if (c === '"') inString = false
      } else if (c === '"') inString = true
      else if (c === open) depth++
      else if (c === close && --depth === 0) {
        spans.push(text.slice(start, i + 1))
        start = i // continue after this value: nested ones are not candidates of their own
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
  // Only fence lines go, so backticks inside the JSON's own strings stay as written.
  const cleaned = text.replace(/^[ \t]*```[a-z]*[ \t]*$/gim, '').trim()
  tryParse(cleaned)
  // Arrays, then objects, the last one first (models put the answer after their notes).
  for (const span of balancedSpans(cleaned, '[', ']').reverse()) tryParse(span)
  for (const span of balancedSpans(cleaned, '{', '}').reverse()) tryParse(span)
  return found
}

/** The first candidate that is an array, or that holds an array under `key`. */
export function jsonArray(text: string, key: string): unknown[] | null {
  const candidates = jsonCandidates(text)
  // An object holding `key` wins over loose arrays: those can be its siblings ("notes": []).
  for (const v of candidates) {
    const inner = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>)[key] : undefined
    if (Array.isArray(inner)) return inner
  }
  return candidates.find((v): v is unknown[] => Array.isArray(v)) ?? null
}

/** The first candidate that is a plain object. */
export function jsonObject(text: string): Record<string, unknown> | null {
  for (const v of jsonCandidates(text)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>
  }
  return null
}
