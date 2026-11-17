// Which website an appSites entry names, for its icon. Like upstream
// FaviconService.normalizedHost, but icons are fetched from the site itself,
// never through an aggregator such as Google's favicon service.

/** Names that only exist on local networks. */
const PRIVATE_SUFFIXES = ['.local', '.lan', '.internal', '.home.arpa', '.localhost', '.localdomain', '.intranet', '.corp']

/** The web host of an appSites value ("docs.google.com", "github.com/x"), or null for apps without one. */
export function iconHost(site: string | undefined | null): string | null {
  const raw = (site ?? '').trim().toLowerCase()
  if (!raw || /\s/.test(raw)) return null
  let host: string
  try {
    host = new URL(raw.includes('://') ? raw : `https://${raw}`).hostname
  } catch {
    return null
  }
  // A domain needs a dot and a top-level part; local names and addresses have no public icon.
  if (!host.includes('.') || /^\d+(\.\d+){3}$/.test(host) || PRIVATE_SUFFIXES.some((s) => host.endsWith(s))) return null
  return host
}
