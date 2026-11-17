import { describe, expect, it } from 'vitest'
import { isLocalUrl } from './providers'

describe('isLocalUrl', () => {
  it('treats IPv6 loopback, unique-local and link-local hosts as local', () => {
    expect(isLocalUrl('http://[fd12:3456:789a::10]:11434/v1')).toBe(true)
    expect(isLocalUrl('http://[fe80::1]:11434/v1')).toBe(true)
    expect(isLocalUrl('http://[::1]:11434/v1')).toBe(true)
    expect(isLocalUrl('https://[2606:4700::1111]/v1')).toBe(false)
  })
})
