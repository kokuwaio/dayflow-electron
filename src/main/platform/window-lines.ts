// Parses the JSON lines that the Windows (PowerShell) and macOS (osascript)
// window watchers print: {"app": "...", "title": "..."} for the focused
// window, {"error": "..."} before a script gives up.

import type { ActiveWindow } from '../../shared/blocklist'

export type WindowLine = { type: 'window'; window: ActiveWindow } | { type: 'error'; message: string }

export function parseWindowLine(line: string): WindowLine | null {
  // Windows PowerShell may start its output with a byte order mark and ends lines with CRLF.
  const text = line.replace(/^﻿/, '').trim()
  if (!text.startsWith('{')) return null
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  if (typeof v.error === 'string') return v.error ? { type: 'error', message: v.error } : null
  if (typeof v.app !== 'string') return null
  return { type: 'window', window: { app: v.app, title: typeof v.title === 'string' ? v.title : '' } }
}
