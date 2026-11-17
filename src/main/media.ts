// Serves screenshots and app icons to the sandboxed window through the
// dayflow-media:// scheme, so the renderer never gets file system access.
//   dayflow-media://frame/<screenshot id>  a frame from the recordings folder
//   dayflow-media://icon/<site>            a site's icon, cached on disk

import { lookup } from 'node:dns/promises'
import { mkdirSync } from 'node:fs'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { net, protocol } from 'electron'
import { MEDIA_SCHEME } from '../shared/media'
import { iconHost } from '../shared/favicon'
import { isPrivateAddress } from './private-address'

/** Must run before the app is ready. */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }])
}

const MAX_ICON_BYTES = 256 * 1024
/** A site without a usable icon is asked again after this long. */
const RETRY_FAILED_MS = 7 * 24 * 3600_000
const notFound = () => new Response(null, { status: 404 })

/** True when the host only resolves to this computer or the local network. */
async function resolvesPrivately(host: string): Promise<boolean> {
  try {
    const addresses = await lookup(host, { all: true })
    return addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))
  } catch {
    return true
  }
}

/** Reads at most `max` bytes of a response body; null when it is larger. */
async function readCapped(res: Response, max: number): Promise<Buffer | null> {
  if (Number(res.headers.get('content-length') ?? 0) > max) return null
  const reader = res.body?.getReader()
  if (!reader) return null
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

export function handleMedia(opts: {
  recordingsDir: string
  iconDir: string
  framePath: (id: number) => string | undefined
  iconsEnabled: () => boolean
}): void {
  mkdirSync(opts.iconDir, { recursive: true })
  const root = resolve(opts.recordingsDir) + sep
  const inFlight = new Map<string, Promise<{ body: Buffer; type: string } | null>>()

  /** Fetches https://<host>/favicon.ico from the site itself, never via an aggregator. */
  async function fetchIcon(host: string): Promise<{ body: Buffer; type: string } | null> {
    const failedMarker = join(opts.iconDir, `${host}.none`)
    try {
      if (Date.now() - (await stat(failedMarker)).mtimeMs < RETRY_FAILED_MS) return null
    } catch {
      // never failed
    }
    try {
      if (await resolvesPrivately(host)) throw new Error('local address')
      const res = await net.fetch(`https://${host}/favicon.ico`, { redirect: 'manual', signal: AbortSignal.timeout(5_000) })
      const type = res.headers.get('content-type')?.split(';')[0]?.trim() ?? ''
      if (res.status !== 200 || !type.startsWith('image/')) throw new Error('no icon')
      const body = await readCapped(res, MAX_ICON_BYTES)
      if (!body || body.length === 0) throw new Error('no icon')
      await writeFile(join(opts.iconDir, `${host}.img`), body)
      await writeFile(join(opts.iconDir, `${host}.type`), type)
      return { body, type }
    } catch {
      await writeFile(failedMarker, '').catch(() => {})
      return null
    }
  }

  protocol.handle(MEDIA_SCHEME, async (request) => {
    const url = new URL(request.url)
    if (url.hostname === 'frame') {
      const path = opts.framePath(Number(url.pathname.slice(1)))
      // Only files inside the recordings folder.
      if (!path || !resolve(path).startsWith(root)) return notFound()
      return net.fetch(pathToFileURL(path).toString())
    }
    if (url.hostname === 'icon') {
      const host = iconHost(decodeURIComponent(url.pathname.slice(1)))
      if (!host) return notFound()
      try {
        const [body, type] = await Promise.all([
          readFile(join(opts.iconDir, `${host}.img`)),
          readFile(join(opts.iconDir, `${host}.type`), 'utf8')
        ])
        return new Response(body, { headers: { 'content-type': type } })
      } catch {
        // not cached yet
      }
      if (!opts.iconsEnabled()) return notFound()
      let pending = inFlight.get(host)
      if (!pending) {
        pending = fetchIcon(host).finally(() => inFlight.delete(host))
        inFlight.set(host, pending)
      }
      const icon = await pending
      return icon ? new Response(icon.body, { headers: { 'content-type': icon.type } }) : notFound()
    }
    return notFound()
  })
}
