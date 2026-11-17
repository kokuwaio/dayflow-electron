// Models wrap JSON in fences and chatter. jsonCandidates() returns every
// plausible JSON value in a reply, most likely first, so each caller can pick
// the first one with the shape it expects.

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
  // The last array, walking back from its closing bracket to the matching one.
  const end = cleaned.lastIndexOf(']')
  let depth = 0
  for (let i = end; i >= 0; i--) {
    if (cleaned[i] === ']') depth++
    else if (cleaned[i] === '[' && --depth === 0) {
      tryParse(cleaned.slice(i, end + 1))
      break
    }
  }
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
