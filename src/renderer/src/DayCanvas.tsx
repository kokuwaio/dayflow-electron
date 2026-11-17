import { useEffect, useLayoutEffect, useRef } from 'react'
import { Pause, Play } from 'lucide-react'
import { DAY_HEIGHT, HOUR_HEIGHT, cardTextMode, dayCardBox, hourMarks, nowScrollTop, recordingProjection } from '@shared/canvas'
import { SYSTEM_CATEGORY } from '@shared/categories'
import { formatClock } from '@shared/day'
import type { RecorderState, TimelineCard } from '@shared/types'
import { mergeFailed, resolveOverlaps } from '@shared/week'
import { AppIcon } from './AppIcon'
import { muteKey } from './FilterBar'

/**
 * Whether a card lies under the footer ("Copy timeline", hours tracked),
 * which sits 2 px above the bottom of the scroll view and is 26 px tall.
 * `offset` is where the cards' coordinates start inside the scrolled content.
 */
export function underFooter(el: HTMLElement, boxes: Array<{ top: number; height: number }>, offset = 0): boolean {
  const bottom = el.scrollTop + el.clientHeight - 2 - offset
  const top = bottom - 26
  return boxes.some((b) => b.top < bottom && b.top + b.height > top)
}

/**
 * The day view (upstream CanvasTimelineDataView): cards on a 4 AM-to-4 AM
 * canvas at 168 px per hour, hour labels and dashed hour lines, and today a
 * status card where the next card is being made.
 */
export function DayCanvas(props: {
  day: string
  cards: TimelineCard[]
  now: number
  recorder: RecorderState | null
  selected: number | null
  muted: Set<string>
  showIcons: boolean
  /** Bumped to scroll to now (open, day change, back to today). */
  scrollToNow: number
  colorOf: (category: string) => string
  onSelect: (id: number | null) => void
  onResume: () => void
  /** Whether a card sits under the footer, which then hides its text. */
  onFooterOverlap: (overlaps: boolean) => void
}) {
  const { day, now } = props
  const scroller = useRef<HTMLDivElement>(null)
  const segments = resolveOverlaps(mergeFailed(props.cards))
  const projection = props.recorder ? recordingProjection(day, segments, now) : null
  const failedCount = (c: TimelineCard) => props.cards.filter((x) => x.category === SYSTEM_CATEGORY && x.start >= c.start && x.end <= c.end).length

  // Today: put now a quarter down the view. Other days: an hour before the first card.
  const firstTop = segments.length ? dayCardBox(segments[0]!).top : null
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    el.scrollTop = projection ? nowScrollTop(now, el.clientHeight) : firstTop !== null ? Math.max(0, firstTop - HOUR_HEIGHT) : 0
  }, [day, props.scrollToNow, firstTop === null, projection === null]) // eslint-disable-line react-hooks/exhaustive-deps

  const boxes = [...segments.map((c) => dayCardBox(c)), ...(projection ? [dayCardBox(projection)] : [])]
  const checkFooter = () => {
    const el = scroller.current
    if (el) props.onFooterOverlap(underFooter(el, boxes))
  }
  useEffect(checkFooter)

  return (
    <div className="canvas-scroll" ref={scroller} onScroll={checkFooter} onClick={() => props.onSelect(null)}>
      <div className="canvas" key={day} style={{ height: DAY_HEIGHT }}>
        {hourMarks(day, now).map((m, i) => (
          <div key={i}>
            <span className={`hour-label ${m.future ? 'future' : ''}`} style={{ top: m.top }}>
              {m.label}
            </span>
            <span className="hour-line" style={{ top: m.top }} />
          </div>
        ))}
        {segments.map((c, i) => {
          const box = dayCardBox(c)
          const minutes = (c.end - c.start) / 60
          const mode = cardTextMode(minutes)
          const failed = c.category === SYSTEM_CATEGORY
          const count = failed ? failedCount(c) : 0
          // From the shown span: merged and trimmed cards no longer match their stored labels.
          const time = `${formatClock(c.start)} - ${formatClock(c.end)}`
          return (
            <button
              key={c.id}
              className={`day-card ${mode} ${failed ? 'failed' : ''} ${c.id === props.selected ? 'selected' : ''} ${
                props.muted.has(muteKey(c.category)) ? 'muted' : ''
              }`}
              style={{ top: box.top, height: box.height, '--cat': props.colorOf(c.category), animationDelay: `${i * 30}ms` } as React.CSSProperties}
              title={`${time}: ${c.title}`}
              onClick={(e) => {
                e.stopPropagation()
                props.onSelect(c.id === props.selected ? null : c.id)
              }}
            >
              {mode !== 'hidden' &&
                (failed ? (
                  <span className="head">
                    <span className="title">{count > 1 ? `Processing failed · ${count} intervals` : 'Processing failed'}</span>
                    <span className="time">{time}</span>
                  </span>
                ) : (
                  <>
                    {props.showIcons && <AppIcon site={c.appSites.primary} />}
                    <span className="title">{c.title}</span>
                    <span className="time">{time}</span>
                  </>
                ))}
            </button>
          )
        })}
        {projection && <StatusCard box={dayCardBox(projection)} recorder={props.recorder!} onResume={props.onResume} />}
        {segments.length === 0 && !projection && <p className="tl-empty empty">Nothing was recorded on this day.</p>}
      </div>
    </div>
  )
}

/** "Generating your next card", or the paused / stopped card that resumes on click. */
function StatusCard({ box, recorder, onResume }: { box: { top: number; height: number }; recorder: RecorderState; onResume: () => void }) {
  const style = { top: box.top, height: box.height }
  if (recorder === 'paused' || recorder === 'stopped') {
    const Icon = recorder === 'paused' ? Pause : Play
    return (
      <button
        className="status-card paused"
        style={style}
        onClick={(e) => {
          e.stopPropagation()
          onResume()
        }}
      >
        <Icon size={11} fill="currentColor" strokeWidth={0} />
        <span>
          {recorder === 'paused'
            ? "Dayflow is paused. Click 'Resume' to generate new activity cards."
            : "Dayflow isn't recording. Click 'Resume' to generate new activity cards."}
        </span>
      </button>
    )
  }
  return (
    <div className="status-card generating" style={style}>
      {box.height >= 24 && (
        <>
          <span className="spinner" />
          <span>Generating your next card</span>
        </>
      )}
    </div>
  )
}
