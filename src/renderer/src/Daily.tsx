import { useCallback, useEffect, useRef, useState } from 'react'
import type { Category } from '@shared/categories'
import { type FeatureAccess, type StandupDraft, distractionInSlot, emptyStandup, standupText, standupTitles, workflowGrid } from '@shared/daily'
import { hourLabel, parseKey, shiftDay, todayKey } from '@shared/day'
import { formatMinutes } from '@shared/day-summary'
import type { StandupEntry, TimelineCard } from '@shared/types'

const DISTRACTION_COLOR = '#FF5950'

/** Runs `load` now and whenever `subscribe` fires, dropping answers that arrive after the inputs changed. */
function useFresh<T>(load: () => Promise<T>, apply: (value: T) => void, subscribe?: (cb: () => void) => () => void) {
  useEffect(() => {
    let current = true
    const run = () => void load().then((v) => current && apply(v))
    run()
    const off = subscribe?.(run)
    return () => {
      current = false
      off?.()
    }
  }, [load, apply, subscribe])
}

/** The Daily tab (upstream DailyView): the day's workflow grid and an editable standup update. */
export function Daily() {
  const today = todayKey()
  const [day, setDay] = useState(today)
  const [access, setAccess] = useState<FeatureAccess | null>(null)
  const [cards, setCards] = useState<TimelineCard[]>([])
  const [categories, setCategories] = useState<Category[]>([])

  useEffect(() => void window.dayflow.getSettings().then((s) => setCategories(s.categories)), [])
  // The unlock grows with every analyzed batch, so it is read again whenever cards change.
  useFresh(
    useCallback(() => window.dayflow.getAccess().then((a) => a.daily), []),
    setAccess,
    window.dayflow.onCardsChanged
  )
  useFresh(
    useCallback(() => window.dayflow.getDay(day).then((r) => r.cards), [day]),
    setCards,
    window.dayflow.onCardsChanged
  )

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
          {grid.hasDistractionRow && (
            <Row label="Distractions">
              {Array.from({ length: grid.slots }, (_, i) => {
                const hit = distractionInSlot(grid, i)
                return <span key={i} className="cell" title={hit?.title} style={{ background: DISTRACTION_COLOR, opacity: hit ? 1 : 0.05 }} />
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

/** The standup update: highlights, tasks and blockers; edits save after 250 ms like upstream. */
function Standup({ day }: { day: string }) {
  const [entry, setEntry] = useState<StandupEntry | null>(null)
  const [draft, setDraft] = useState<StandupDraft>(emptyStandup)
  const [busy, setBusy] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const pending = useRef<{ timer: ReturnType<typeof setTimeout>; save: () => void } | null>(null)
  const viewing = useRef(day)
  viewing.current = day

  const apply = useCallback((e: StandupEntry | null) => {
    setEntry(e)
    setDraft(e?.draft ?? emptyStandup())
  }, [])
  useFresh(
    useCallback(() => window.dayflow.getStandup(day), [day]),
    apply,
    window.dayflow.onDailyChanged
  )
  /** Saves a waiting edit right away (it belongs to the day it was typed on). */
  const flush = () => {
    if (!pending.current) return
    clearTimeout(pending.current.timer)
    pending.current.save()
    pending.current = null
  }
  useEffect(() => {
    setBusy(null)
    return flush
  }, [day])

  const edit = (next: StandupDraft) => {
    setDraft(next)
    if (pending.current) clearTimeout(pending.current.timer)
    const target = day
    const save = () => void window.dayflow.saveStandup(target, next)
    pending.current = { timer: setTimeout(() => ((pending.current = null), save()), 250), save }
  }
  const regenerate = async () => {
    const target = day
    setBusy('Writing your standup…')
    const result = await window.dayflow.generateStandup(target)
    // Upstream drops results for a day the user has moved away from.
    if (viewing.current !== target) return
    setBusy(result.ok ? null : result.message)
    if (result.ok) apply(result.entry)
  }

  const titles = standupTitles(day, entry?.sourceDay ?? null, todayKey())
  return (
    <section className="standup">
      <div className="row spread">
        <h3>Standup</h3>
        <div className="row">
          <button
            onClick={() =>
              void window.dayflow.copyText(standupText(draft, titles)).then(() => {
                setCopied(true)
                setTimeout(() => setCopied(false), 2000)
              })
            }
          >
            {copied ? 'Copied' : 'Copy standup update'}
          </button>
          <button disabled={busy === 'Writing your standup…'} onClick={() => void regenerate()}>
            Regenerate
          </button>
        </div>
      </div>
      {busy && <p className="note">{busy}</p>}
      {!entry && <p className="note">Daily data has not been generated yet. Click Regenerate to write it now, or fill it in yourself.</p>}
      <div className="standup-cards">
        <ItemList title={titles.highlights} items={draft.highlights} onChange={(highlights) => edit({ ...draft, highlights })} />
        <div>
          <ItemList title={titles.tasks} items={draft.tasks} onChange={(tasks) => edit({ ...draft, tasks })} />
          <h4>{titles.blockers}</h4>
          <textarea
            rows={3}
            placeholder="Fill in any blockers you may have"
            value={draft.blockersBody}
            onChange={(e) => edit({ ...draft, blockersBody: e.target.value })}
          />
        </div>
      </div>
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
