import { useTranslation } from 'react-i18next'
import { Maximize2 } from 'lucide-react'
import { currentLanguage } from '@shared/i18n'
import { type FrameRef, TIMELAPSE_SPEEDS, type TimelapseSpeed } from '@shared/media'
import { useFrames, useTimelapse } from './timelapse'

export const frameClock = (ts: number) =>
  new Date(ts * 1000).toLocaleTimeString(currentLanguage() === 'en' ? 'en-US' : currentLanguage(), { hour: 'numeric', minute: '2-digit', second: '2-digit' })

/** Where the inline player was when it handed over to the full-window player. */
export interface PlayerPosition {
  index: number
  speed: TimelapseSpeed
  playing: boolean
}

/**
 * A card's screenshots: step through them, or play them as a timelapse at
 * 20x/40x/60x (upstream renders a video with ffmpeg; playing the frames needs
 * none). The expand button opens the full-window player at the same frame.
 */
export function FramePlayer({ start, end, onExpand }: { start: number; end: number; onExpand?: (at: PlayerPosition) => void }) {
  const { t } = useTranslation()
  const frames = useFrames(start, end)
  if (frames === null) return null
  if (frames.length === 0) return <p className="note">{t('frames.none')}</p>
  return <Frames key={`${start}-${end}`} frames={frames} onExpand={onExpand} />
}

function Frames({ frames, onExpand }: { frames: FrameRef[]; onExpand: ((at: PlayerPosition) => void) | undefined }) {
  const { t } = useTranslation()
  const player = useTimelapse(frames)
  const { index } = player
  const frame = frames[index]!

  return (
    <div className="player">
      <div className="player-frame">
        <img src={frame.url} alt={t('frames.screenshotAt', { time: frameClock(frame.capturedAt) })} />
        {onExpand && (
          <button
            className="player-expand"
            aria-label={t('player.expand')}
            title={t('player.expand')}
            onClick={() => {
              player.pause()
              onExpand({ index, speed: player.speed, playing: player.playing })
            }}
          >
            <Maximize2 size={14} />
          </button>
        )}
      </div>
      <input type="range" min={0} max={frames.length - 1} value={index} aria-label={t('frames.position')} onChange={(e) => player.setIndex(Number(e.target.value))} />
      <div className="row">
        <button aria-label={t('frames.previous')} disabled={index === 0} onClick={() => player.setIndex(index - 1)}>
          ‹
        </button>
        <button aria-label={t('frames.next')} disabled={index >= frames.length - 1} onClick={() => player.setIndex(index + 1)}>
          ›
        </button>
        {player.playing ? (
          <button onClick={player.pause}>❚❚ {t('frames.pause')}</button>
        ) : (
          TIMELAPSE_SPEEDS.map((s) => (
            <button key={s} onClick={() => player.play(s)}>
              ▶ {s}x
            </button>
          ))
        )}
        <span className="note push-right">
          {frameClock(frame.capturedAt)} · {index + 1}/{frames.length}
        </span>
      </div>
    </div>
  )
}
