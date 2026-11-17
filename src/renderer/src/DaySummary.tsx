import { useEffect, useId, useState } from 'react'
import { Brain, Info, Pencil, Shapes } from 'lucide-react'
import type { Category } from '@shared/categories'
import { formatClock, todayKey } from '@shared/day'
import { type CategoryTotal, type GoalPlan, formatMinutes, summarizeDay } from '@shared/day-summary'
import { type GoalContext, goalFlowStart, goalPromptAction } from '@shared/goal-flow'
import { REVIEW_RATINGS, type ReviewSegment, reviewSummary } from '@shared/review'
import type { RecorderState, TimelineCard } from '@shared/types'
import { GoalFlow } from './GoalFlow'
import { RATING_LOOK, RatingBars } from './ReviewOverlay'
import { categoryKey } from '@shared/categories'

/** Days the pop-up was handled and yesterday's review shown, kept per device like upstream's UserDefaults. */
const HANDLED_KEY = 'dayGoalPromptHandledTimelineDay'
const REVIEW_SHOWN_KEY = 'dayGoalReviewShownTimelineDay'
const readDay = (k: string): string | null => {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}
const writeDay = (k: string, day: string) => {
  try {
    localStorage.setItem(k, day)
  } catch {
    // Without storage the pop-up may open once more; nothing else depends on it.
  }
}

const hours = (minutes: number) => {
  const h = minutes / 60
  return Math.abs(h - Math.round(h)) < 0.01 ? String(Math.round(h)) : h.toFixed(1)
}

/**
 * The inspector in day mode with no card selected (upstream
 * Components/DaySummaryView.swift, DayGoalHeader.swift,
 * DayFocusSummarySection.swift, DayDistractionSummarySection.swift).
 */
export function DaySummary(props: {
  day: string
  cards: TimelineCard[]
  categories: Category[]
  recorder: RecorderState | null
  review: { segments: ReviewSegment[]; toReview: number } | null
  onReview: () => void
}) {
  const { day, cards, categories } = props
  const [plan, setPlan] = useState<GoalPlan | null>(null)
  const [flow, setFlow] = useState<{ context: GoalContext; start: 'review' | 'setup' } | null>(null)

  // Reload when categories change too, so a renamed category keeps counting.
  const categoryNames = categories.map((c) => c.name).join('\n')
  useEffect(() => {
    void window.dayflow.getGoals(day).then(setPlan)
  }, [day, categoryNames])

  const openFlow = async (context?: GoalContext) => {
    const ctx = context ?? (await window.dayflow.getGoalContext(day))
    const start = goalFlowStart(ctx.yesterday?.plan ?? null, readDay(REVIEW_SHOWN_KEY), day)
    if (start === 'review') writeDay(REVIEW_SHOWN_KEY, day)
    setFlow({ context: ctx, start })
  }
  // The first visit after 4 AM opens the pop-up by itself (upstream requestDailyGoalPromptIfNeeded).
  useEffect(() => {
    const today = todayKey()
    if (day !== today || readDay(HANDLED_KEY) === today) return
    let live = true
    void Promise.all([window.dayflow.getSettings(), window.dayflow.getGoalContext(today)]).then(([settings, context]) => {
      if (!live) return
      const action = goalPromptAction({ enabled: settings.showDailyGoalPopups, handledDay: readDay(HANDLED_KEY), today, ...context })
      if (action !== 'none') writeDay(HANDLED_KEY, today)
      if (action === 'open') void openFlow(context)
    })
    return () => {
      live = false
    }
  }, [day])
  if (!plan) return null

  const s = summarizeDay(cards, categories, plan, day)
  const savePlan = (next: GoalPlan) => {
    setPlan(next)
    void window.dayflow.setGoals(day, next)
  }
  const isToday = day === todayKey()
  const focusTotals = s.totals.filter((t) => plan.focusCategories.some((n) => categoryKey(n) === categoryKey(t.category)))
  const statusLine = plan.skipped
    ? 'Set your goals for today to activate the progress bars below.'
    : isToday && props.recorder === 'paused'
      ? 'Dayflow is paused. Resume to continue tracking your progress.'
      : isToday && props.recorder === 'stopped'
        ? 'Start Dayflow to continue tracking your progress.'
        : 'Tracking progress from your focus and distraction categories.'

  return (
    <>
      <section className="targets">
        <div className="targets-head">
          <div>
            <h3>{plan.skipped ? "Set today's goals" : isToday ? "Today's targets" : 'Targets'}</h3>
            <p className="status">{statusLine}</p>
          </div>
          {plan.skipped ? (
            <button className="btn-glass set-goals" onClick={() => void openFlow()}>
              Set goals
            </button>
          ) : (
            <button className="icon-circle" aria-label="Edit goals" title="Edit goals" onClick={() => void openFlow()}>
              <Pencil size={11} />
            </button>
          )}
        </div>
        <FocusRow plan={plan} focusTotals={focusTotals} focusMinutes={s.focusMinutes} />
        <DistractionRow plan={plan} distracted={s.distractedMinutes} />
      </section>
      {flow && (
        <GoalFlow
          plan={plan}
          categories={categories}
          context={flow.context}
          start={flow.start}
          onClose={() => setFlow(null)}
          onSave={(next) => {
            savePlan(next)
            setFlow(null)
          }}
        />
      )}

      <div className="summary-sections">
        <section>
          <h3>Your day so far</h3>
          {s.totals.length === 0 ? (
            <div className="donut-wrap">
              <svg width="140" height="140" viewBox="0 0 140 140" aria-hidden="true">
                <circle cx="70" cy="70" r="60" fill="none" stroke="var(--track-fill)" strokeWidth="20" />
              </svg>
              <p className="note">No activity data yet</p>
            </div>
          ) : (
            <div className="donut-wrap">
              <Donut totals={s.totals} total={s.capturedMinutes} />
              <ul className="legend">
                {s.totals.map((t) => (
                  <li key={t.category} style={{ '--c': t.color } as React.CSSProperties}>
                    <span className="swatch" />
                    <span className="name">{t.category}</span>
                    <span className="value">{formatMinutes(t.minutes)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {props.review && <YourReview segments={props.review.segments} toReview={props.review.toReview} day={day} onReview={props.onReview} />}

        <section>
          <h3 className="small">
            Your focus <Info size={14} color="var(--text-muted)" aria-label="From the categories counted as focus in your goals" />
          </h3>
          {plan.focusCategories.length === 0 ? (
            <p className="note">Edit categories to calculate focus.</p>
          ) : (
            <div className="summary-card">
              <span className="k">Total focus time</span>
              <span className="v">{formatMinutes(s.focusMinutes)}</span>
              <span className="k" style={{ marginTop: 10 }}>
                Longest focus duration
              </span>
              <span className="v mid">{formatMinutes(s.longestFocusMinutes)}</span>
              {s.longestFocus && <MiniTimeline cards={cards} block={s.longestFocus} />}
            </div>
          )}
        </section>

        <section>
          <h3 className="small">Distractions so far</h3>
          <div className="summary-card distraction-card">
            <Ring ratio={s.capturedMinutes ? s.distractedMinutes / s.capturedMinutes : 0} />
            <div className="stats">
              <div>
                <div className="k">Total time captured</div>
                <div className="v">{formatMinutes(s.capturedMinutes)}</div>
              </div>
              <div>
                <div className="k">Total time distracted</div>
                <div className="v hot">{formatMinutes(s.distractedMinutes)}</div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </>
  )
}

/** Focus progress: a capsule per focus category, scaled to the target. */
function FocusRow({ plan, focusTotals, focusMinutes }: { plan: GoalPlan; focusTotals: CategoryTotal[]; focusMinutes: number }) {
  const scale = Math.max(plan.focusTargetMinutes, focusMinutes, 1)
  const met = !plan.skipped && plan.focusTargetMinutes > 0 && focusMinutes >= plan.focusTargetMinutes
  return (
    <div className="goal-row">
      <span className="bubble">
        <Brain size={18} color={plan.skipped ? 'var(--text-muted)' : 'var(--focus)'} />
      </span>
      <div className="goal-info">
        <div className="goal-value">
          {plan.skipped ? (
            <span>Focus</span>
          ) : (
            <>
              <b>{hours(focusMinutes)}</b>/ {hours(plan.focusTargetMinutes)} hr fulfilled
            </>
          )}
        </div>
        <div className={`goal-track ${met ? 'met' : ''}`}>
          {!plan.skipped &&
            focusTotals.map((t) => <span key={t.category} className="seg" style={{ width: `${(t.minutes / scale) * 100}%`, background: t.color }} />)}
        </div>
        {!plan.skipped && focusTotals.length > 0 && (
          <div className="goal-legend">
            {focusTotals.map((t) => (
              <span key={t.category}>
                <span className="dot" style={{ background: t.color }} />
                {t.category}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** Distraction budget: what is left of it, as a thin red fill. */
function DistractionRow({ plan, distracted }: { plan: GoalPlan; distracted: number }) {
  const limit = plan.distractionLimitMinutes
  const over = distracted > limit
  const remaining = limit ? Math.max(0, limit - distracted) / limit : 0
  return (
    <div className="goal-row right">
      <span className="bubble">
        <Shapes size={18} color={plan.skipped ? 'var(--text-muted)' : 'var(--distraction)'} />
      </span>
      <div className="goal-info">
        <div className="goal-value distraction">
          {plan.skipped ? (
            <span>Distraction</span>
          ) : (
            <>
              <b>{formatMinutes(distracted)}</b>/ {formatMinutes(limit)}
              {over ? ' used' : ''}
            </>
          )}
          <span className="budget">Distraction budget</span>
        </div>
        <div className="goal-track">{!plan.skipped && <span className="budget-fill" style={{ width: `${remaining * 100}%` }} />}</div>
      </div>
    </div>
  )
}

/** The category donut: a base disc, sectors with small gaps, and "TOTAL / N hours / M minutes" in the middle. */
function Donut({ totals, total }: { totals: CategoryTotal[]; total: number }) {
  const r = 86
  const c = 2 * Math.PI * r
  const gap = totals.length > 1 ? 2 : 0
  let offset = 0
  const h = Math.floor(total / 60)
  const m = total % 60
  const lines = h ? [`${h} ${h === 1 ? 'hour' : 'hours'}`, `${m} minutes`] : [`${m} minutes`]
  return (
    <svg className="donut" viewBox="0 0 205 205" role="img" aria-label={`Time per category, ${formatMinutes(total)} in total`}>
      <circle cx="102.5" cy="102.5" r="86.75" fill="none" stroke="var(--donut-ring)" strokeWidth="31.5" />
      {totals.map((t) => {
        const len = (t.minutes / Math.max(1, total)) * c
        const el = (
          <circle
            key={t.category}
            cx="102.5"
            cy="102.5"
            r={r}
            fill="none"
            stroke={t.color}
            strokeWidth="26"
            strokeDasharray={`${Math.max(0.5, len - gap)} ${c - Math.max(0.5, len - gap)}`}
            strokeDashoffset={-offset}
            transform="rotate(-90 102.5 102.5)"
          />
        )
        offset += len
        return el
      })}
      <circle cx="102.5" cy="102.5" r="70" fill="var(--donut-center)" />
      <text x="102.5" y={lines.length > 1 ? 86 : 94} textAnchor="middle" className="donut-total">
        TOTAL
      </text>
      {lines.map((line, i) => (
        <text key={i} x="102.5" y={(lines.length > 1 ? 108 : 116) + i * 20} textAnchor="middle" className="donut-value">
          {line}
        </text>
      ))}
    </svg>
  )
}

/** The longest focus block on a line spanning the day's cards. */
function MiniTimeline({ cards, block }: { cards: TimelineCard[]; block: { start: number; end: number } }) {
  const from = Math.min(block.start, ...cards.map((c) => c.start))
  const to = Math.max(block.end, ...cards.map((c) => c.end))
  const at = (t: number) => `${4 + ((t - from) / Math.max(1, to - from)) * 92}%`
  return (
    <div className="mini-timeline" aria-label={`Longest focus from ${formatClock(block.start)} to ${formatClock(block.end)}`}>
      <span className="base" />
      <span className="range" style={{ left: at(block.start), width: `calc(${at(block.end)} - ${at(block.start)})`, minWidth: 6 }} />
      <span className="t" style={{ left: at(block.start) }}>
        {formatClock(block.start)}
      </span>
      <span className="t" style={{ left: at(block.end) }}>
        {formatClock(block.end)}
      </span>
    </div>
  )
}

/** Share of captured time spent distracted, as a gradient arc. */
function Ring({ ratio }: { ratio: number }) {
  // A plain id, so url(#…) needs no escaping.
  const id = `ring${useId().replace(/[^\w-]/g, '')}`
  const r = 38
  const c = 2 * Math.PI * r
  return (
    <svg width="96" height="96" viewBox="0 0 96 96" role="img" aria-label={`${Math.round(ratio * 100)}% distracted`}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FFE3DE" />
          <stop offset="1" stopColor="#FF694B" />
        </linearGradient>
      </defs>
      <circle cx="48" cy="48" r={r} fill="none" stroke="var(--track-border)" strokeWidth="13" />
      <circle cx="48" cy="48" r={r} fill="none" stroke="var(--track-fill)" strokeWidth="11" />
      {ratio > 0 && (
        <circle
          cx="48"
          cy="48"
          r={r}
          fill="none"
          stroke={`url(#${id})`}
          strokeWidth="11"
          strokeLinecap="round"
          strokeDasharray={`${Math.min(1, ratio) * c} ${c}`}
          transform="rotate(-90 48 48)"
        />
      )}
    </svg>
  )
}

/** "Your review": rated time per rating for the day (upstream TimelineReviewSummaryCard). */
function YourReview({ segments, toReview, day, onReview }: { segments: ReviewSegment[]; toReview: number; day: string; onReview: () => void }) {
  const r = reviewSummary(segments, day)
  return (
    <section className="your-review">
      <h3 className="mid">Your review</h3>
      <p className="review-status">
        {r.lastReviewedAt !== null ? `Last reviewed at ${formatClock(r.lastReviewedAt)}.` : 'No reviews yet.'}
        {toReview > 0 && (
          <button className="link-accent" onClick={onReview}>
            {` Review ${toReview} cards to update your data.`}
          </button>
        )}
      </p>
      <RatingBars summary={r} height={39} all />
      <ul className="legend rating-legend-small">
        {REVIEW_RATINGS.map((k) => (
          <li key={k} style={{ '--c': k === 'neutral' ? 'var(--track-border)' : RATING_LOOK[k].color } as React.CSSProperties}>
            <span className="swatch" />
            <span className="name">{RATING_LOOK[k].label}</span>
            {r.total > 0 && <span className="value">{formatMinutes(Math.floor(r[k] / 60))}</span>}
          </li>
        ))}
      </ul>
    </section>
  )
}
