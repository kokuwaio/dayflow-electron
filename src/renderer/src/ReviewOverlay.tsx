// The timeline review (upstream Views/UI/TimelineReviewOverlay.swift,
// TimelineReviewCard.swift, TimelineReviewChrome.swift): the day's unrated
// cards one by one, swiped or keyed as distracted, neutral or focused.

import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Trans, useTranslation } from 'react-i18next'
import { Meh, Sparkles, X, Zap } from 'lucide-react'
import { clockLabel, durationLabel, t } from '@shared/i18n'
import type { FrameRef } from '@shared/media'
import { type ReviewRating, type ReviewSegment, type ReviewSummary, reviewSummary, unreviewedCards } from '@shared/review'
import type { TimelineCard } from '@shared/types'
import { SYSTEM_CATEGORY, categoryKey } from '@shared/categories'

/** Each rating's look; `label` is read in the current app language. */
export const RATING_LOOK: Record<ReviewRating, { readonly label: string; color: string; soft: string; icon: typeof Zap }> = {
  distracted: { get label() { return t('review.ratings.distracted') }, color: '#FF8772', soft: '#FFBDB1', icon: Zap },
  neutral: { get label() { return t('review.ratings.neutral') }, color: '#EAE0DB', soft: '#FFFEFE', icon: Meh },
  focused: { get label() { return t('review.ratings.focused') }, color: '#42D0BB', soft: '#92F1E3', icon: Sparkles }
}
/** The tint over a card while it is dragged towards a rating. */
const DRAG_TINT: Record<ReviewRating, { bg: string; text: string; icon: string }> = {
  distracted: { bg: 'rgb(151 93 87 / 0.6)', text: '#F9D8D4', icon: '#FF7B67' },
  neutral: { bg: 'rgb(140 131 121 / 0.55)', text: '#F4F0ED', icon: '#C8C8C8' },
  focused: { bg: 'rgb(67 118 94 / 0.6)', text: '#D9F7E4', icon: '#47D2BD' }
}
const ORDER: ReviewRating[] = ['distracted', 'neutral', 'focused']

/** The rating a drag points at: past 30 px it shows, past 140 (sideways) or 120 (up) it commits. */
function dragRating(dx: number, dy: number, commit: boolean): ReviewRating | null {
  const [side, up] = commit ? [140, 120] : [30, 30]
  if (Math.abs(dx) >= Math.abs(dy)) return Math.abs(dx) > side ? (dx > 0 ? 'focused' : 'distracted') : null
  return -dy > up ? 'neutral' : null
}

export function ReviewOverlay({ day, cards, colorOf, onClose }: { day: string; cards: TimelineCard[]; colorOf: (c: string) => string; onClose: () => void }) {
  const { t } = useTranslation()
  const [segments, setSegments] = useState<ReviewSegment[]>([])
  const [session, setSession] = useState<TimelineCard[] | null>(null)
  const [index, setIndex] = useState(0)
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null)
  const [leaving, setLeaving] = useState<ReviewRating | null>(null)
  const [playing, setPlaying] = useState(false)
  const dragStart = useRef<{ x: number; y: number } | null>(null)

  const refresh = useCallback(() => window.dayflow.getReview(day).then((r) => (setSegments(r.segments), r.segments)), [day])
  useEffect(() => {
    // The session is fixed when the overlay opens; later ratings only update the totals.
    void refresh().then((s) => setSession(unreviewedCards(cards, s, day)))
  }, [])

  const current = session?.[index]
  const rate = useCallback(
    (rating: ReviewRating) => {
      if (!current || leaving) return
      setLeaving(rating)
      setDrag(null)
      setPlaying(false)
      void window.dayflow.rateReview({ start: current.start, end: current.end }, rating).then(refresh)
      setTimeout(() => {
        setLeaving(null)
        setIndex((i) => i + 1)
      }, 220)
    },
    [current, leaving, refresh]
  )
  const undo = useCallback(() => {
    // Like upstream: back to the previous card; its rating stays until it is rated again.
    if (index > 0 && !leaving) setIndex(index - 1)
  }, [index, leaving])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft') rate('distracted')
      else if (e.key === 'ArrowRight') rate('focused')
      else if (e.key === 'ArrowUp') rate('neutral')
      else if (e.key === 'z' || e.key === 'Z') undo()
      else if (e.key === ' ') setPlaying((p) => !p)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [rate, undo, onClose])

  const onPointerDown = (e: ReactPointerEvent) => {
    dragStart.current = { x: e.clientX, y: e.clientY }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: ReactPointerEvent) => {
    if (dragStart.current) setDrag({ x: e.clientX - dragStart.current.x, y: e.clientY - dragStart.current.y })
  }
  const onPointerUp = () => {
    const d = drag
    dragStart.current = null
    const rating = d && dragRating(d.x, d.y, true)
    if (rating) rate(rating)
    else setDrag(null)
  }

  if (!session) return null
  const done = index >= session.length
  const hint = drag ? dragRating(drag.x, drag.y, false) : leaving
  const away = leaving ? (leaving === 'neutral' ? { x: 0, y: -900 } : { x: leaving === 'focused' ? 900 : -900, y: 0 }) : (drag ?? { x: 0, y: 0 })

  // Over the whole window like upstream, outside the main panel's backdrop-filter.
  return createPortal(
    <div className="review-overlay" role="dialog" aria-modal="true" aria-label={t('timeline.reviewCards')}>
      <button className="review-close" aria-label={t('common.close')} onClick={onClose}>
        <X size={14} strokeWidth={2.5} />
      </button>
      {done ? (
        <ReviewDone empty={!cards.some((c) => categoryKey(c.category) !== categoryKey(SYSTEM_CATEGORY))} summary={reviewSummary(segments, day)} onClose={onClose} />
      ) : (
        <>
          <div className="review-stack">
            {session[index + 1] && <ReviewCard key={session[index + 1]!.id} card={session[index + 1]!} color={colorOf(session[index + 1]!.category)} position={`${index + 2}/${session.length}`} behind />}
            <div
              key={current!.id}
              className={`review-drag ${drag ? 'dragging' : ''}`}
              style={{ transform: `translate(${away.x}px, ${away.y}px) rotate(${away.x / 18}deg)`, opacity: leaving ? 0 : 1 }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={() => ((dragStart.current = null), setDrag(null))}
            >
              <ReviewCard card={current!} color={colorOf(current!.category)} position={`${index + 1}/${session.length}`} playing={playing} onTogglePlay={() => setPlaying(!playing)} />
              {hint && <DragTint rating={hint} />}
            </div>
          </div>
          <footer className="review-footer">
            <p>{t('review.swipeHint')}</p>
            <div className="review-keys">
              <button onClick={undo} disabled={index === 0}>
                <kbd>Z</kbd> {t('review.undo')}
              </button>
              {ORDER.map((r) => (
                <button key={r} onClick={() => rate(r)}>
                  <kbd className={`arrow ${r}`} aria-hidden="true" />
                  {RATING_LOOK[r].label}
                </button>
              ))}
            </div>
          </footer>
        </>
      )}
    </div>,
    document.body
  )
}

function DragTint({ rating }: { rating: ReviewRating }) {
  const tint = DRAG_TINT[rating]
  const Icon = RATING_LOOK[rating].icon
  return (
    <div className="review-tint" style={{ background: tint.bg, color: tint.text }}>
      <Icon size={48} color={tint.icon} />
      <b>{RATING_LOOK[rating].label}</b>
    </div>
  )
}

function ReviewCard(props: { card: TimelineCard; color: string; position: string; behind?: boolean; playing?: boolean; onTogglePlay?: () => void }) {
  const { t } = useTranslation()
  const { card, color } = props
  return (
    <article className={`review-card ${props.behind ? 'behind' : ''}`} aria-hidden={props.behind}>
      <ReviewMedia start={card.start} end={card.end} playing={!props.behind && !!props.playing} onToggle={props.onTogglePlay} />
      <div className="review-body">
        <h2>{card.title}</h2>
        <div className="review-pills">
          <span className="cat" style={{ '--c': color } as React.CSSProperties}>
            <span className="dot" />
            {card.category}
          </span>
          <span className="time">
            {t('card.timeRange', { start: clockLabel(card.start), end: clockLabel(card.end) })}
          </span>
        </div>
        <p className="review-summary">{card.summary}</p>
        <span className="review-pos">{props.position}</span>
      </div>
    </article>
  )
}

/** The card's screenshots as a timelapse at 20x; Space or a click plays and pauses. */
function ReviewMedia({ start, end, playing, onToggle }: { start: number; end: number; playing: boolean; onToggle?: () => void }) {
  const { t } = useTranslation()
  const [frames, setFrames] = useState<FrameRef[]>([])
  const [index, setIndex] = useState(0)
  useEffect(() => {
    let live = true
    void window.dayflow.getFrames({ start, end }).then((f) => live && (setFrames(f), setIndex(0)))
    return () => {
      live = false
    }
  }, [start, end])
  useEffect(() => {
    if (!playing || frames.length < 2) return
    const a = frames[index]
    const b = frames[(index + 1) % frames.length]
    const wait = a && b && b.capturedAt > a.capturedAt ? Math.min(2000, Math.max(50, ((b.capturedAt - a.capturedAt) * 1000) / 20)) : 500
    const timer = setTimeout(() => setIndex((i) => (i + 1) % frames.length), wait)
    return () => clearTimeout(timer)
  }, [playing, index, frames])
  const frame = frames[index]
  return (
    <div className="review-media" onClick={onToggle} onPointerDown={(e) => e.stopPropagation()}>
      {frame ? <img src={frame.url} alt="" draggable={false} /> : <span className="note">{t('frames.none')}</span>}
      {frames.length > 1 && <span className="review-progress" style={{ width: `${((index + 1) / frames.length) * 100}%` }} />}
      {frames.length > 1 && <span className="review-speed">{playing ? '20x' : t('review.spaceToPlay')}</span>}
    </div>
  )
}

/** Rated time per rating as proportional bars (upstream TimelineReviewSummaryBars). */
export function RatingBars({ summary, height, all }: { summary: ReviewSummary; height: number; all?: boolean }) {
  const shown = ORDER.filter((r) => all || summary[r] > 0)
  return (
    <div className="rating-bars" style={{ height }}>
      {shown.map((r) => (
        <span
          key={r}
          style={{
            flexGrow: summary.total ? summary[r] : 1,
            background: summary.total ? `linear-gradient(to right, ${RATING_LOOK[r].color}80, ${RATING_LOOK[r].color})` : 'var(--track-fill)'
          }}
        />
      ))}
    </div>
  )
}

function ReviewDone({ empty, summary, onClose }: { empty: boolean; summary: ReviewSummary; onClose: () => void }) {
  const { t } = useTranslation()
  if (empty)
    return (
      <div className="review-done">
        <h2 className="small">{t('review.nothingYet')}</h2>
        <p className="note">{t('review.comeBack')}</p>
      </div>
    )
  return (
    <div className="review-done">
      <h2>{t('review.allCaughtUp')}</h2>
      <p>
        <Trans i18nKey="review.allReviewed" components={{ br: <br /> }} />
      </p>
      {summary.total > 0 && (
        <>
          <RatingBars summary={summary} height={40} />
          <div className="rating-legend">
            {ORDER.filter((r) => summary[r] > 0).map((r) => {
              const Icon = RATING_LOOK[r].icon
              return (
                <span key={r}>
                  <span className="label">
                    <Icon size={16} color={RATING_LOOK[r].color === '#EAE0DB' ? '#B8ABA3' : RATING_LOOK[r].color} />
                    {RATING_LOOK[r].label}
                  </span>
                  <b>{durationLabel(Math.floor(summary[r] / 60))}</b>
                </span>
              )
            })}
          </div>
        </>
      )}
      <button className="review-close-btn" onClick={onClose}>
        {t('common.close')}
      </button>
    </div>
  )
}
