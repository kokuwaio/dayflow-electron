// URLs of the dayflow-media:// scheme (see src/main/media.ts).

export const MEDIA_SCHEME = 'dayflow-media'

/** A frame the window may show. */
export interface FrameRef {
  capturedAt: number
  url: string
}

export const frameUrl = (screenshotId: number) => `${MEDIA_SCHEME}://frame/${screenshotId}`
export const iconUrl = (site: string) => `${MEDIA_SCHEME}://icon/${encodeURIComponent(site)}`
