// The full-window timelapse player, after upstream Dayflow's video expansion
// overlay (Views/UI/VideoPlayerModal.swift VideoExpansionOverlay): the card's
// title and time range, the frames at 90% of the window, a 20x/40x/60x speed
// chip and a scrubber. Space plays and pauses, Esc or a click on the backdrop
// closes. Upstream has no arrow keys; the scrubber steps frame by frame.

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Play, X } from 'lucide-react'
import { clockLabel } from '@shared/i18n'
import { type FrameRef, nextSpeed } from '@shared/media'
import { type PlayerPosition, frameClock } from './FramePlayer'
import { useFrames, useTimelapse } from './timelapse'
import './timelapse.css'

export function TimelapseOverlay(props: { title: string; start: number; end: number; at?: PlayerPosition; onClose: () => void }) {
  const { t } = useTranslation()
  const frames = useFrames(props.start, props.end)
  const dialog = useRef<HTMLDivElement>(null)
  useEffect(() => dialog.current?.focus(), [])
  const close = useRef(props.onClose)
  close.current = props.onClose
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      close.current()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  return createPortal(
    <div className="tl-player-backdrop" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="tl-player" role="dialog" aria-modal="true" aria-label={t('player.label')} tabIndex={-1} ref={dialog}>
        <header className="tl-player-head">
          <div>
            <h2>{props.title}</h2>
            <span>{t('player.range', { start: clockLabel(props.start), end: clockLabel(props.end) })}</span>
          </div>
          <button className="tl-player-close" aria-label={t('common.close')} onClick={props.onClose}>
            <X size={14} strokeWidth={2.5} />
          </button>
        </header>
        {frames === null ? (
          <div className="tl-player-stage">
            <span className="spinner dark" />
          </div>
        ) : frames.length === 0 ? (
          <div className="tl-player-stage">
            <p className="note">{t('frames.none')}</p>
          </div>
        ) : (
          <Player frames={frames} at={props.at} />
        )}
      </div>
    </div>,
    document.body
  )
}

function Player({ frames, at }: { frames: FrameRef[]; at: PlayerPosition | undefined }) {
  const { t } = useTranslation()
  const player = useTimelapse(frames, at ?? {})
  const frame = frames[player.index]!
  const toggle = useRef(player.toggle)
  toggle.current = player.toggle

  // Like upstream's key monitor: Space without modifiers plays and pauses, except while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== ' ' || e.ctrlKey || e.metaKey || e.altKey) return
      if (e.target instanceof HTMLTextAreaElement || (e.target instanceof HTMLInputElement && e.target.type !== 'range')) return
      e.preventDefault()
      e.stopPropagation()
      toggle.current()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  return (
    <>
      <div className="tl-player-stage" onClick={player.toggle}>
        <img src={frame.url} alt={t('frames.screenshotAt', { time: frameClock(frame.capturedAt) })} />
        {!player.playing && (
          <span className="tl-player-play" aria-hidden="true">
            <Play size={24} fill="currentColor" strokeWidth={0} />
          </span>
        )}
        <button
          className="tl-player-speed"
          aria-label={t('player.speed')}
          title={t('player.speed')}
          onClick={(e) => {
            e.stopPropagation()
            player.setSpeed(nextSpeed(player.speed))
          }}
        >
          {player.speed}x
        </button>
      </div>
      <footer className="tl-player-foot">
        <button className="tl-player-toggle" aria-label={player.playing ? t('frames.pause') : t('player.play')} onClick={player.toggle}>
          {player.playing ? '❚❚' : <Play size={14} fill="currentColor" strokeWidth={0} />}
        </button>
        <input type="range" min={0} max={frames.length - 1} value={player.index} aria-label={t('frames.position')} onChange={(e) => player.setIndex(Number(e.target.value))} />
        <span className="tl-player-time">
          {frameClock(frame.capturedAt)} · {player.index + 1}/{frames.length}
        </span>
      </footer>
    </>
  )
}
