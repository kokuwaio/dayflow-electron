import { useCallback, useEffect, useRef, useState } from 'react'
import { type Category, PRIVATE_CATEGORY, SYSTEM_CATEGORY } from '@shared/categories'
import { parseKey, shiftDay, todayKey } from '@shared/day'
import type { Rating, TimelineCard } from '@shared/types'
import type { DayCards, Week } from '@shared/week'
import { AppIcon } from './AppIcon'
import { DaySummary } from './DaySummary'
import { FramePlayer } from './FramePlayer'
import { FilterBar, muteKey } from './FilterBar'
import { WeekGrid } from './WeekGrid'

/** Colors for cards the app writes itself, outside the user's categories. */
const BUILT_IN_COLORS: Record<string, string> = { [SYSTEM_CATEGORY]: '#E0A100', [PRIVATE_CATEGORY]: '#5C6B7A' }

const today = todayKey

function formatDay(key: string): string {
  return parseKey(key).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
}

const minutes = (c: TimelineCard) => Math.max(1, Math.round((c.end - c.start) / 60))

/** The rating covering most of the card, if any. */
function ratingFor(card: TimelineCard, ratings: Rating[]): Rating | undefined {
  return ratings
    .map((r) => ({ r, overlap: Math.min(r.end, card.end) - Math.max(r.start, card.start) }))
    .filter((x) => x.overlap > (card.end - card.start) / 2)
    .sort((a, b) => b.overlap - a.overlap)[0]?.r
}

export function Timeline() {
  const [day, setDay] = useState(today)
  const [mode, setMode] = useState<'day' | 'week'>('day')
  const [cards, setCards] = useState<TimelineCard[]>([])
  const [week, setWeek] = useState<(Week & { columns: DayCards[]; ratings: Rating[] }) | null>(null)
  const loadId = useRef(0)
  const [ratings, setRatings] = useState<Rating[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [muted, setMuted] = useState<Set<string>>(new Set())
  const [copied, setCopied] = useState(false)
  const [showIcons, setShowIcons] = useState(false)

  const load = useCallback(() => {
    // Only the newest request may update the view, so fast paging cannot show an older week.
    const id = ++loadId.current
    void window.dayflow.getDay(day).then((r) => {
      if (id !== loadId.current) return
      setCards(r.cards)
      setRatings(r.ratings)
    })
    if (mode === 'week') void window.dayflow.getWeek(day).then((w) => id === loadId.current && setWeek(w))
    void window.dayflow.getSettings().then((s) => {
      setCategories(s.categories)
      setShowIcons(s.showAppIcons)
    })
  }, [day, mode])

  useEffect(() => {
    load()
    return window.dayflow.onCardsChanged(load)
  }, [load])

  const colorOf = (category: string) =>
    categories.find((c) => c.name === category)?.color ?? BUILT_IN_COLORS[category] ?? '#888888'
  const allCards = mode === 'week' ? (week?.columns.flatMap((c) => c.cards) ?? []) : cards
  const visibleRatings = mode === 'week' ? (week?.ratings ?? []) : ratings
  const card = allCards.find((c) => c.id === selected) ?? null
  const isToday = day === today()
  const step = mode === 'week' ? 7 : 1
  const inCurrentPeriod = mode === 'week' ? (week?.columns.some((c) => c.day === today()) ?? true) : isToday

  return (
    <div className="timeline">
      <section className="day">
        <div className="daynav">
          <div className="segmented" role="group" aria-label="View">
            {(['day', 'week'] as const).map((m) => (
              <button key={m} className={mode === m ? 'active' : ''} onClick={() => (setMode(m), setSelected(null))}>
                {m === 'day' ? 'Day' : 'Week'}
              </button>
            ))}
          </div>
          <button aria-label={`Previous ${mode}`} onClick={() => setDay(shiftDay(day, -step))}>
            ‹
          </button>
          <h1>{mode === 'week' ? (week?.title ?? '') : isToday ? 'Today' : formatDay(day)}</h1>
          <button aria-label={`Next ${mode}`} disabled={inCurrentPeriod} onClick={() => setDay(shiftDay(day, step))}>
            ›
          </button>
          {!inCurrentPeriod && (
            <button className="link" onClick={() => setDay(today())}>
              Today
            </button>
          )}
          <span className="push-right" />
          <button
            className="link"
            onClick={() =>
              void window.dayflow.copyTimeline(mode, day).then(() => {
                setCopied(true)
                setTimeout(() => setCopied(false), 2000)
              })
            }
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
          {mode === 'day' && cards.length > 0 && (
            <button
              className="link"
              onClick={() => {
                if (confirm('Analyze this day again? Its cards are replaced; your recordings stay.')) {
                  void window.dayflow.reprocessDay(day)
                }
              }}
            >
              Reprocess day
            </button>
          )}
        </div>
        <FilterBar
          categories={categories}
          muted={muted}
          onToggle={(name) => {
            const next = new Set(muted)
            if (next.has(name)) next.delete(name)
            else next.add(name)
            setMuted(next)
          }}
          onReorder={(next) => {
            setCategories(next)
            void window.dayflow.saveSettings({ categories: next })
          }}
        />
        {mode === 'week' && week ? (
          <WeekGrid columns={week.columns} today={today()} selected={selected} muted={muted} colorOf={colorOf} onSelect={setSelected} />
        ) : cards.length === 0 ? (
          <p className="empty">
            {isToday
              ? 'No cards yet. The first ones appear about 15 minutes after recording starts.'
              : 'Nothing was recorded on this day.'}
          </p>
        ) : (
          <ol className="cards">
            {cards.map((c) => {
              const rating = ratingFor(c, ratings)
              return (
                <li key={c.id}>
                  <button
                    className={`card ${c.id === selected ? 'selected' : ''} ${muted.has(muteKey(c.category)) ? 'muted' : ''}`}
                    style={{ '--cat': colorOf(c.category) } as React.CSSProperties}
                    onClick={() => setSelected(c.id === selected ? null : c.id)}
                  >
                    <span className="time">
                      {c.startTime} – {c.endTime}
                      {rating && <span className="rated">{rating.rating === 'up' ? ' · 👍' : ' · 👎'}</span>}
                    </span>
                    <span className="title">
                      {showIcons && <AppIcon site={c.appSites.primary} />}
                      {c.title}
                    </span>
                    <span className="meta">
                      {c.category} · {minutes(c)} min
                    </span>
                  </button>
                </li>
              )
            })}
          </ol>
        )}
      </section>
      <aside className="detail">
        {card ? (
          <>
            <button className="link" onClick={() => setSelected(null)}>
              ← {mode === 'day' ? 'Day summary' : 'Close'}
            </button>
            <CardDetail
              key={card.id}
              card={card}
              color={colorOf(card.category)}
              categories={categories}
              rating={ratingFor(card, visibleRatings)}
              onDeleted={() => setSelected(null)}
            />
          </>
        ) : mode === 'day' ? (
          <DaySummary day={day} cards={cards} categories={categories} />
        ) : (
          <p className="empty">Select a card to see what happened.</p>
        )}
      </aside>
    </div>
  )
}

function CardDetail(props: {
  card: TimelineCard
  color: string
  categories: Category[]
  rating: Rating | undefined
  onDeleted: () => void
}) {
  const { card, color, categories, rating } = props
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(card.title)
  const [category, setCategory] = useState(card.category)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [showFrames, setShowFrames] = useState(false)
  const span = { start: card.start, end: card.end }
  const isFailed = card.category === SYSTEM_CATEGORY
  const [busy, setBusy] = useState<string | null>(null)
  const reprocess = () =>
    card.batchId !== null &&
    void window.dayflow
      .reprocessBatch(card.batchId)
      .then((ok) => setBusy(ok ? 'Queued for analysis.' : 'This batch is being analyzed right now; try again in a moment.'))

  return (
    <>
      <p className="time">
        {card.startTime} – {card.endTime} · {minutes(card)} min
      </p>
      {editing ? (
        <div className="edit">
          <input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Title" />
          <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
            {[...new Set([...categories.map((c) => c.name), card.category])].map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
          <div className="row">
            <button
              onClick={() =>
                void window.dayflow.updateCard(card.id, { title: title.trim() || card.title, category }).then(() => setEditing(false))
              }
            >
              Save
            </button>
            <button className="link" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <h2>{card.title}</h2>
          <span className="tag" style={{ background: color }}>
            {card.category}
            {card.subcategory ? ` · ${card.subcategory}` : ''}
          </span>
        </>
      )}
      <p>{card.summary}</p>

      <div className="row actions">
        {isFailed ? (
          card.batchId !== null && <button onClick={reprocess}>Retry</button>
        ) : (
          <>
            <button
              className={rating?.rating === 'up' ? 'active' : ''}
              aria-label="Good card"
              onClick={() => void window.dayflow.rateCard(span, 'up')}
            >
              👍
            </button>
            <button
              className={rating?.rating === 'down' ? 'active' : ''}
              aria-label="Bad card"
              onClick={() => setFeedback(rating?.feedback ?? '')}
            >
              👎
            </button>
            {!editing && <button onClick={() => setEditing(true)}>Edit</button>}
            {card.batchId !== null && card.category !== PRIVATE_CATEGORY && (
              <button onClick={() => confirm('Analyze this card\'s 15 minutes again?') && reprocess()}>Reanalyze</button>
            )}
          </>
        )}
        <button
          className="link danger"
          onClick={() => {
            if (confirm('Delete this card?')) void window.dayflow.deleteCard(card.id).then(props.onDeleted)
          }}
        >
          Delete
        </button>
      </div>
      {feedback !== null && (
        <div className="edit">
          <textarea
            rows={3}
            placeholder="What was wrong? (optional)"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
          />
          <div className="row">
            <button onClick={() => void window.dayflow.rateCard(span, 'down', feedback).then(() => setFeedback(null))}>
              Send 👎
            </button>
            <button className="link" onClick={() => setFeedback(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {busy && <p className="note">{busy}</p>}
      {rating?.feedback && feedback === null && <p className="note">Your note: {rating.feedback}</p>}

      {card.category !== PRIVATE_CATEGORY && (
        <>
          <button className="link" onClick={() => setShowFrames(!showFrames)}>
            {showFrames ? 'Hide screenshots' : 'Screenshots and timelapse'}
          </button>
          {showFrames && <FramePlayer start={card.start} end={card.end} />}
        </>
      )}
      {card.detailedSummary && (
        <>
          <h3>Details</h3>
          <pre className="log">{card.detailedSummary}</pre>
        </>
      )}
      {card.distractions.length > 0 && (
        <>
          <h3>Distractions</h3>
          <ul>
            {card.distractions.map((d, i) => (
              <li key={i}>
                <strong>
                  {d.startTime} – {d.endTime}
                </strong>{' '}
                {d.title}
                {d.summary ? `: ${d.summary}` : ''}
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}
