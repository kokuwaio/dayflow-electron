// Which IP addresses count as "this computer or the local network", so that
// fetching a site icon by a model-supplied host name can never reach them.

import { BlockList, isIP } from 'node:net'

const blocked = new BlockList()
for (const [net, bits] of [
  ['0.0.0.0', 8], // "this network", unspecified
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4] // reserved, broadcast
] as const) {
  blocked.addSubnet(net, bits, 'ipv4')
}
for (const [net, bits] of [
  ['::', 128], // unspecified
  ['::1', 128],
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['ff00::', 8] // multicast
] as const) {
  blocked.addSubnet(net, bits, 'ipv6')
}

/**
 * True for loopback, private, link-local, multicast and reserved addresses,
 * and for anything that is not an IP address. BlockList checks IPv4-mapped
 * IPv6 addresses (::ffff:192.168.1.10, ::ffff:c0a8:10a) against the IPv4 rules.
 */
export function isPrivateAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 0) return true
  return blocked.check(address, family === 4 ? 'ipv4' : 'ipv6')
}
