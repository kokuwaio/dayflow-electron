// Fetching site icons by a model-supplied host name without reaching the
// local network: the DNS answer is checked inside the connection's own
// lookup, so the address that was checked is the one that gets connected to
// (no second resolution an attacker could change in between).

import type { LookupAddress } from 'node:dns'
import { lookup as dnsLookup } from 'node:dns/promises'
import { get } from 'node:https'
import { isPrivateAddress } from './private-address'

type Resolver = (host: string) => Promise<LookupAddress[]>
type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void

/** A node:net `lookup` that fails for hosts with any local or private address. */
export function publicOnlyLookup(resolve: Resolver = (host) => dnsLookup(host, { all: true })) {
  return (host: string, options: { all?: boolean }, callback: LookupCallback): void => {
    resolve(host).then(
      (addresses) => {
        if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) {
          callback(Object.assign(new Error(`${host} resolves to a local address`), { code: 'EPRIVATE' }), [])
        } else if (options.all) {
          callback(null, addresses)
        } else {
          callback(null, addresses[0]!.address, addresses[0]!.family)
        }
      },
      (err: NodeJS.ErrnoException) => callback(err, [])
    )
  }
}

/** GET https://<host><path> through the guarded lookup; null unless it is a 200 image no larger than maxBytes. */
export function fetchPublicImage(host: string, path: string, maxBytes: number, timeoutMs = 5_000): Promise<{ body: Buffer; type: string } | null> {
  return new Promise((resolve) => {
    // Redirects are not followed: get() never does.
    const req = get({ host, path, lookup: publicOnlyLookup() as never, timeout: timeoutMs }, (res) => {
      const type = res.headers['content-type']?.split(';')[0]?.trim() ?? ''
      if (res.statusCode !== 200 || !type.startsWith('image/') || Number(res.headers['content-length'] ?? 0) > maxBytes) {
        res.resume()
        return resolve(null)
      }
      const chunks: Buffer[] = []
      let size = 0
      res.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > maxBytes) {
          req.destroy()
          resolve(null)
        } else chunks.push(chunk)
      })
      res.on('end', () => resolve(size > 0 && size <= maxBytes ? { body: Buffer.concat(chunks), type } : null))
      res.on('error', () => resolve(null))
    })
    req.on('timeout', () => req.destroy())
    req.on('error', () => resolve(null))
  })
}
