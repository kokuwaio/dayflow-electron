import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LOG_NAME, LogFile, ROTATED_LOG_NAME, logLine, needsRotation } from './log-file'

describe('needsRotation', () => {
  it('rotates only when the next line would push a non-empty file over the limit', () => {
    // 1000-byte limit: 900 + 100 fits exactly, one more byte does not.
    expect(needsRotation(900, 100, 1000)).toBe(false)
    expect(needsRotation(900, 101, 1000)).toBe(true)
    expect(needsRotation(0, 50, 1000)).toBe(false)
  })

  it('never rotates an empty file, even for a line longer than the limit', () => {
    expect(needsRotation(0, 5000, 1000)).toBe(false)
    expect(needsRotation(1, 5000, 1000)).toBe(true)
  })
})

describe('logLine', () => {
  const at = new Date(2026, 10, 18, 9, 5, 7)

  it('stamps the local time and keeps the message on one line', () => {
    expect(logLine(at, 'batch 12 failed:\n  HTTP 429\r\n  retry later')).toBe('2026-11-18 09:05:07 batch 12 failed: HTTP 429 retry later\n')
  })

  it('hides API keys and the home folder', () => {
    expect(logLine(at, 'GET https://x.test/v1?key=AIzaSyA1234567890abcdefghijklmnopqrstu failed for /home/ana/.config', '/home/ana')).toBe(
      '2026-11-18 09:05:07 GET https://x.test/v1?key=[redacted] failed for ~/.config\n'
    )
  })

  it('cuts very long messages', () => {
    const line = logLine(at, 'x'.repeat(10_000))
    expect(line.length).toBeLessThan(4100)
    expect(line.endsWith('…\n')).toBe(true)
  })
})

describe('LogFile', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dayflow-log-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const fixedNow = () => new Date(2026, 10, 18, 9, 0, 0)

  it('appends lines and reads them back', () => {
    const log = new LogFile(join(dir, 'logs'), { maxBytes: 1000, now: fixedNow })
    log.write('started')
    log.write('batch 3 failed: timeout')
    expect(readFileSync(join(dir, 'logs', LOG_NAME), 'utf8')).toBe('2026-11-18 09:00:00 started\n2026-11-18 09:00:00 batch 3 failed: timeout\n')
    expect(log.tail(10)).toEqual(['2026-11-18 09:00:00 started', '2026-11-18 09:00:00 batch 3 failed: timeout'])
  })

  it('keeps two files: the current one and the one before', () => {
    // Each line is 20 + 9 + 1 = 30 bytes; three fit under 100, the fourth rotates.
    const log = new LogFile(dir, { maxBytes: 100, now: fixedNow })
    for (let i = 1; i <= 7; i++) log.write(`message ${i}`)

    expect(readdirSync(dir).sort()).toEqual([ROTATED_LOG_NAME, LOG_NAME].sort())
    expect(readFileSync(join(dir, ROTATED_LOG_NAME), 'utf8').trim().split('\n').map((l) => l.slice(20))).toEqual(['message 4', 'message 5', 'message 6'])
    expect(readFileSync(join(dir, LOG_NAME), 'utf8').trim().split('\n').map((l) => l.slice(20))).toEqual(['message 7'])
    // tail reads across both files, oldest first.
    expect(log.tail(3).map((l) => l.slice(20))).toEqual(['message 5', 'message 6', 'message 7'])
    // Windows has no Unix permissions: every file reports 0o666 there.
    if (process.platform !== 'win32') expect(statSync(join(dir, LOG_NAME)).mode & 0o777).toBe(0o600)
  })

  it('continues a file from an earlier run and counts its size', () => {
    new LogFile(dir, { maxBytes: 70, now: fixedNow }).write('first run')
    const again = new LogFile(dir, { maxBytes: 70, now: fixedNow })
    again.write('second run')
    again.write('third line')
    expect(again.tail(5).map((l) => l.slice(20))).toEqual(['first run', 'second run', 'third line'])
    expect(readFileSync(join(dir, LOG_NAME), 'utf8').trim().split('\n').map((l) => l.slice(20))).toEqual(['third line'])
  })

  it('never throws when the folder cannot be written', () => {
    // A folder below a file can be created on no system.
    writeFileSync(join(dir, 'a-file'), '')
    const log = new LogFile(join(dir, 'a-file', 'logs'), { now: fixedNow })
    expect(() => log.write('lost')).not.toThrow()
    expect(log.tail(5)).toEqual([])
  })
})
