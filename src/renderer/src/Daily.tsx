import { useCallback, useEffect, useRef, useState } from 'react'
import type { Category } from '@shared/categories'
import { type StandupDraft, standupText, workflowGrid } from '@shared/daily'
import { parseKey, shiftDay, todayKey } from '@shared/day'
import type { StandupEntry, TimelineCard } from '@shared/types'

const hourLabel = (minute: number) => {
  const h = Math.floor(minute / 60) % 24
  return `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? 'am' : 'pm'}`
}
const formatMinutes = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60 ? `${m % 60}m` : ''}`.trim() : `${m}m`)

/** The Daily tab (upstream DailyView): the day's workflow grid and an editable standup update. */
export function Daily() {
  const today = todayKey()
  const [day, setDay] = useState(today)
  const [access, setAccess] = useState<{ unlocked: boolean; label: string } | null>(null)
  const [cards, setCards] = useState<TimelineCard[]>([])
  const [categories, setCategories] = useState<Category[]>([])

  useEffect(() => {
    void window.dayflow.getAccess().then((a) => setAccess(a.daily))
    void window.dayflow.getSettings().then((s) => setCategories(s.categories))
  }, [])
  const load = useCallback(() => void window.dayflow.getDay(day).then((r) => setCards(r.cards)), [day])
  useEffect(() => {
    load()
    return window.dayflow.onCardsChanged(load)
  }, [load])

  if (!access) return null
  if (!access.unlocked) {
    return (
      <div className="locked">
        <h2>Daily</h2>
        <p>Daily is a new way to visualize your day and turn it into a standup update fast.</p>
        <p className="note">Daily unlocks after 5 hours of analyzed timeline data. {access.label}</p>
      </div>
    )
  }

  const grid = workflowGrid(cards, categories)
  const heading =
    day === today ? 'Today so far. Come back tomorrow for the full day view.' : day === shiftDay(today, -1) ? 'Your workflow yesterday' : `Your workflow on ${parseKey(day).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}`
  const hours = Array.from({ length: Math.ceil(grid.slots / 4) }, (_, i) => grid.startMinute + i * 60)

  return (
    <div className="daily">
      <div className="daynav">
        <button aria-label="Previous day" onClick={() => setDay(shiftDay(day, -1))}>
          ‹
        </button>
        <h1>{day === today ? 'Today' : parseKey(day).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</h1>
        <button aria-label="Next day" disabled={day === today} onClick={() => setDay(shiftDay(day, 1))}>
          ›
        </button>
      </div>
      <section>
        <h3>{heading}</h3>
        <div className="workflow" style={{ gridTemplateColumns: `120px repeat(${grid.slots}, 1fr)` }}>
          <span />
          {hours.map((m) => (
            <span key={m} className="hour" style={{ gridColumn: `span 4` }}>
              {hourLabel(m)}
            </span>
          ))}
          {grid.rows.map((row) => (
            <Row key={row.category} label={row.category}>
              {row.cells.map((v, i) => (
                <span key={i} className="cell" style={{ background: row.color, opacity: v ? 0.2 + 0.8 * v : 0.05 }} />
              ))}
            </Row>
          ))}
          {categories.some((c) => c.name.toLowerCase() === 'distraction') && (
            <Row label="Distractions">
              {Array.from({ length: grid.slots }, (_, i) => {
                const from = grid.startMinute + i * 15
                const hit = grid.distractions.find((d) => d.start < from + 15 && d.end > from)
                return <span key={i} className="cell" title={hit?.title} style={{ background: '#FF5950', opacity: hit ? 1 : 0.05 }} />
              })}
            </Row>
          )}
        </div>
        <p className="note">
          {grid.totals.length === 0
            ? day === today
              ? 'No captured activity yet.'
              : 'No captured activity during 9am-9pm'
            : `${day === today ? "Today's total so far" : 'Total'}: ` + grid.totals.map((t) => `${t.category} ${formatMinutes(t.minutes)}`).join(' · ')}
        </p>
      </section>
      <Standup day={day} />
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <span className="row-label">{label}</span>
      {children}
    </>
  )
}

const PLACEHOLDER = 'Daily data has not been generated yet. Click Regenerate to write it now.'

/** The standup update: highlights, tasks and blockers; edits save after 250 ms like upstream. */
function Standup({ day }: { day: string }) {
  const [entry, setEntry] = useState<StandupEntry | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(() => void window.dayflow.getStandup(day).then(setEntry), [day])
  useEffect(() => {
    load()
    return window.dayflow.onDailyChanged(load)
  }, [load])

  const edit = (draft: StandupDraft) => {
    setEntry((e) => (e ? { ...e, draft } : e))
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => void window.dayflow.saveStandup(day, draft), 250)
  }
  const regenerate = async () => {
    setBusy('Writing your standup…')
    const result = await window.dayflow.generateStandup(day)
    setBusy(result.ok ? null : result.message)
    if (result.ok) setEntry(result.entry)
  }

  const draft = entry?.draft
  return (
    <section className="standup">
      <div className="row spread">
        <h3>Standup</h3>
        <div className="row">
          {draft && (
            <button
              onClick={() =>
                void navigator.clipboard.writeText(standupText(draft)).then(() => {
                  setCopied(true)
                  setTimeout(() => setCopied(false), 2000)
                })
              }
            >
              {copied ? 'Copied' : 'Copy standup update'}
            </button>
          )}
          <button disabled={busy === 'Writing your standup…'} onClick={() => void regenerate()}>
            Regenerate
          </button>
        </div>
      </div>
      {busy && <p className="note">{busy}</p>}
      {!draft ? (
        <p className="note">{PLACEHOLDER}</p>
      ) : (
        <div className="standup-cards">
          <ItemList title={draft.highlightsTitle} items={draft.highlights} onChange={(highlights) => edit({ ...draft, highlights })} />
          <div>
            <ItemList title={draft.tasksTitle} items={draft.tasks} onChange={(tasks) => edit({ ...draft, tasks })} />
            <h4>{draft.blockersTitle}</h4>
            <textarea
              rows={3}
              placeholder="Fill in any blockers you may have"
              value={draft.blockersBody}
              onChange={(e) => edit({ ...draft, blockersBody: e.target.value })}
            />
          </div>
        </div>
      )}
    </section>
  )
}

/** Editable bullets: Enter adds an item after the current one, Backspace on an empty item removes it. */
function ItemList({ title, items, onChange }: { title: string; items: string[]; onChange: (items: string[]) => void }) {
  const refs = useRef<Array<HTMLInputElement | null>>([])
  const focus = (i: number) => setTimeout(() => refs.current[i]?.focus(), 0)
  return (
    <div>
      <h4>{title}</h4>
      <ul className="items">
        {items.map((item, i) => (
          <li key={i}>
            <input
              ref={(el) => {
                refs.current[i] = el
              }}
              value={item}
              aria-label={`${title} item ${i + 1}`}
              onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  onChange([...items.slice(0, i + 1), '', ...items.slice(i + 1)])
                  focus(i + 1)
                } else if (e.key === 'Backspace' && item === '') {
                  e.preventDefault()
                  onChange(items.filter((_, j) => j !== i))
                  focus(Math.max(0, i - 1))
                }
              }}
            />
          </li>
        ))}
      </ul>
      <button className="link" onClick={() => (onChange([...items, '']), focus(items.length))}>
        Add item
      </button>
    </div>
  )
}
