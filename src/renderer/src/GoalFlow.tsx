// The daily goal pop-up (upstream Views/Components/DayGoalFlowView.swift,
// DayGoalReviewComponents.swift, DayGoalSetupComponents.swift,
// DayGoalDurationPicker.swift): yesterday's review, then today's focus goal
// and distraction limit with their categories.

import { type DragEvent, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Brain, Shapes, X } from 'lucide-react'
import type { Category } from '@shared/categories'
import type { GoalPlan } from '@shared/day-summary'
import { durationLabel } from '@shared/i18n'
import { type GoalContext, assignCategory, cycleCategory, referenceMinutes, spelledDuration, wheelMinutes } from '@shared/goal-flow'
import { categoryKey } from '@shared/categories'

const FOCUS = '#628CFF'
const DISTRACTION = '#FA8282'

export function GoalFlow(props: {
  plan: GoalPlan
  categories: Category[]
  context: GoalContext
  start: 'review' | 'setup'
  onSave: (plan: GoalPlan) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [step, setStep] = useState(props.start)
  const [draft, setDraft] = useState<GoalPlan>({ ...props.plan, skipped: false })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [props])

  // On the body: the inspector's backdrop-filter would make it the containing block of a fixed element.
  return createPortal(
    <div className="goal-flow-backdrop" role="dialog" aria-modal="true" aria-label={t('goals.dialogLabel')}>
      <div className="goal-flow">
        <button className="goal-flow-close" aria-label={t('goals.closeWithoutSaving')} onClick={props.onClose}>
          <X size={14} />
        </button>
        {step === 'review' && props.context.yesterday ? (
          <GoalReview review={props.context.yesterday} onNext={() => setStep('setup')} />
        ) : (
          <GoalSetup
            draft={draft}
            categories={props.categories}
            context={props.context}
            onChange={setDraft}
            onSkip={() => props.onSave({ ...props.plan, skipped: true })}
            onConfirm={() => props.onSave({ ...draft, skipped: false })}
          />
        )}
      </div>
    </div>,
    document.body
  )
}

function GoalReview({ review, onNext }: { review: NonNullable<GoalContext['yesterday']>; onNext: () => void }) {
  const { t } = useTranslation()
  const { plan } = review
  const maxFocus = Math.max(1, ...review.focusTotals.map((total) => total.minutes))
  return (
    <div className="goal-review">
      <h2>{t('goals.yesterdaysReview')}</h2>
      <ReviewCard
        accent={FOCUS}
        icon={<Brain size={18} color={FOCUS} />}
        lines={[
          t('goals.focusTarget', { duration: spelledDuration(plan.focusTargetMinutes) }),
          t('goals.timeSpent', { duration: spelledDuration(review.focusMinutes) })
        ]}
        met={review.focusMinutes >= plan.focusTargetMinutes}
        ratio={plan.focusTargetMinutes ? review.focusMinutes / plan.focusTargetMinutes : 1}
      >
        <div className="goal-breakdown">
          {review.focusTotals.length === 0 ? (
            <p className="note">{t('goals.noFocusCategories')}</p>
          ) : (
            review.focusTotals.slice(0, 4).map((total) => (
              <div key={total.category}>
                <span className="name">{total.category}</span>
                <span className="bar" style={{ width: Math.max(18, (total.minutes / maxFocus) * 86), background: total.color }} />
                <span className="time">{durationLabel(total.minutes)}</span>
              </div>
            ))
          )}
        </div>
      </ReviewCard>
      <ReviewCard
        accent={DISTRACTION}
        icon={<Shapes size={18} color={DISTRACTION} />}
        lines={[
          t('goals.distractionLimitLine', { duration: spelledDuration(plan.distractionLimitMinutes) }),
          t('goals.timeSpentDistracted', { duration: spelledDuration(review.distractedMinutes) })
        ]}
        met={review.distractedMinutes <= plan.distractionLimitMinutes}
        ratio={plan.distractionLimitMinutes ? review.distractedMinutes / plan.distractionLimitMinutes : 1}
        right
      />
      <button className="btn-primary goal-flow-btn" onClick={onNext}>
        {t('goals.setTodaysGoals')}
      </button>
    </div>
  )
}

function ReviewCard(props: { accent: string; icon: React.ReactNode; lines: string[]; met: boolean; ratio: number; right?: boolean; children?: React.ReactNode }) {
  const { t } = useTranslation()
  return (
    <div className="goal-review-card" style={{ '--accent': props.accent } as React.CSSProperties}>
      <span className={`goal-badge ${props.met ? 'met' : 'missed'}`}>{props.met ? t('goals.nailedIt') : t('goals.missed')}</span>
      {props.lines.map((l) => (
        <p key={l}>{l}</p>
      ))}
      <div className={`goal-review-bar ${props.right ? 'right' : ''}`}>
        <span className="bubble">{props.icon}</span>
        <span className="track">
          <span className="fill" style={{ width: `${Math.min(1, props.ratio) * 100}%` }} />
        </span>
      </div>
      {props.children}
    </div>
  )
}

function GoalSetup(props: {
  draft: GoalPlan
  categories: Category[]
  context: GoalContext
  onChange: (p: GoalPlan) => void
  onSkip: () => void
  onConfirm: () => void
}) {
  const { t } = useTranslation()
  const { draft, categories, context, onChange } = props
  const assigned = new Set([...draft.focusCategories, ...draft.distractionCategories].map(categoryKey))
  const pool = categories.filter((c) => !c.isIdle && !assigned.has(categoryKey(c.name)))
  const colorOf = (name: string) => categories.find((c) => categoryKey(c.name) === categoryKey(name))?.color ?? '#4F80EB'
  const onDrop = (kind: 'focus' | 'distraction' | null) => (e: DragEvent) => {
    e.preventDefault()
    const name = e.dataTransfer.getData('text/plain')
    if (categories.some((c) => c.name === name)) onChange(assignCategory(draft, name, kind))
  }
  const panel = (kind: 'focus' | 'distraction') => {
    const names = kind === 'focus' ? draft.focusCategories : draft.distractionCategories
    const minutes = kind === 'focus' ? draft.focusTargetMinutes : draft.distractionLimitMinutes
    const yesterday = referenceMinutes(context.yesterdayMinutes, names)
    const week = Math.floor(referenceMinutes(context.weekMinutes, names) / 7)
    const isFocus = kind === 'focus'
    return (
      <section className={`goal-panel ${kind}`} style={{ '--accent': isFocus ? FOCUS : DISTRACTION } as React.CSSProperties}>
        <header>
          {isFocus ? <Brain size={16} /> : <Shapes size={16} />}
          {isFocus ? t('goals.focusGoal') : t('goals.distractionLimit')}
        </header>
        <div className="goal-panel-body">
          <div className="goal-drop" onDragOver={(e) => e.preventDefault()} onDrop={onDrop(kind)} aria-label={isFocus ? t('goals.focusCategories') : t('goals.distractionCategories')}>
            <span className="goal-drop-title">{t('goals.categories')}</span>
            {names.map((n) => (
              <GoalChip key={n} name={n} color={colorOf(n)} removable onClick={() => onChange(assignCategory(draft, n, null))} />
            ))}
          </div>
          <DurationPicker
            minutes={minutes}
            onChange={(m) => onChange(isFocus ? { ...draft, focusTargetMinutes: m } : { ...draft, distractionLimitMinutes: m })}
          />
        </div>
        <footer>
          <Stat label={isFocus ? t('goals.yesterdaysFocus') : t('goals.yesterdaysDistractions')} minutes={yesterday} max={Math.max(yesterday, week)} color={isFocus ? FOCUS : '#FF706B'} />
          <Stat label={isFocus ? t('goals.lastWeekFocus') : t('goals.lastWeekDistraction')} minutes={week} max={Math.max(yesterday, week)} color={isFocus ? FOCUS : '#FF706B'} />
        </footer>
      </section>
    )
  }
  return (
    <div className="goal-setup">
      <h2>{t('goals.whereToSpend')}</h2>
      <div className="goal-pool" onDragOver={(e) => e.preventDefault()} onDrop={onDrop(null)}>
        <p className="note">{t('goals.dragHint')}</p>
        <div className="goal-chips">
          {pool.map((c) => (
            <GoalChip key={c.id} name={c.name} color={c.color} onClick={() => onChange(cycleCategory(draft, c.name))} />
          ))}
        </div>
      </div>
      <div className="goal-panels">
        {panel('focus')}
        {panel('distraction')}
      </div>
      <div className="goal-flow-actions">
        <button className="btn-secondary" onClick={props.onSkip}>
          {t('goals.skipToday')}
        </button>
        <button className="btn-primary" onClick={props.onConfirm}>
          {t('common.confirm')}
        </button>
      </div>
    </div>
  )
}

function GoalChip({ name, color, removable, onClick }: { name: string; color: string; removable?: boolean; onClick: () => void }) {
  const { t } = useTranslation()
  return (
    <button
      className="goal-chip"
      draggable
      style={{ '--c': color } as React.CSSProperties}
      title={removable ? t('goals.chipRemove') : t('goals.chipCycle')}
      onDragStart={(e) => e.dataTransfer.setData('text/plain', name)}
      onClick={onClick}
    >
      <span className="grip" aria-hidden="true" />
      {name}
      {removable && <X size={8} strokeWidth={3} />}
    </button>
  )
}

function Stat({ label, minutes, max, color }: { label: string; minutes: number; max: number; color: string }) {
  return (
    <div className="goal-stat">
      <span className="k">{label}</span>
      <span className="v" style={{ color }}>
        {durationLabel(minutes)}
      </span>
      <span className="bar" style={{ width: minutes ? Math.max(12, (86 * minutes) / Math.max(1, max)) : 0, background: color }} />
    </div>
  )
}

/** Two wheels: hours 0-12 and minutes 0-55 in steps of 5 (upstream DayGoalDurationPicker). */
function DurationPicker({ minutes, onChange }: { minutes: number; onChange: (m: number) => void }) {
  const { t } = useTranslation()
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return (
    <div className="duration-picker">
      <Wheel label={t('goals.hours')} value={h} max={12} step={1} onChange={(v) => onChange(wheelMinutes(v, m))} />
      <Wheel label={t('goals.mins')} value={m} max={55} step={5} onChange={(v) => onChange(wheelMinutes(h, v))} />
    </div>
  )
}

function Wheel({ label, value, max, step, onChange }: { label: string; value: number; max: number; step: number; onChange: (v: number) => void }) {
  const set = (v: number) => onChange(Math.max(0, Math.min(max, v)))
  const rows = [-2, -1, 0, 1, 2].map((d) => value + d * step)
  return (
    <div className="wheel-col">
      <div
        className="wheel"
        role="spinbutton"
        tabIndex={0}
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        onWheel={(e) => Math.abs(e.deltaY) > 0 && set(value + Math.sign(e.deltaY) * step)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp') set(value - step)
          else if (e.key === 'ArrowDown') set(value + step)
          else return
          e.preventDefault()
        }}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          set(value + (e.clientY < r.top + r.height / 2 ? -step : step))
        }}
      >
        {rows.map((v, i) => (
          <span key={i} className={i === 2 ? 'current' : ''}>
            {v >= 0 && v <= max ? String(v).padStart(2, '0') : ''}
          </span>
        ))}
      </div>
      <span className="wheel-label">{label}</span>
    </div>
  )
}
