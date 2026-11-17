import { useEffect, useState } from 'react'
import type { Category } from '@shared/categories'
import { type GoalPlan, formatMinutes, summarizeDay } from '@shared/day-summary'
import type { TimelineCard } from '@shared/types'

const hours = (minutes: number) => {
  const h = minutes / 60
  return Math.abs(h - Math.round(h)) < 0.01 ? String(Math.round(h)) : h.toFixed(1)
}

/** The right panel in day mode (upstream DaySummaryView): targets, donut, longest focus block. */
export function DaySummary({ day, cards, categories }: { day: string; cards: TimelineCard[]; categories: Category[] }) {
  const [plan, setPlan] = useState<GoalPlan | null>(null)
  const [editing, setEditing] = useState(false)

  // Reload when categories change too, so a renamed category keeps counting.
  const categoryNames = categories.map((c) => c.name).join('\n')
  useEffect(() => {
    void window.dayflow.getGoals(day).then(setPlan)
  }, [day, categoryNames])
  if (!plan) return null

  const s = summarizeDay(cards, categories, plan, day)
  const savePlan = (next: GoalPlan) => {
    setPlan(next)
    void window.dayflow.setGoals(day, next)
  }
  const remaining = Math.max(0, plan.distractionLimitMinutes - s.distractedMinutes)

  return (
    <div className="summary">
      <section>
        <div className="row spread">
          <h3>Targets</h3>
          <button className="link" onClick={() => setEditing(!editing)}>
            {editing ? 'Done' : plan.skipped ? 'Set goals' : 'Edit goals'}
          </button>
        </div>
        {editing ? (
          <GoalEditor plan={plan} categories={categories} onChange={savePlan} />
        ) : plan.skipped ? (
          <p className="note">No goals for today.</p>
        ) : (
          <>
            <Bar
              label="Focus"
              value={`${hours(s.focusMinutes)} / ${hours(plan.focusTargetMinutes)} hr fulfilled`}
              ratio={plan.focusTargetMinutes ? s.focusMinutes / plan.focusTargetMinutes : 1}
              color="var(--accent)"
            />
            <Bar
              label="Distraction"
              value={
                s.distractedMinutes <= plan.distractionLimitMinutes
                  ? `${formatMinutes(remaining)} left / ${formatMinutes(plan.distractionLimitMinutes)}`
                  : `${formatMinutes(s.distractedMinutes)} / ${formatMinutes(plan.distractionLimitMinutes)} used`
              }
              ratio={plan.distractionLimitMinutes ? remaining / plan.distractionLimitMinutes : 0}
              color="#FF5950"
            />
          </>
        )}
      </section>

      <section>
        <h3>Your day so far</h3>
        {s.totals.length === 0 ? (
          <p className="note">No activity data yet</p>
        ) : (
          <>
            <Donut totals={s.totals} total={s.capturedMinutes} />
            <ul className="legend">
              {s.totals.map((t) => (
                <li key={t.category}>
                  <span className="dot" style={{ background: t.color }} />
                  {t.category}
                  <span className="push-right">{formatMinutes(t.minutes)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="stats">
        <div>
          <span className="note">Longest focus</span>
          <b>{formatMinutes(s.longestFocusMinutes)}</b>
        </div>
        <div>
          <span className="note">Distracted</span>
          <b>{formatMinutes(s.distractedMinutes)}</b>
        </div>
      </section>
    </div>
  )
}

function Bar({ label, value, ratio, color }: { label: string; value: string; ratio: number; color: string }) {
  return (
    <div className="bar">
      <div className="row spread">
        <span>{label}</span>
        <span className="note">{value}</span>
      </div>
      <div className="track">
        <div className="fill" style={{ width: `${Math.min(1, Math.max(0, ratio)) * 100}%`, background: color }} />
      </div>
    </div>
  )
}

function Donut({ totals, total }: { totals: Array<{ category: string; minutes: number; color: string }>; total: number }) {
  const r = 70
  const c = 2 * Math.PI * r
  let offset = 0
  return (
    <svg className="donut" viewBox="0 0 180 180" role="img" aria-label="Time per category">
      {totals.map((t) => {
        const len = (t.minutes / Math.max(1, total)) * c
        const el = (
          <circle
            key={t.category}
            cx="90"
            cy="90"
            r={r}
            fill="none"
            stroke={t.color}
            strokeWidth="18"
            strokeDasharray={`${len} ${c - len}`}
            strokeDashoffset={-offset}
            transform="rotate(-90 90 90)"
          />
        )
        offset += len
        return el
      })}
      <text x="90" y="84" textAnchor="middle" className="donut-label">
        TOTAL
      </text>
      <text x="90" y="106" textAnchor="middle" className="donut-value">
        {total >= 60 ? `${hours(total)} hours` : `${total} minutes`}
      </text>
    </svg>
  )
}

function GoalEditor({ plan, categories, onChange }: { plan: GoalPlan; categories: Category[]; onChange: (p: GoalPlan) => void }) {
  const options = Array.from({ length: 12 * 12 + 1 }, (_, i) => i * 5)
  const toggle = (list: string[], name: string) => (list.includes(name) ? list.filter((n) => n !== name) : [...list, name])
  const regular = categories.filter((c) => !c.isIdle)
  return (
    <div className="goal-editor">
      <label className="field">
        Focus target
        <select value={plan.focusTargetMinutes} onChange={(e) => onChange({ ...plan, focusTargetMinutes: Number(e.target.value), skipped: false })}>
          {options.map((m) => (
            <option key={m} value={m}>
              {formatMinutes(m)}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Distraction limit
        <select
          value={plan.distractionLimitMinutes}
          onChange={(e) => onChange({ ...plan, distractionLimitMinutes: Number(e.target.value), skipped: false })}
        >
          {options.map((m) => (
            <option key={m} value={m}>
              {formatMinutes(m)}
            </option>
          ))}
        </select>
      </label>
      <p className="note">Counts as focus / as distraction:</p>
      {regular.map((c) => (
        <div key={c.id} className="row">
          <label className="check">
            <input
              type="checkbox"
              checked={plan.focusCategories.includes(c.name)}
              onChange={() => onChange({ ...plan, focusCategories: toggle(plan.focusCategories, c.name), skipped: false })}
            />
            focus
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={plan.distractionCategories.includes(c.name)}
              onChange={() => onChange({ ...plan, distractionCategories: toggle(plan.distractionCategories, c.name), skipped: false })}
            />
            distraction
          </label>
          <span className="dot" style={{ background: c.color }} /> {c.name}
        </div>
      ))}
      <button className="link" onClick={() => onChange({ ...plan, skipped: true })}>
        No goals today
      </button>
    </div>
  )
}
