import { useEffect, useRef } from 'react'
import { Pause, Play } from 'lucide-react'
import { recordingProjection } from '@shared/canvas'
import { SYSTEM_CATEGORY } from '@shared/categories'
import { formatClock, parseKey } from '@shared/day'
import type { RecorderState } from '@shared/types'
import { type DayCards, PX_PER_MIN, cardBox, mergeFailed, resolveOverlaps } from '@shared/week'
import { underFooter } from './DayCanvas'
import { muteKey } from './FilterBar'

const HOURS = Array.from({ length: 24 }, (_, i) => (4 + i) % 24)
const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? 'AM' : 'PM'}`
/** Title line height and vertical padding of a week card (upstream WeekTimelineGridView). */
const LINE = 12

/** Seven 4 AM-to-4 AM columns (upstream WeekTimelineGridView). */
export function WeekGrid(props: {
  columns: DayCards[]
  today: string
  now: number
  recorder: RecorderState | null
  selected: number | null
  muted: Set<string>
  colorOf: (category: string) => string
  onSelect: (id: number | null) => void
  /** Whether a card sits under the footer, which then hides its text. */
  onFooterOverlap: (overlaps: boolean) => void
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const boxes = props.columns.flatMap((c) => c.cards.map((card) => cardBox(card, c.day)))
  const firstStart = boxes.map((b) => b.top).sort((a, b) => a - b)[0]

  // Scroll once to an hour before the week's first card.
  useEffect(() => {
    if (scroller.current && firstStart !== undefined) scroller.current.scrollTop = Math.max(0, firstStart - 60 * PX_PER_MIN)
  }, [props.columns.map((c) => c.day).join()]) // eslint-disable-line react-hooks/exhaustive-deps
  // The grid starts 8 px into the scrolled content (room for the 4 AM label).
  const checkFooter = () => {
    if (scroller.current) props.onFooterOverlap(underFooter(scroller.current, boxes, 8))
  }
  useEffect(checkFooter)

  return (
    <div className="week">
      <div className="week-head">
        <span />
        {props.columns.map(({ day }) => {
          const date = parseKey(day)
          return (
            <span key={day} className={day === props.today ? 'today' : ''}>
              {date.toLocaleDateString([], { weekday: 'short' })} <b className="num">{date.getDate()}</b>
            </span>
          )
        })}
      </div>
      <div className="week-body" ref={scroller} onScroll={checkFooter} onClick={() => props.onSelect(null)}>
        <div className="week-grid" style={{ height: 24 * 60 * PX_PER_MIN }}>
          <div className="hours">
            {HOURS.map((h, i) => (
              <span key={i} style={{ top: i * 60 * PX_PER_MIN }}>
                {hourLabel(h)}
              </span>
            ))}
          </div>
          {props.columns.map(({ day, cards }) => {
            const segments = resolveOverlaps(mergeFailed(cards))
            const projection = props.recorder ? recordingProjection(day, segments, props.now) : null
            return (
              <div key={day} className="week-col">
                {segments.map((card) => {
                  const box = cardBox(card, day)
                  const failed = card.category === SYSTEM_CATEGORY
                  const short = box.height < 24
                  const lines = Math.max(1, Math.floor((box.height - (short ? 4 : 8)) / LINE))
                  return (
                    <button
                      key={card.id}
                      className={`week-card ${failed ? 'failed' : ''} ${short ? 'short' : ''} ${card.id === props.selected ? 'selected' : ''} ${
                        props.muted.has(muteKey(card.category)) ? 'muted' : ''
                      }`}
                      style={{ top: box.top, height: box.height, '--h': `${box.height}px`, '--cat': props.colorOf(card.category) } as React.CSSProperties}
                      title={`${formatClock(card.start)} - ${formatClock(card.end)}: ${card.title}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        props.onSelect(card.id)
                      }}
                    >
                      <span className="text" style={{ WebkitLineClamp: lines }}>
                        {failed ? 'Processing failed' : card.title}
                      </span>
                    </button>
                  )
                })}
                {projection && <WeekStatus box={cardBox(projection, day)} recorder={props.recorder!} />}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function WeekStatus({ box, recorder }: { box: { top: number; height: number }; recorder: RecorderState }) {
  const paused = recorder === 'paused' || recorder === 'stopped'
  const Icon = recorder === 'paused' ? Pause : Play
  return (
    <div className={`status-card week ${paused ? 'paused' : 'generating'}`} style={{ top: box.top, height: box.height }}>
      {paused ? <Icon size={9} fill="currentColor" strokeWidth={0} /> : box.height >= 20 && <span className="spinner" />}
      {box.height >= 14 && <span>{paused ? (recorder === 'paused' ? 'Paused' : 'Resume') : 'Next card...'}</span>}
    </div>
  )
}
