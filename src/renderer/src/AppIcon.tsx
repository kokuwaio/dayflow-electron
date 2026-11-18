import { useState } from 'react'
import { iconUrl } from '@shared/media'

/** An appSites icon, served from the local cache or fetched from the site itself; hidden when there is none. */
export function AppIcon({ site }: { site: string | undefined }) {
  const [failed, setFailed] = useState(false)
  if (!site || failed) return null
  return <img className="app-icon" src={iconUrl(site)} alt="" onError={() => setFailed(true)} />
}
