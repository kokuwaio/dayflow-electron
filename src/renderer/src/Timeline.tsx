import { useCallback, useEffect, useRef, useState } from 'react'
import { Calendar, Check, ChevronLeft, ChevronRight, Copy, Pencil } from 'lucide-react'
import { dayChanged, weekTrackedMinutes } from '@shared/canvas'
import { type Category, PRIVATE_CATEGORY, SYSTEM_CATEGORY } from '@shared/categories'
import { parseKey, shiftDay, todayKey } from '@shared/day'
import type { ReviewSegment } from '@shared/review'
import type { AppStatus, Rating, TimelineCard } from '@shared/types'
import type { DayCards, Week } from '@shared/week'
import { CalendarPopover } from './CalendarPopover'
import { CardDetail } from './CardDetail'
import { DayCanvas } from './DayCanvas'
import { DaySummary } from './DaySummary'
import { ReviewOverlay } from './ReviewOverlay'
import { FilterBar } from './FilterBar'
import { PausePill } from './PausePill'
import type { SettingsTab } from './Settings'
import { WeekGrid } from './WeekGrid'

/** Colors for cards the app writes itself, outside the user's categories. */
const BUILT_IN_COLORS: Record<string, string> = { [SYSTEM_CATEGORY]: '#E0A100', [PRIVATE_CATEGORY]: '#5C6B7A' }
/** Upstream's fallback for a category without a colour. */
const FALLBACK = '#4F80EB'

/** "Today, Nov 17" or "Mon, Nov 10", like upstream's header. */
function headerDate(key: string, isToday: boolean): string {
  const d = parseKey(key)
  return isToday
    ? `Today, ${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}`
    : d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
}

/** The rating covering most of the card, if any. */
function ratingFor(card: TimelineCard, ratings: Rating[]): Rating | undefined {
  return ratings
    .map((r) => ({ r, overlap: Math.min(r.end, card.end) - Math.max(r.start, card.start) }))
    .filter((x) => x.overlap > (card.end - card.start) / 2)
    .sort((a, b) => b.overlap - a.overlap)[0]?.r
}

const nowSec = () => Date.now() / 1000

/**
 * The Timeline tab (upstream MainView): header with navigation and the pause
 * pill, category chips, the day canvas or week grid, and the inspector card.
 */
export function Timeline(props: { status: AppStatus | null; onStatusChange: (s: AppStatus) => void; onOpenSettings: (tab: SettingsTab) => void }) {
  const [day, setDay] = useState(todayKey)
  const [mode, setMode] = useState<'day' | 'week'>('day')
  const [cards, setCards] = useState<TimelineCard[]>([])
  const [week, setWeek] = useState<(Week & { columns: DayCards[]; ratings: Rating[] }) | null>(null)
  const loadId = useRef(0)
  const [ratings, setRatings] = useState<Rating[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [muted, setMuted] = useState<Set<string>>(new Set())
  const [copy, setCopy] = useState<'idle' | 'copying' | 'copied'>('idle')
  const [showIcons, setShowIcons] = useState(false)
  const [now, setNow] = useState(nowSec)
  const [scrollToNow, setScrollToNow] = useState(0)
  const [footerHidden, setFooterHidden] = useState(false)
  const [review, setReview] = useState<{ segments: ReviewSegment[]; toReview: number } | null>(null)
  const [reviewing, setReviewing] = useState(false)
  const lastSeenDay = useRef(todayKey())
  const [calendarOpen, setCalendarOpen] = useState(false)

  const load = useCallback(() => {
    // Only the newest request may update the view, so fast paging cannot show an older week.
    const id = ++loadId.current
    void window.dayflow.getDay(day).then((r) => {
      if (id !== loadId.current) return
      setCards(r.cards)
      setRatings(r.ratings)
    })
    // The week also feeds "N hours tracked this week" in day mode.
    void window.dayflow.getWeek(day).then((w) => id === loadId.current && setWeek(w))
    void window.dayflow.getReview(day).then((r) => id === loadId.current && setReview(r))
    void window.dayflow.getSettings().then((s) => {
      setCategories(s.categories)
      setShowIcons(s.showAppIcons)
    })
  }, [day])

  useEffect(() => {
    load()
    return window.dayflow.onCardsChanged(load)
  }, [load])

  // Every minute: move the status card along, and at 4 AM jump to the new day (upstream Lifecycle.swift).
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(nowSec())
      const next = dayChanged(lastSeenDay.current, nowSec())
      if (next) {
        lastSeenDay.current = next
        setDay(next)
        setSelected(null)
        setScrollToNow((n) => n + 1)
      }
    }, 60_000)
    return () => clearInterval(timer)
  }, [])

  const colorOf = (category: string) =>
    categories.find((c) => c.name.trim().toLowerCase() === category.trim().toLowerCase())?.color ?? BUILT_IN_COLORS[category] ?? FALLBACK
  const weekCards = week?.columns.flatMap((c) => c.cards) ?? []
  const allCards = mode === 'week' ? weekCards : cards
  const visibleRatings = mode === 'week' ? (week?.ratings ?? []) : ratings
  const card = allCards.find((c) => c.id === selected) ?? null
  const today = todayKey()
  const isToday = day === today
  const step = mode === 'week' ? 7 : 1
  const inCurrentPeriod = mode === 'week' ? (week?.columns.some((c) => c.day === today) ?? true) : isToday
  const trackedHours = Math.floor(weekTrackedMinutes(weekCards) / 60)
  const goTo = (next: string) => {
    setDay(next)
    setSelected(null)
    if (next === todayKey()) setScrollToNow((n) => n + 1)
  }
  const refreshStatus = () => void window.dayflow.getStatus().then(props.onStatusChange)

  return (
    <div className="timeline">
      <section className="tl-main">
        <header className="tl-header">
          <div className="tl-lead">
            <div className="nav-arrows">
              <button className="nav-arrow" aria-label={`Previous ${mode}`} onClick={() => goTo(shiftDay(day, -step))}>
                <ChevronLeft size={24} strokeWidth={1.5} />
              </button>
              <button className="nav-arrow" aria-label={`Next ${mode}`} disabled={inCurrentPeriod} onClick={() => goTo(shiftDay(day, step))}>
                <ChevronRight size={24} strokeWidth={1.5} />
              </button>
            </div>
            <div className="cal-anchor">
              <button
                className={`btn-glass cal-pill ${calendarOpen ? 'open' : ''}`}
                aria-label="Pick a date"
                aria-expanded={calendarOpen}
                onClick={() => setCalendarOpen(!calendarOpen)}
              >
                <Calendar size={16} />
              </button>
              {calendarOpen && (
                <CalendarPopover
                  day={day}
                  today={today}
                  mode={mode}
                  onPick={(next) => {
                    setCalendarOpen(false)
                    goTo(next)
                  }}
                  onClose={() => setCalendarOpen(false)}
                />
              )}
            </div>
            <div className="segment" role="group" aria-label="View">
              <span className={`thumb ${mode}`} />
              {(['day', 'week'] as const).map((m) => (
                <button key={m} className={mode === m ? 'active' : ''} aria-pressed={mode === m} onClick={() => (setMode(m), setSelected(null))}>
                  {m === 'day' ? 'Day' : 'Week'}
                </button>
              ))}
            </div>
            {!inCurrentPeriod && (
              <button className="today-btn" onClick={() => goTo(todayKey())}>
                Today
              </button>
            )}
            <h1 className="tl-date">{mode === 'week' ? (week?.title ?? '') : headerDate(day, isToday)}</h1>
          </div>
          {props.status && <PausePill status={props.status} onChange={refreshStatus} />}
        </header>

        <div className="tl-chips">
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
          <button className="icon-circle" aria-label="Edit categories" title="Edit categories" onClick={() => props.onOpenSettings('categories')}>
            <Pencil size={13} />
          </button>
        </div>

        {mode === 'week' && week ? (
          <WeekGrid
            columns={week.columns}
            today={today}
            now={now}
            recorder={props.status?.recorder.state ?? null}
            selected={selected}
            muted={muted}
            colorOf={colorOf}
            onSelect={setSelected}
            onFooterOverlap={setFooterHidden}
          />
        ) : (
          <DayCanvas
            day={day}
            cards={cards}
            now={now}
            recorder={props.status?.recorder.state ?? null}
            selected={selected}
            muted={muted}
            showIcons={showIcons}
            scrollToNow={scrollToNow}
            colorOf={colorOf}
            onSelect={setSelected}
            onResume={() => void window.dayflow.resume().then(refreshStatus)}
            onFooterOverlap={setFooterHidden}
          />
        )}

        {mode === 'day' && (review?.toReview ?? 0) > 0 && (
          <button className="review-badge" aria-label={`${review!.toReview} cards to review`} onClick={() => setReviewing(true)}>
            <span className="review-badge-icon" aria-hidden="true">
              <span />
              <span>{review!.toReview}</span>
            </span>
            Review cards
          </button>
        )}

        <footer className="tl-footer">
          <button
            className="copy-btn"
            disabled={copy === 'copying'}
            onClick={() => {
              setCopy('copying')
              void window.dayflow.copyTimeline(mode, day).then(() => {
                setCopy('copied')
                setTimeout(() => setCopy('idle'), 2000)
              })
            }}
          >
            {copy === 'copying' ? <span className="spinner dark" /> : copy === 'copied' ? <Check size={12} /> : <Copy size={11.5} />}
            {copy === 'copied' ? 'Copied' : 'Copy timeline'}
          </button>
          <span className={`tracked ${footerHidden ? 'hidden' : ''}`}>
            <b>{trackedHours} hours</b>
            {mode === 'week' ? ' of activities tracked this week' : ' tracked this week'}
          </span>
        </footer>
      </section>

      {(mode === 'day' || card) && (
        <aside className={`inspector ${mode}`} aria-label={card ? 'Card details' : 'Day summary'}>
          {card ? (
            <CardDetail
              key={card.id}
              card={card}
              color={colorOf(card.category)}
              categories={categories}
              rating={ratingFor(card, visibleRatings)}
              onClose={() => setSelected(null)}
              onDeleted={() => setSelected(null)}
              onEditCategories={() => props.onOpenSettings('categories')}
            />
          ) : (
            <div className="inspector-scroll">
              <DaySummary
                day={day}
                cards={cards}
                categories={categories}
                recorder={props.status?.recorder.state ?? null}
                review={review}
                onReview={() => setReviewing(true)}
              />
            </div>
          )}
        </aside>
      )}
      {reviewing && (
        <ReviewOverlay
          day={day}
          cards={cards}
          colorOf={colorOf}
          onClose={() => {
            setReviewing(false)
            load()
          }}
        />
      )}
    </div>
  )
}
