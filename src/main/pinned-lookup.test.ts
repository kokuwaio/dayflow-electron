import type { LookupAddress } from 'node:dns'
import { describe, expect, it } from 'vitest'
import { publicOnlyLookup } from './pinned-lookup'

const resolver = (addresses: LookupAddress[]) => async () => addresses

/** Calls the lookup the way node:net does and collects its callback. */
function run(lookup: ReturnType<typeof publicOnlyLookup>, all: boolean) {
  return new Promise<{ err: Error | null; result: unknown }>((done) =>
    lookup('example.com', { all }, (err: Error | null, address: unknown, family?: number) => done({ err, result: all ? address : { address, family } }))
  )
}

describe('publicOnlyLookup (the connection uses exactly the checked addresses)', () => {
  it('hands public addresses to the connection', async () => {
    const lookup = publicOnlyLookup(resolver([{ address: '93.184.215.14', family: 4 }]))
    expect(await run(lookup, true)).toEqual({ err: null, result: [{ address: '93.184.215.14', family: 4 }] })
    expect(await run(lookup, false)).toEqual({ err: null, result: { address: '93.184.215.14', family: 4 } })
  })

  it('refuses a host when any address is local, including IPv4-mapped ones', async () => {
    const lookup = publicOnlyLookup(resolver([{ address: '93.184.215.14', family: 4 }, { address: '::ffff:192.168.1.10', family: 6 }]))
    const { err } = await run(lookup, true)
    expect(err?.message).toMatch(/local address/)
  })
})
