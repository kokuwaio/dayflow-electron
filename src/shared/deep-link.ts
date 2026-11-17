// Deep links that start and stop recording, after upstream Dayflow
// (App/AppDeepLinkRouter.swift), under this app's own scheme.

export const DEEP_LINK_SCHEME = 'dayflow-electron'

const ACTIONS: Record<string, 'start' | 'stop'> = {
  'start-recording': 'start',
  start: 'start',
  resume: 'start',
  'stop-recording': 'stop',
  stop: 'stop',
  pause: 'stop'
}

/** The recording action of a deep link, or null when it is none (other schemes, unknown actions). */
export function deepLinkAction(link: string): 'start' | 'stop' | null {
  let url: URL
  try {
    url = new URL(link)
  } catch {
    return null
  }
  if (url.protocol !== `${DEEP_LINK_SCHEME}:`) return null
  const candidates = [url.hostname, url.pathname.split('/').find(Boolean) ?? '', url.searchParams.get('action') ?? '']
  for (const candidate of candidates) {
    const action = ACTIONS[candidate.toLowerCase()]
    if (action) return action
  }
  return null
}
