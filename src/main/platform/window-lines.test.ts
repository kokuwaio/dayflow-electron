import { describe, expect, it } from 'vitest'
import { parseWindowLine } from './window-lines'

describe('parseWindowLine', () => {
  it('reads the PowerShell watcher output: process name and title', () => {
    expect(parseWindowLine('{"app":"KeePassXC","title":"Passwords.kdbx - KeePassXC"}')).toEqual({
      type: 'window',
      window: { app: 'KeePassXC', title: 'Passwords.kdbx - KeePassXC' }
    })
  })

  it('strips the CRLF and the UTF-8 byte order mark Windows PowerShell may print', () => {
    expect(parseWindowLine('﻿{"app":"chrome","title":"Neuer Tab \\u003e Inkognito"}\r')).toEqual({
      type: 'window',
      window: { app: 'chrome', title: 'Neuer Tab > Inkognito' }
    })
  })

  it('reads the osascript watcher output: bundle ID and a possibly empty title', () => {
    expect(parseWindowLine('{"app":"com.google.Chrome","title":""}')).toEqual({
      type: 'window',
      window: { app: 'com.google.Chrome', title: '' }
    })
    expect(parseWindowLine('{"app":"org.mozilla.firefox"}')).toEqual({
      type: 'window',
      window: { app: 'org.mozilla.firefox', title: '' }
    })
  })

  it('passes on the error lines the scripts print before they give up', () => {
    expect(parseWindowLine('{"error":"Error: access denied"}')).toEqual({ type: 'error', message: 'Error: access denied' })
  })

  it('ignores blank lines, noise and JSON that is not a window report', () => {
    for (const line of ['', '   ', 'WARNING: something', '[1,2]', 'null', '{"app":42,"title":"x"}', '{"title":"no app"}', '{"error":""}']) {
      expect(parseWindowLine(line)).toBeNull()
    }
  })
})
