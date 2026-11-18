import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Markdown from 'react-markdown'
import { Image, Pencil, Play, RotateCw, ThumbsDown, ThumbsUp, X } from 'lucide-react'
import { type Category, PRIVATE_CATEGORY, SYSTEM_CATEGORY } from '@shared/categories'
import { clockLabel } from '@shared/i18n'
import type { Rating, TimelineCard } from '@shared/types'
import { FramePlayer } from './FramePlayer'

/** A button that asks "Confirm" on the first click and acts on the second; it resets after 3 s. */
function ConfirmButton({ label, className, onConfirm }: { label: string; className?: string; onConfirm: () => void }) {
  const { t } = useTranslation()
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const timer = setTimeout(() => setArmed(false), 3000)
    return () => clearTimeout(timer)
  }, [armed])
  return armed ? (
    <button className="confirm" onClick={() => (setArmed(false), onConfirm())}>
      {t('common.confirm')}
    </button>
  ) : (
    <button className={`text-btn ${className ?? ''}`} onClick={() => setArmed(true)}>
      {label}
    </button>
  )
}

/**
 * The inspector for a selected card (upstream MainView/ActivityCard.swift and
 * TimelineRateSummaryView.swift): inline title edit, time and category chips,
 * timelapse, summaries, and a footer to rate or delete it.
 */
export function CardDetail(props: {
  card: TimelineCard
  color: string
  categories: Category[]
  rating: Rating | undefined
  onClose: () => void
  onDeleted: () => void
  onEditCategories: () => void
}) {
  const { t } = useTranslation()
  const { card, color, categories, rating } = props
  const [editingTitle, setEditingTitle] = useState(false)
  const [title, setTitle] = useState(card.title)
  const [picker, setPicker] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [poster, setPoster] = useState<string | null | undefined>(undefined)
  const [busy, setBusy] = useState<string | null>(null)
  const cancelled = useRef(false)
  const span = { start: card.start, end: card.end }
  const isFailed = card.category === SYSTEM_CATEGORY
  const isPrivate = card.category === PRIVATE_CATEGORY

  useEffect(() => {
    if (isPrivate) return
    let current = true
    void window.dayflow.getFrames(span).then((frames) => current && setPoster(frames[Math.floor(frames.length / 2)]?.url ?? null))
    return () => {
      current = false
    }
  }, [card.start, card.end]) // eslint-disable-line react-hooks/exhaustive-deps

  const saveTitle = () => {
    setEditingTitle(false)
    if (cancelled.current) {
      cancelled.current = false
      setTitle(card.title)
      return
    }
    const next = title.trim()
    if (next && next !== card.title) void window.dayflow.updateCard(card.id, { title: next })
    else setTitle(card.title)
  }
  const reprocess = () =>
    card.batchId !== null &&
    void window.dayflow
      .reprocessBatch(card.batchId)
      .then((ok) => setBusy(ok ? t('card.queued') : t('card.busy')))
  const names = [...new Set([...categories.map((c) => c.name), card.category])]

  return (
    <>
      <div className="inspector-scroll">
        <div className="detail" key={card.id}>
          <div className="detail-title">
            {editingTitle ? (
              <input
                autoFocus
                value={title}
                aria-label={t('card.title')}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={saveTitle}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur()
                  if (e.key === 'Escape') {
                    cancelled.current = true
                    e.currentTarget.blur()
                  }
                }}
              />
            ) : (
              <h2 onClick={() => setEditingTitle(true)} title={t('card.clickToEdit')}>
                {card.title}
              </h2>
            )}
            {!editingTitle && (
              <button className="icon-circle" aria-label={t('card.editTitle')} onClick={() => setEditingTitle(true)}>
                <Pencil size={12} />
              </button>
            )}
            <button className="bare note" aria-label={t('common.close')} onClick={props.onClose}>
              <X size={16} />
            </button>
          </div>

          <div className="meta-row">
            <span className="meta-chip">
              {t('card.timeRange', { start: clockLabel(card.start), end: clockLabel(card.end) })}
            </span>
            <span className="push-right" />
            <span className="meta-chip">
              <span className="dot" style={{ background: color }} />
              {card.category}
              {card.subcategory ? ` · ${card.subcategory}` : ''}
            </span>
            {!isFailed && (
              <button className="icon-circle" aria-label={t('card.changeCategory')} aria-expanded={picker} onClick={() => setPicker(!picker)}>
                <Pencil size={12} />
              </button>
            )}
            {picker && (
              <div className="picker" role="menu">
                {names.map((name) => (
                  <button
                    key={name}
                    role="menuitemradio"
                    aria-checked={name === card.category}
                    className={name === card.category ? 'on' : ''}
                    onClick={() => {
                      setPicker(false)
                      if (name !== card.category) void window.dayflow.updateCard(card.id, { category: name })
                    }}
                  >
                    <span className="dot" style={{ background: categories.find((c) => c.name === name)?.color ?? color, width: 8, height: 8 }} />
                    {name}
                  </button>
                ))}
                <button className="link" onClick={props.onEditCategories}>
                  {t('card.editCategories')}
                </button>
              </div>
            )}
          </div>

          {isFailed && card.batchId !== null && (
            <button className="btn-primary" style={{ alignSelf: 'flex-start', padding: '8px 12px' }} onClick={reprocess}>
              <RotateCw size={13} />
              {t('card.retry')}
            </button>
          )}
          {busy && <p className="note">{busy}</p>}

          {!isPrivate &&
            (playing ? (
              <FramePlayer start={card.start} end={card.end} />
            ) : poster === null ? (
              <p className="note">{t('frames.none')}</p>
            ) : (
              <button
                className="timelapse"
                style={poster ? { backgroundImage: `url("${poster}")` } : undefined}
                aria-label={t('card.playTimelapse')}
                onClick={() => setPlaying(true)}
              >
                {poster === undefined ? (
                  <Image size={28} />
                ) : (
                  <span className="play">
                    <Play size={24} fill="currentColor" strokeWidth={0} />
                  </span>
                )}
              </button>
            ))}

          {card.summary && (
            <div>
              <div className="label-caps">{t('card.summary')}</div>
              <div className="md">
                <Markdown>{card.summary}</Markdown>
              </div>
            </div>
          )}
          {card.detailedSummary && card.detailedSummary.trim() !== card.summary.trim() && (
            <div>
              <div className="label-caps">{t('card.detailedSummary')}</div>
              <div className="md">
                <Markdown>{card.detailedSummary}</Markdown>
              </div>
            </div>
          )}
          {card.distractions.length > 0 && (
            <div>
              <div className="label-caps">{t('card.distractions')}</div>
              <ul className="distraction-list">
                {card.distractions.map((d, i) => (
                  <li key={i}>
                    <b>
                      {d.startTime} - {d.endTime}
                    </b>{' '}
                    {d.title}
                    {d.summary ? `: ${d.summary}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {rating?.feedback && feedback === null && <p className="note">{t('card.yourNote', { note: rating.feedback })}</p>}
        </div>
      </div>

      {feedback !== null && (
        <div className="feedback-card">
          <strong style={{ fontSize: 13 }}>{t('card.whatWasWrong')}</strong>
          <textarea rows={3} autoFocus placeholder={t('common.optional')} value={feedback} onChange={(e) => setFeedback(e.target.value)} />
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button onClick={() => setFeedback(null)}>{t('common.cancel')}</button>
            <button className="btn-primary" onClick={() => void window.dayflow.rateCard(span, 'down', feedback).then(() => setFeedback(null))}>
              {t('card.send')}
            </button>
          </div>
        </div>
      )}
      <div className="rate-bar">
        {!isFailed && (
          <>
            <span className="rate-label" title={t('card.rateSummary')}>
              {t('card.rateSummary')}
            </span>
            <button
              className={`rate-thumb ${rating?.rating === 'up' ? 'on' : ''}`}
              aria-label={t('card.goodCard')}
              aria-pressed={rating?.rating === 'up'}
              onClick={() => void window.dayflow.rateCard(span, 'up')}
            >
              <ThumbsUp size={14} />
            </button>
            <button
              className={`rate-thumb ${rating?.rating === 'down' ? 'on' : ''}`}
              aria-label={t('card.badCard')}
              aria-pressed={rating?.rating === 'down'}
              onClick={() => setFeedback(rating?.feedback ?? '')}
            >
              <ThumbsDown size={14} />
            </button>
          </>
        )}
        <span className="push-right" />
        {!isFailed && card.batchId !== null && !isPrivate && <ConfirmButton label={t('card.reanalyze')} className="neutral" onConfirm={reprocess} />}
        <ConfirmButton label={t('common.delete')} onConfirm={() => void window.dayflow.deleteCard(card.id).then(props.onDeleted)} />
      </div>
    </>
  )
}
