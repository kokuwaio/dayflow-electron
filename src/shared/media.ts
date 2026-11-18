// URLs of the dayflow-media:// scheme (see src/main/media.ts).

export const MEDIA_SCHEME = 'dayflow-media'

/** A frame the window may show. */
export interface FrameRef {
  capturedAt: number
  url: string
}

export const frameUrl = (screenshotId: number) => `${MEDIA_SCHEME}://frame/${screenshotId}`
export const iconUrl = (site: string) => `${MEDIA_SCHEME}://icon/${encodeURIComponent(site)}`

/** Timelapse speeds (upstream's 20x, 40x and 60x chip). */
export const TIMELAPSE_SPEEDS = [20, 40, 60] as const
export type TimelapseSpeed = (typeof TIMELAPSE_SPEEDS)[number]

/** The speed the chip cycles to: 20x, 40x, 60x, then 20x again (upstream cycleSpeed). */
export const nextSpeed = (speed: TimelapseSpeed): TimelapseSpeed => TIMELAPSE_SPEEDS[(TIMELAPSE_SPEEDS.indexOf(speed) + 1) % TIMELAPSE_SPEEDS.length]!

/** How long a frame stays at `speed`: the real gap divided by the speed, at least 50 ms and at most 2 s (so lock and idle gaps pass quickly). */
export const frameDelayMs = (current: FrameRef, next: FrameRef, speed: number): number =>
  Math.min(2000, Math.max(50, ((next.capturedAt - current.capturedAt) * 1000) / speed))
