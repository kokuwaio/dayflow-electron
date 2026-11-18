import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Play } from 'lucide-react'
import { pad } from '@shared/day'
import { DEFAULT_PAUSE_MINUTES, describeRecorder, pauseChipLabel, pauseChipTitle, pausePresets } from '@shared/status'
import type { AppStatus } from '@shared/types'


/** "14:59", or "1:02:05" for an hour or more. */
function countdown(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`
}

/**
 * Upstream's morphing pause control (Views/UI/PausePillView.swift): "Pause"
 * opens duration chips, a paused recorder shows an orange "Resume", and a
 * status text to its left tells how long the pause lasts.
 */
export function PausePill({ status, onChange }: { status: AppStatus; onChange: () => void }) {
  const { t } = useTranslation()
  const [menu, setMenu] = useState(false)
  const [minutes, setMinutes] = useState<readonly number[]>(DEFAULT_PAUSE_MINUTES)
  // The lengths from Settings → Other, read again each time the chips open.
  useEffect(() => {
    if (menu) void window.dayflow.getSettings().then((s) => setMinutes(s.pauseMinutes))
  }, [menu])
  /** ∞ and the three lengths, longest first like upstream; the same as the tray's. */
  const chips = pausePresets(minutes).reverse()
  const [now, setNow] = useState(() => Date.now() / 1000)
  const leave = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { state, until, blockedBy } = status.recorder
  const paused = state === 'paused'

  useEffect(() => {
    if (!paused || !until) return
    const timer = setInterval(() => setNow(Date.now() / 1000), 1000)
    return () => clearInterval(timer)
  }, [paused, until])
  useEffect(() => {
    if (!menu) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menu])

  const run = (p: Promise<unknown>) => void p.then(() => (setMenu(false), onChange()))
  const statusText = paused
    ? { text: until ? t('pause.pausedFor', { time: countdown(until - now) }) : t('pause.pausedIndefinitely'), muted: false }
    : blockedBy && state === 'recording'
      ? { text: t('pause.hiddenBlockedApp'), muted: true }
      : state !== 'recording'
        ? { text: describeRecorder(state, until), muted: true }
        : null

  return (
    <div className="tl-trail">
      {statusText && (
        <span key={statusText.text.replace(/\d/g, '')} className={`pause-status ${statusText.muted ? 'muted' : ''}`} role="status">
          {statusText.text}
        </span>
      )}
      <div
        className={`pause-pill ${paused ? 'paused' : menu ? 'menu' : ''}`}
        onMouseLeave={() => menu && (leave.current = setTimeout(() => setMenu(false), 600))}
        onMouseEnter={() => leave.current && clearTimeout(leave.current)}
      >
        {paused ? (
          <button onClick={() => run(window.dayflow.resume())}>
            <Play size={11} fill="currentColor" strokeWidth={0} />
            {t('pause.resume')}
          </button>
        ) : (
          <>
            <button aria-expanded={menu} aria-label={menu ? t('pause.closeOptions') : t('pause.pauseRecording')} onClick={() => setMenu(!menu)}>
              <span className="pause-glyph" aria-hidden="true">
                <i />
                <i />
              </span>
              {t('pause.pause')}
            </button>
            {menu && (
              <div className="pause-chips" role="menu">
                {chips.map((c) => {
                  const title = pauseChipTitle(c.seconds)
                  return (
                    <button
                      key={String(c.seconds)}
                      role="menuitem"
                      className={c.seconds === null ? 'infinite' : ''}
                      title={title}
                      aria-label={title}
                      onClick={() => run(window.dayflow.pause(c.seconds))}
                    >
                      {pauseChipLabel(c.seconds)}
                    </button>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
