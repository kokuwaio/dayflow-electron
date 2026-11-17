import { describe, expect, it } from 'vitest'
import { isPrivateAddress } from './private-address'

describe('isPrivateAddress (site icons never reach the local network)', () => {
  it('flags loopback, private, link-local and unspecified addresses in both families', () => {
    for (const a of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.10', '169.254.1.1', '100.64.0.1', '0.0.0.0', '::1', '::', 'fd00::1', 'fe80::1']) {
      expect(isPrivateAddress(a), a).toBe(true)
    }
  })

  it('applies the IPv4 rules to IPv4-mapped IPv6 addresses, dotted or hex', () => {
    expect(isPrivateAddress('::ffff:192.168.1.10')).toBe(true)
    expect(isPrivateAddress('::ffff:c0a8:010a')).toBe(true)
    expect(isPrivateAddress('::FFFF:7F00:1')).toBe(true)
  })

  it('lets public addresses through and treats junk as private', () => {
    expect(isPrivateAddress('93.184.215.14')).toBe(false)
    expect(isPrivateAddress('2606:2800:21f:cb07:6820:80da:af6b:8b2c')).toBe(false)
    expect(isPrivateAddress('::ffff:93.184.215.14')).toBe(false)
    expect(isPrivateAddress('not an address')).toBe(true)
  })
})
