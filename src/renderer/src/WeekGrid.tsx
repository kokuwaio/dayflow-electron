import { useEffect, useRef } from 'react'
import { SYSTEM_CATEGORY } from '@shared/categories'
import { type DayCards, PX_PER_MIN, cardBox, mergeFailed, resolveOverlaps } from '@shared/week'
import { parseKey } from '@shared/day'
import { muteKey } from './FilterBar'

const HOURS = Array.from({ length: 24 }, (_, i) => (4 + i) % 24)
const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? 'AM' : 'PM'}`

/** Seven 4 AM-to-4 AM columns (upstream WeekTimelineGridView). */
export function WeekGrid(props: {
  columns: DayCards[]
  today: string
  selected: number | null
  muted: Set<string>
  colorOf: (category: string) => string
  onSelect: (id: number | null) => void
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const firstStart = props.columns.flatMap((c) => c.cards.map((card) => cardBox(card, c.day).top)).sort((a, b) => a - b)[0]

  // Scroll once to an hour before the week's first card.
  useEffect(() => {
    if (scroller.current && firstStart !== undefined) scroller.current.scrollTop = Math.max(0, firstStart - 60 * PX_PER_MIN)
  }, [props.columns.map((c) => c.day).join()]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="week">
      <div className="week-head">
        <span />
        {props.columns.map(({ day }) => {
          const date = parseKey(day)
          return (
            <span key={day} className={day === props.today ? 'today' : ''}>
              {date.toLocaleDateString([], { weekday: 'short' })} <b>{date.getDate()}</b>
            </span>
          )
        })}
      </div>
      <div className="week-body" ref={scroller} onClick={() => props.onSelect(null)}>
        <div className="week-grid" style={{ height: 24 * 60 * PX_PER_MIN }}>
          <div className="hours">
            {HOURS.map((h, i) => (
              <span key={i} style={{ top: i * 60 * PX_PER_MIN }}>
                {i === 0 ? '' : hourLabel(h)}
              </span>
            ))}
          </div>
          {props.columns.map(({ day, cards }) => (
            <div key={day} className="week-col">
              {resolveOverlaps(mergeFailed(cards)).map((card) => {
                const box = cardBox(card, day)
                const failed = card.category === SYSTEM_CATEGORY
                return (
                  <button
                    key={card.id}
                    className={`week-card ${failed ? 'failed' : ''} ${card.id === props.selected ? 'selected' : ''} ${
                      props.muted.has(muteKey(card.category)) ? 'muted' : ''
                    }`}
                    style={{ top: box.top, height: box.height, '--cat': props.colorOf(card.category) } as React.CSSProperties}
                    title={`${card.startTime} – ${card.endTime}: ${card.title}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      props.onSelect(card.id)
                    }}
                  >
                    {card.title}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
