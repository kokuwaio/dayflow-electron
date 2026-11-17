import { useCallback, useEffect, useState } from 'react'
import { type Category, PRIVATE_CATEGORY, SYSTEM_CATEGORY } from '@shared/categories'
import { dayKey, shiftDay } from '@shared/day'
import type { Rating, TimelineCard } from '@shared/types'

/** Colors for cards the app writes itself, outside the user's categories. */
const BUILT_IN_COLORS: Record<string, string> = { [SYSTEM_CATEGORY]: '#E0A100', [PRIVATE_CATEGORY]: '#5C6B7A' }

const today = () => dayKey(Math.floor(Date.now() / 1000))

function formatDay(key: string): string {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y!, m! - 1, d!).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
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
  const [cards, setCards] = useState<TimelineCard[]>([])
  const [ratings, setRatings] = useState<Rating[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [selected, setSelected] = useState<number | null>(null)

  const load = useCallback(() => {
    void window.dayflow.getDay(day).then((r) => {
      setCards(r.cards)
      setRatings(r.ratings)
    })
    void window.dayflow.getSettings().then((s) => setCategories(s.categories))
  }, [day])

  useEffect(() => {
    load()
    return window.dayflow.onCardsChanged(load)
  }, [load])

  const colorOf = (category: string) =>
    categories.find((c) => c.name === category)?.color ?? BUILT_IN_COLORS[category] ?? '#888888'
  const card = cards.find((c) => c.id === selected) ?? null
  const isToday = day === today()

  return (
    <div className="timeline">
      <section className="day">
        <div className="daynav">
          <button aria-label="Previous day" onClick={() => setDay(shiftDay(day, -1))}>
            ‹
          </button>
          <h1>{isToday ? 'Today' : formatDay(day)}</h1>
          <button aria-label="Next day" disabled={isToday} onClick={() => setDay(shiftDay(day, 1))}>
            ›
          </button>
          {!isToday && (
            <button className="link" onClick={() => setDay(today())}>
              Back to today
            </button>
          )}
          {cards.length > 0 && (
            <button
              className="link push-right"
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
        {cards.length === 0 ? (
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
                    className={`card ${c.id === selected ? 'selected' : ''}`}
                    style={{ '--cat': colorOf(c.category) } as React.CSSProperties}
                    onClick={() => setSelected(c.id)}
                  >
                    <span className="time">
                      {c.startTime} – {c.endTime}
                      {rating && <span className="rated">{rating.rating === 'up' ? ' · 👍' : ' · 👎'}</span>}
                    </span>
                    <span className="title">{c.title}</span>
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
          <CardDetail
            key={card.id}
            card={card}
            color={colorOf(card.category)}
            categories={categories}
            rating={ratingFor(card, ratings)}
            onDeleted={() => setSelected(null)}
          />
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
