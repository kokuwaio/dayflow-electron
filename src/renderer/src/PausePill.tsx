import { useEffect, useRef, useState } from 'react'
import { Play } from 'lucide-react'
import { PAUSE_PRESETS, describeRecorder } from '@shared/status'
import type { AppStatus } from '@shared/types'

/** ∞, 1h, 30m, 15m: the tray's presets, longest first like upstream. */
const CHIPS = [...PAUSE_PRESETS].reverse().map((p) => ({
  seconds: p.seconds,
  label: p.seconds === null ? '∞' : p.seconds >= 3600 ? `${p.seconds / 3600}h` : `${p.seconds / 60}m`,
  title: `Pause ${p.label.toLowerCase()}`
}))

const pad = (n: number) => String(n).padStart(2, '0')
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
  const [menu, setMenu] = useState(false)
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
    ? { text: until ? `Dayflow paused for ${countdown(until - now)}` : 'Dayflow paused indefinitely', muted: false }
    : blockedBy && state === 'recording'
      ? { text: 'Hidden: blocked app in front', muted: true }
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
            Resume
          </button>
        ) : (
          <>
            <button aria-expanded={menu} aria-label={menu ? 'Close pause options' : 'Pause recording'} onClick={() => setMenu(!menu)}>
              <span className="pause-glyph" aria-hidden="true">
                <i />
                <i />
              </span>
              Pause
            </button>
            {menu && (
              <div className="pause-chips" role="menu">
                {CHIPS.map((c) => (
                  <button
                    key={c.label}
                    role="menuitem"
                    className={c.seconds === null ? 'infinite' : ''}
                    title={c.title}
                    aria-label={c.title}
                    onClick={() => run(window.dayflow.pause(c.seconds))}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
