import { useCallback, useEffect, useState } from 'react'
import { dayKey, shiftDay } from '@shared/day'
import type { TimelineCard } from '@shared/types'

export const CATEGORY_COLORS: Record<string, string> = {
  Work: '#B984FF',
  Personal: '#6AADFF',
  Distraction: '#FF5950',
  Idle: '#A0AEC0',
  Private: '#5C6B7A',
  System: '#E0A100'
}

const today = () => dayKey(Math.floor(Date.now() / 1000))

function formatDay(key: string): string {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y!, m! - 1, d!).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
}

const minutes = (c: TimelineCard) => Math.max(1, Math.round((c.end - c.start) / 60))

export function Timeline() {
  const [day, setDay] = useState(today)
  const [cards, setCards] = useState<TimelineCard[]>([])
  const [selected, setSelected] = useState<number | null>(null)

  const load = useCallback(() => {
    void window.dayflow.getDay(day).then((r) => setCards(r.cards))
  }, [day])

  useEffect(() => {
    load()
    return window.dayflow.onCardsChanged(load)
  }, [load])

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
        </div>
        {cards.length === 0 ? (
          <p className="empty">
            {isToday
              ? 'No cards yet. The first ones appear about 15 minutes after recording starts.'
              : 'Nothing was recorded on this day.'}
          </p>
        ) : (
          <ol className="cards">
            {cards.map((c) => (
              <li key={c.id}>
                <button
                  className={`card ${c.id === selected ? 'selected' : ''}`}
                  style={{ '--cat': CATEGORY_COLORS[c.category] ?? '#888' } as React.CSSProperties}
                  onClick={() => setSelected(c.id)}
                >
                  <span className="time">
                    {c.startTime} – {c.endTime}
                  </span>
                  <span className="title">{c.title}</span>
                  <span className="meta">
                    {c.category} · {minutes(c)} min
                  </span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </section>
      <aside className="detail">
        {card ? (
          <>
            <p className="time">
              {card.startTime} – {card.endTime} · {minutes(card)} min
            </p>
            <h2>{card.title}</h2>
            <span className="tag" style={{ background: CATEGORY_COLORS[card.category] ?? '#888' }}>
              {card.category}
              {card.subcategory ? ` · ${card.subcategory}` : ''}
            </span>
            <p>{card.summary}</p>
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
        ) : (
          <p className="empty">Select a card to see what happened.</p>
        )}
      </aside>
    </div>
  )
}
