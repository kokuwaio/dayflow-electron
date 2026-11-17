// Serves screenshots and app icons to the sandboxed window through the
// dayflow-media:// scheme, so the renderer never gets file system access.
//   dayflow-media://frame/<screenshot id>  a frame from the recordings folder
//   dayflow-media://icon/<site>            a site's icon, cached on disk

import { mkdirSync } from 'node:fs'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { net, protocol } from 'electron'
import { MEDIA_SCHEME } from '../shared/media'
import { iconHost } from '../shared/favicon'
import { fetchPublicImage } from './pinned-lookup'

/** Must run before the app is ready. */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }])
}

const MAX_ICON_BYTES = 256 * 1024
/** A site without a usable icon is asked again after this long. */
const RETRY_FAILED_MS = 7 * 24 * 3600_000
const notFound = () => new Response(null, { status: 404 })

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
      // The checked DNS answer is the address that gets connected to (pinned-lookup.ts).
      const icon = await fetchPublicImage(host, '/favicon.ico', MAX_ICON_BYTES)
      if (!icon) throw new Error('no icon')
      const { body, type } = icon
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
