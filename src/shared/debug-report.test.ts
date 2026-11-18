import { describe, expect, it } from 'vitest'
import { type DebugReportInput, formatDebugReport, recentErrors, redactSecrets } from './debug-report'

const sec = (h: number, m: number, s = 0) => new Date(2026, 10, 18, h, m, s).getTime() / 1000

describe('redactSecrets', () => {
  it.each([
    ['Gemini key in a URL', 'POST https://g.test/v1beta/models/x:generate?key=AIzaSyA1234567890abcdefghijklmnopqrstu&alt=sse', 'POST https://g.test/v1beta/models/x:generate?key=[redacted]&alt=sse'],
    ['bare Google key', 'bad key AIzaSyA1234567890abcdefghijklmnopqrstu', 'bad key [redacted]'],
    ['OpenAI and Anthropic keys', 'keys sk-proj-abcDEF1234567890xyz and sk-ant-api03-abcdefghijklmnop', 'keys [redacted] and [redacted]'],
    ['bearer token', 'Authorization: Bearer eyJhbGciOi.payload.sig', 'Authorization: [redacted]'],
    ['API key header', '{"x-api-key": "abc123secret"}', '{"x-api-key": "[redacted]"}'],
    ['plain text stays', 'batch 4 failed: HTTP 429 (rate limit)', 'batch 4 failed: HTTP 429 (rate limit)']
  ])('%s', (_name, input, output) => {
    expect(redactSecrets(input)).toBe(output)
  })

  it('shortens the home folder to ~', () => {
    expect(redactSecrets('ENOENT /home/ana/.config/dayflow-electron/recordings/1.jpg', '/home/ana')).toBe('ENOENT ~/.config/dayflow-electron/recordings/1.jpg')
  })
})

describe('recentErrors', () => {
  const lines = [
    '2026-11-18 08:00:00 dayflow-electron 0.4.0',
    '2026-11-18 08:01:00 no API key for openai; skipping it',
    '2026-11-18 08:15:00 batch 3 failed: Gemini returned HTTP 503',
    '2026-11-18 08:16:00 purged 12 frames over the storage limit',
    '2026-11-18 08:20:00 updates: error: net::ERR_INTERNET_DISCONNECTED',
    '2026-11-18 08:30:00 could not delete blocked frame ~/x.jpg: EACCES',
    '2026-11-18 08:31:00 warning: the database is damaged',
    '2026-11-18 08:32:00 agent access: repairing registrations failed: timeout'
  ]

  it('keeps failures, errors and warnings, newest last', () => {
    expect(recentErrors(lines, 10)).toEqual([
      '2026-11-18 08:15:00 batch 3 failed: Gemini returned HTTP 503',
      '2026-11-18 08:20:00 updates: error: net::ERR_INTERNET_DISCONNECTED',
      '2026-11-18 08:30:00 could not delete blocked frame ~/x.jpg: EACCES',
      '2026-11-18 08:31:00 warning: the database is damaged',
      '2026-11-18 08:32:00 agent access: repairing registrations failed: timeout'
    ])
  })

  it('returns only the latest ones', () => {
    expect(recentErrors(lines, 2)).toEqual([lines[6], lines[7]])
  })
})

const input: DebugReportInput = {
  createdAt: new Date(2026, 10, 18, 10, 30, 0),
  about: [
    ['Version', '0.4.0'],
    ['Platform', 'linux x64, kernel 6.12.1'],
    ['Runtime', 'Electron 39.2.0, Chrome 142.0.7444.59, Node 22.20.0'],
    ['Build', 'flatpak'],
    ['Desktop', 'KDE (wayland)'],
    ['Fallback provider', null],
    ['Provider', 'gemini (gemini-2.5-flash)']
  ],
  cards: [
    {
      day: '2026-11-18',
      startTime: '9:00 AM',
      endTime: '9:15 AM',
      title: 'Fixing   the\nlog rotation',
      summary: 'Wrote tests for\n\nthe rotation.',
      category: 'Work',
      subcategory: 'Coding',
      createdAt: sec(9, 16, 2)
    },
    { day: '2026-11-18', startTime: '9:15 AM', endTime: '9:30 AM', title: '', summary: null, category: 'Idle', subcategory: null, createdAt: null }
  ],
  llmCalls: [
    {
      createdAt: sec(9, 15, 42),
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      operation: 'generate',
      ok: false,
      latencyMs: 1234,
      httpStatus: 429,
      batchId: 12,
      attempt: 2,
      error: 'ProviderError: quota exceeded for ?key=AIzaSyA1234567890abcdefghijklmnopqrstu'
    },
    { createdAt: sec(9, 16, 0), provider: 'ollama', model: '', operation: 'generate', ok: true, latencyMs: 8000, httpStatus: null, batchId: null, attempt: 1, error: null }
  ],
  batches: [{ id: 12, start: sec(9, 0), end: sec(9, 15), status: 'failed', reason: 'quota\nexceeded', attempts: 2, createdAt: sec(9, 15, 5) }],
  logLines: ['2026-11-18 09:15:43 batch 12 failed: quota exceeded', '2026-11-18 09:20:00 purged 3 frames over the storage limit'],
  home: '/home/ana'
}

describe('formatDebugReport', () => {
  it('lists the app, cards, LLM calls, batches and log errors like upstream DebugLogFormatter', () => {
    expect(formatDebugReport(input)).toBe(
      [
        'Dayflow Electron debug report, 2026-11-18 10:30:00',
        '',
        '--- App ---',
        'Version: 0.4.0',
        'Platform: linux x64, kernel 6.12.1',
        'Runtime: Electron 39.2.0, Chrome 142.0.7444.59, Node 22.20.0',
        'Build: flatpak',
        'Desktop: KDE (wayland)',
        'Provider: gemini (gemini-2.5-flash)',
        '',
        '--- Timeline cards (latest 2) ---',
        '1. [2026-11-18] 9:00 AM-9:15 AM | Fixing the log rotation | Work / Coding | created 2026-11-18 09:16:02',
        '   Summary: Wrote tests for the rotation.',
        '2. [2026-11-18] 9:15 AM-9:30 AM | Idle | created unknown',
        '',
        '--- LLM calls (latest 2) ---',
        '1. 2026-11-18 09:15:42 | gemini | gemini-2.5-flash | generate | failure | 1234ms | HTTP 429',
        '   batch 12, attempt 2',
        '   Error: ProviderError: quota exceeded for ?key=[redacted]',
        '2. 2026-11-18 09:16:00 | ollama | generate | success | 8000ms',
        '',
        '--- Analysis batches (latest 1) ---',
        '1. id=12 | status=failed | attempts 2 | created 2026-11-18 09:15:05',
        '   window: 2026-11-18 09:00:00 → 2026-11-18 09:15:00',
        '   reason: quota exceeded',
        '',
        '--- Errors in the log (latest 1) ---',
        '2026-11-18 09:15:43 batch 12 failed: quota exceeded'
      ].join('\n') + '\n'
    )
  })

  it('says "none" for empty sections', () => {
    const text = formatDebugReport({ ...input, cards: [], llmCalls: [], batches: [], logLines: [] })
    expect(text).toContain('--- Timeline cards: none ---')
    expect(text).toContain('--- LLM calls: none ---')
    expect(text).toContain('--- Analysis batches: none ---')
    expect(text).toContain('--- Errors in the log: none ---')
  })

  it('cuts long error messages and hides the home folder', () => {
    const call = { ...input.llmCalls[0]!, error: `ENOENT /home/ana/x ${'y'.repeat(2000)}` }
    const text = formatDebugReport({ ...input, llmCalls: [call] })
    const line = text.split('\n').find((l) => l.startsWith('   Error:'))!
    expect(line.startsWith('   Error: ENOENT ~/x yyy')).toBe(true)
    expect(line.length).toBeLessThanOrEqual(10 + 500)
    expect(line.endsWith('…')).toBe(true)
  })
})
