import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { currentLanguage } from '@shared/i18n'
import type { FrameRef } from '@shared/media'

const SPEEDS = [20, 40, 60] as const
const clock = (ts: number) =>
  new Date(ts * 1000).toLocaleTimeString(currentLanguage() === 'en' ? 'en-US' : currentLanguage(), { hour: 'numeric', minute: '2-digit', second: '2-digit' })

/**
 * A card's screenshots: step through them, or play them as a timelapse at
 * 20x/40x/60x (upstream renders a video with ffmpeg; playing the frames needs
 * none).
 */
export function FramePlayer({ start, end }: { start: number; end: number }) {
  const { t } = useTranslation()
  const [frames, setFrames] = useState<FrameRef[]>([])
  const [index, setIndex] = useState(0)
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number] | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let current = true
    void window.dayflow.getFrames({ start, end }).then((f) => {
      if (!current) return // a newer card was opened meanwhile
      setFrames(f)
      setIndex(0)
    })
    return () => {
      current = false
    }
  }, [start, end])

  // Timelapse: wait the real gap between frames divided by the speed.
  useEffect(() => {
    if (speed === null) return
    const current = frames[index]
    const next = frames[index + 1]
    if (!current || !next) {
      setSpeed(null)
      return
    }
    // Long pauses (lock, idle) are shortened to 2 s so the timelapse keeps moving.
    timer.current = setTimeout(() => setIndex(index + 1), Math.min(2000, Math.max(50, ((next.capturedAt - current.capturedAt) * 1000) / speed)))
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [speed, index, frames])

  if (frames.length === 0) return <p className="note">{t('frames.none')}</p>
  const frame = frames[Math.min(index, frames.length - 1)]!

  return (
    <div className="player">
      <img src={frame.url} alt={t('frames.screenshotAt', { time: clock(frame.capturedAt) })} />
      <input
        type="range"
        min={0}
        max={frames.length - 1}
        value={index}
        aria-label={t('frames.position')}
        onChange={(e) => setIndex(Number(e.target.value))}
      />
      <div className="row">
        <button aria-label={t('frames.previous')} disabled={index === 0} onClick={() => setIndex(index - 1)}>
          ‹
        </button>
        <button aria-label={t('frames.next')} disabled={index >= frames.length - 1} onClick={() => setIndex(index + 1)}>
          ›
        </button>
        {speed === null ? (
          SPEEDS.map((s) => (
            <button key={s} onClick={() => (index >= frames.length - 1 && setIndex(0), setSpeed(s))}>
              ▶ {s}x
            </button>
          ))
        ) : (
          <button onClick={() => setSpeed(null)}>❚❚ {t('frames.pause')}</button>
        )}
        <span className="note push-right">
          {clock(frame.capturedAt)} · {index + 1}/{frames.length}
        </span>
      </div>
    </div>
  )
}
