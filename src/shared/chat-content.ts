// What a chat answer contains, after upstream Dayflow: the trailing
// suggestions and memory blocks (Core/AI/ChatMetadataParser.swift,
// ChatService.parseAssistantMetadata) and fenced ```chart blocks
// (Views/UI/ChatCharts.swift). Pure string handling, shared by both sides.

export interface ChatMetadata {
  /** The answer without its metadata blocks. */
  text: string
  /** Follow-up questions offered as chips. */
  suggestions: string[]
  /** "Profile: …\nStyle: …", replacing the stored memory; null when the answer has none. */
  memory: string | null
}

const SUGGESTIONS_BLOCK = /(?:^|\n)\s*(?:#{1,6}\s*Suggestions\s*\n+|Suggestions:\s*)?```suggestions\s*\n([\s\S]*?)\n?```/gi
const MEMORY_BLOCK = /(?:^|\n)\s*(?:#{1,6}\s*Memory\s*\n+|Memory:\s*)?```memory\s*\n([\s\S]*?)\n?```/gi
const LOOSE_SUGGESTIONS = /(?:^|\n)\s*(?:#{1,6}\s*Suggestions\s*\n+|Suggestions:\s*\n?)(\[[\s\S]*?\])(?=\n\s*(?:#{1,6}\s*Memory\b|Memory:)|$(?![\s\S]))/gi
const LOOSE_MEMORY = /(?:^|\n)\s*(?:#{1,6}\s*Memory\s*\n+|Memory:\s*\n?)(Profile:[\s\S]*?Style:[^\n]*(?:\n[^#\n].*)*)$(?![\s\S])/gi
const LEFTOVER_HEADINGS = [/^\s*#{1,6}\s*Suggestions\s*$/gim, /^\s*#{1,6}\s*Memory\s*$/gim, /^\s*Suggestions:\s*$/gim, /^\s*Memory:\s*$/gim]

/** The first match's content and the text with every match replaced (NSRegularExpression semantics). */
function takeBlock(text: string, pattern: RegExp, replacement: string): [string, string] | null {
  pattern.lastIndex = 0
  const match = pattern.exec(text)
  if (!match) return null
  pattern.lastIndex = 0
  return [text.replace(pattern, replacement), match[1] ?? '']
}

function parseStringArray(raw: string): string[] | null {
  try {
    const value: unknown = JSON.parse(raw.trim())
    return Array.isArray(value) && value.every((v) => typeof v === 'string') ? value : null
  } catch {
    return null
  }
}

/** Keeps only the "Profile:" and "Style:" lines (upstream normalizeAutoMemoryBlob). */
function normalizeMemory(raw: string): string | null {
  let profile: string | undefined
  let style: string | undefined
  for (const line of raw.replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim())) {
    const lower = line.toLowerCase()
    if (lower.startsWith('profile:') && line.slice(8).trim()) profile = line.slice(8).trim()
    else if (lower.startsWith('style:') && line.slice(6).trim()) style = line.slice(6).trim()
  }
  const lines = [profile && `Profile: ${profile}`, style && `Style: ${style}`].filter(Boolean)
  return lines.length ? lines.join('\n') : null
}

export function chatMetadata(reply: string): ChatMetadata {
  let text = reply
  let suggestions: string[] = []
  let memory: string | null = null

  for (const [pattern, replacement] of [[SUGGESTIONS_BLOCK, ''], [LOOSE_SUGGESTIONS, '\n']] as const) {
    if (suggestions.length) break
    const found = takeBlock(text, pattern, replacement)
    if (!found) continue
    text = found[0]
    suggestions = parseStringArray(found[1]) ?? []
  }
  for (const [pattern, replacement] of [[MEMORY_BLOCK, ''], [LOOSE_MEMORY, '\n']] as const) {
    if (memory) break
    const found = takeBlock(text, pattern, replacement)
    if (!found) continue
    text = found[0]
    memory = normalizeMemory(found[1])
  }
  for (const heading of LEFTOVER_HEADINGS) text = text.replace(heading, '')
  return { text: text.trim(), suggestions, memory }
}

/** The answer as shown while it streams: metadata blocks, even half-typed fences, stay hidden. */
export function visibleStreamingText(text: string): string {
  const fence = /^[ \t]*```(?:suggestions|memory)\b/im.exec(text)
  if (fence) return text.slice(0, fence.index).trim()
  const lastLineStart = text.lastIndexOf('\n') + 1
  const lastLine = text.slice(lastLineStart).trim().toLowerCase()
  if (lastLine && ['```suggestions', '```memory'].some((f) => f.startsWith(lastLine))) return text.slice(0, lastLineStart).trim()
  return text
}

// ---------------------------------------------------------------- charts

export type ChatChart =
  | { type: 'bar' | 'line'; title: string; labels: string[]; values: number[]; color: string | null }
  | { type: 'stacked_bar'; title: string; categories: string[]; series: Array<{ name: string; values: number[]; color: string | null }> }
  | { type: 'donut'; title: string; labels: string[]; values: number[]; colors: Array<string | null> }
  | { type: 'heatmap'; title: string; xLabels: string[]; yLabels: string[]; values: number[][]; color: string | null }
  | { type: 'gantt'; title: string; items: Array<{ label: string; start: number; end: number; color: string | null }> }

export type ChatBlock = { kind: 'text'; text: string } | { kind: 'chart'; chart: ChatChart }

/** "#RRGGBB" or "#RRGGBBAA" in upper case, or null (upstream sanitizeHex). */
function hex(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const raw = value.trim().replace(/^#/, '')
  return /^(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(raw) ? `#${raw.toUpperCase()}` : null
}

const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string')
const isNumbers = (v: unknown): v is number[] => Array.isArray(v) && v.every((x) => typeof x === 'number' && Number.isFinite(x))

/** A chart from its fenced JSON, or null when the shape does not hold (upstream ChatChartSpec.parse). */
export function parseChart(type: string, json: string): ChatChart | null {
  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(json) as Record<string, unknown>
  } catch {
    return null
  }
  if (!payload || typeof payload !== 'object' || typeof payload.title !== 'string') return null
  const title = payload.title
  switch (type) {
    case 'bar':
    case 'line':
      if (!isStrings(payload.x) || !isNumbers(payload.y) || payload.x.length === 0 || payload.x.length !== payload.y.length) return null
      return { type, title, labels: payload.x, values: payload.y, color: hex(payload.color) }
    case 'stacked_bar': {
      if (!isStrings(payload.x) || payload.x.length === 0 || !Array.isArray(payload.series)) return null
      const x = payload.x
      const series = (payload.series as Array<Record<string, unknown>>)
        .filter((s) => s && typeof s.name === 'string' && isNumbers(s.values) && s.values.length > 0 && s.values.length === x.length)
        .map((s) => ({ name: s.name as string, values: s.values as number[], color: hex(s.color) }))
      return series.length ? { type, title, categories: x, series } : null
    }
    case 'donut':
    case 'pie': {
      if (!isStrings(payload.labels) || !isNumbers(payload.values) || payload.labels.length === 0 || payload.labels.length !== payload.values.length) return null
      const colors = Array.isArray(payload.colors) && payload.colors.length === payload.labels.length ? payload.colors.map(hex) : payload.labels.map(() => null)
      return { type: 'donut', title, labels: payload.labels, values: payload.values, colors }
    }
    case 'heatmap': {
      if (!isStrings(payload.x) || !isStrings(payload.y) || payload.x.length === 0 || payload.y.length === 0 || !Array.isArray(payload.values)) return null
      const width = payload.x.length
      const rows = payload.values as unknown[]
      if (rows.length !== payload.y.length || !rows.every((r) => isNumbers(r) && r.length === width)) return null
      return { type, title, xLabels: payload.x, yLabels: payload.y, values: rows as number[][], color: hex(payload.color) }
    }
    case 'gantt': {
      if (!Array.isArray(payload.items)) return null
      const items = (payload.items as Array<Record<string, unknown>>)
        .filter((i) => i && typeof i.label === 'string' && typeof i.start === 'number' && typeof i.end === 'number' && i.end > i.start)
        .map((i) => ({ label: i.label as string, start: i.start as number, end: i.end as number, color: hex(i.color) }))
      return items.length ? { type, title, items } : null
    }
    default:
      return null
  }
}

/** Text and chart blocks in order; a chart that does not parse stays as its raw text. */
export function chatBlocks(text: string): ChatBlock[] {
  const normalized = text.replace(/\r\n/g, '\n')
  const pattern = /```chart\s+type\s*=\s*([A-Za-z_]+)\s*\n?([\s\S]*?)\n?```/g
  const blocks: ChatBlock[] = []
  let at = 0
  for (const match of normalized.matchAll(pattern)) {
    const before = normalized.slice(at, match.index)
    if (before.trim()) blocks.push({ kind: 'text', text: before })
    const chart = parseChart(match[1]!.toLowerCase(), match[2]!.trim())
    blocks.push(chart ? { kind: 'chart', chart } : { kind: 'text', text: match[0] })
    at = match.index + match[0].length
  }
  if (blocks.length === 0) return [{ kind: 'text', text }]
  const tail = normalized.slice(at)
  if (tail.trim()) blocks.push({ kind: 'text', text: tail })
  return blocks
}
