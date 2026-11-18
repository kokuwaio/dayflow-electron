import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight, Copy, GripVertical, Plus, RotateCw } from 'lucide-react'
import type { Category } from '@shared/categories'
import { type FeatureAccess, type StandupDraft, emptyStandup, standupText, standupTitles, workflowGrid } from '@shared/daily'
import { shiftDay, todayKey } from '@shared/day'
import { dateLabel, durationLabel, hourAxisLabel, t } from '@shared/i18n'
import type { StandupEntry, TimelineCard } from '@shared/types'
import { LockedFeature } from './LockedFeature'
import { DailyProviderButton, useDailyProvider } from './DailyProvider'
import { isDistractionName } from '@shared/categories'

const DISTRACTION_COLOR = '#FF5950'
/** The busy state while a standup is written (anything else is an error message). */
const WRITING = 'writing'
/** Minutes per grid cell. */
const SLOT = 15

/** "Today, November 17" or "Monday, November 10", like upstream's Daily title. */
function longDate(day: string, today: string): string {
  if (day === today) return t('daily.todayDate', { date: dateLabel(day, { month: 'long', day: 'numeric' }) })
  return dateLabel(day, { weekday: 'long', month: 'long', day: 'numeric' })
}

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
  const { t } = useTranslation()
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
      <LockedFeature title={t('daily.locked.title')} italic beta access={access}>
        <p>{t('daily.locked.intro')}</p>
        <p>{t('daily.locked.unlock')}</p>
      </LockedFeature>
    )
  }

  const grid = workflowGrid(cards, categories)
  const yesterday = shiftDay(today, -1)
  const short = dateLabel(day, { weekday: 'short', month: 'short', day: 'numeric' })
  const heading = day === today ? t('daily.headingToday') : day === yesterday ? t('daily.headingYesterday') : t('daily.headingOn', { date: short })
  const totalTitle = day === today ? t('daily.totalToday') : day === yesterday ? t('daily.totalYesterday') : t('daily.totalOn', { date: short })
  const span = grid.slots * SLOT
  const rows = grid.rows.filter((r) => !(grid.hasDistractionRow && isDistractionName(r.category)))
  const colorOf = (name: string) => grid.rows.find((r) => r.category === name)?.color ?? DISTRACTION_COLOR

  return (
    <div className="daily">
      <div className="daily-page">
        <div className="date-row">
          <button className="nav-arrow" aria-label={t('daily.previousDay')} onClick={() => setDay(shiftDay(day, -1))}>
            <ChevronLeft size={24} strokeWidth={1.5} />
          </button>
          <h1>{longDate(day, today)}</h1>
          <button className="nav-arrow" aria-label={t('daily.nextDay')} disabled={day === today} onClick={() => setDay(shiftDay(day, 1))}>
            <ChevronRight size={24} strokeWidth={1.5} />
          </button>
        </div>
        <h2 className="serif-heading">{heading}</h2>
        <div className="workflow-card">
          <div className="workflow-scroll">
            <div className="workflow" style={{ gridTemplateColumns: `auto repeat(${grid.slots}, 19.8px)` }}>
              {rows.map((row) => (
                <Row key={row.category} label={row.category}>
                  {row.cells.map((v, i) => (
                    <span
                      key={i}
                      className="cell"
                      title={v ? row.category : undefined}
                      style={{ background: v ? `color-mix(in srgb, ${row.color} ${Math.round((0.3 + 0.7 * v) * 100)}%, transparent)` : 'var(--empty-cell)' }}
                    />
                  ))}
                </Row>
              ))}
              {grid.hasDistractionRow && (
                <Row label={t('daily.distractions')}>
                  <span className="distraction-track" style={{ gridColumn: '2 / -1' }}>
                    {grid.distractions.map((d, i) => (
                      <i
                        key={i}
                        title={t('daily.distractionTooltip', { duration: durationLabel(Math.max(1, Math.round(d.end - d.start))), title: d.title })}
                        style={{ left: `${((d.start - grid.startMinute) / span) * 100}%`, width: `${((d.end - d.start) / span) * 100}%` }}
                      />
                    ))}
                  </span>
                </Row>
              )}
              <span />
              <div className="axis" style={{ gridColumn: '2 / -1' }}>
                {Array.from({ length: Math.floor(grid.slots / 4) + 1 }, (_, i) => (
                  <span key={i} style={{ left: `${((i * 60) / span) * 100}%` }}>
                    {hourAxisLabel(grid.startMinute + i * 60).replace(/(am|pm)$/, (m) => ` ${m.toUpperCase()}`)}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div className="totals-strip">
            <h4>{totalTitle}</h4>
            {grid.totals.length === 0 ? (
              <span className="note">{day === today ? t('daily.noActivityYet') : t('daily.noActivityDay')}</span>
            ) : (
              grid.totals.map((total) => (
                <span key={total.category}>
                  {total.category} <b style={{ color: colorOf(total.category) }}>{durationLabel(total.minutes)}</b>
                </span>
              ))
            )}
          </div>
        </div>
        <Standup day={day} />
      </div>
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
  const { t } = useTranslation()
  const [entry, setEntry] = useState<StandupEntry | null>(null)
  const [draft, setDraft] = useState<StandupDraft>(emptyStandup)
  /** WRITING while a standup is generated, else the last error. */
  const [busy, setBusy] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const pending = useRef<{ timer: ReturnType<typeof setTimeout>; save: () => void } | null>(null)
  const viewing = useRef(day)
  viewing.current = day
  const [provider, setProvider] = useDailyProvider()
  const off = provider === 'none'

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
    setBusy(WRITING)
    const result = await window.dayflow.generateStandup(target)
    // Upstream drops results for a day the user has moved away from.
    if (viewing.current !== target) return
    setBusy(result.ok ? null : result.message)
    if (result.ok) apply(result.entry)
  }

  const titles = standupTitles(day, entry?.sourceDay ?? null, todayKey())
  const regenerating = busy === WRITING
  return (
    <section className="standup">
      <div className="standup-head">
        <h2 className="serif-heading">{t('daily.standupFor', { date: longDate(day, todayKey()) })}</h2>
        <button
          className="btn-glass daily-pill"
          onClick={() =>
            void window.dayflow.copyText(standupText(draft, titles)).then(() => {
              setCopied(true)
              setTimeout(() => setCopied(false), 2000)
            })
          }
        >
          <Copy size={15} />
          {copied ? t('common.copied') : t('daily.copyStandup')}
        </button>
        <button
          className="btn-glass daily-pill"
          disabled={regenerating || off}
          title={off ? t('daily.provider.off') : undefined}
          onClick={() => void regenerate()}
        >
          <RotateCw size={15} />
          {regenerating ? t('daily.regenerating') : t('daily.regenerate')}
        </button>
        {provider && (
          <DailyProviderButton
            choice={provider}
            disabled={regenerating}
            onPick={(next) => {
              setBusy(null)
              setProvider(next)
            }}
          />
        )}
      </div>
      {busy && !regenerating && <p className="note">{busy}</p>}
      {off && !busy && <p className="note">{t('daily.provider.off')}</p>}
      {!entry && !off && <p className="note">{t('daily.notGenerated')}</p>}
      <div className="standup-cards">
        <div className="standup-card">
          <ItemList title={titles.highlights} items={draft.highlights} onChange={(highlights) => edit({ ...draft, highlights })} />
        </div>
        <div className="standup-card">
          <ItemList title={titles.tasks} items={draft.tasks} onChange={(tasks) => edit({ ...draft, tasks })} />
          <div className="blockers">
            <h4>{titles.blockers}</h4>
            <textarea
              rows={3}
              placeholder={t('daily.blockersPlaceholder')}
              value={draft.blockersBody}
              onChange={(e) => edit({ ...draft, blockersBody: e.target.value })}
            />
          </div>
        </div>
      </div>
    </section>
  )
}

/**
 * Editable items without bullets: Enter adds an item after the current one,
 * Backspace on an empty item removes it, the handle drags it to a new place.
 */
function ItemList({ title, items, onChange }: { title: string; items: string[]; onChange: (items: string[]) => void }) {
  const { t } = useTranslation()
  const refs = useRef<Array<HTMLInputElement | null>>([])
  const [dragging, setDragging] = useState<number | null>(null)
  const focus = (i: number) => setTimeout(() => refs.current[i]?.focus(), 0)
  const move = (from: number, to: number) => {
    if (from === to) return
    const next = [...items]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item!)
    onChange(next)
  }
  return (
    <>
      <h4>{title}</h4>
      <ul className="items">
        {items.map((item, i) => (
          <li
            key={i}
            onDragOver={(e) => dragging !== null && e.preventDefault()}
            onDrop={() => {
              if (dragging !== null) move(dragging, i)
              setDragging(null)
            }}
          >
            <span className="grip" draggable aria-hidden="true" onDragStart={() => setDragging(i)} onDragEnd={() => setDragging(null)}>
              <GripVertical size={14} />
            </span>
            <input
              ref={(el) => {
                refs.current[i] = el
              }}
              value={item}
              aria-label={t('daily.itemLabel', { title, number: i + 1 })}
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
      <button className="add-item" onClick={() => (onChange([...items, '']), focus(items.length))}>
        <Plus size={14} />
        {t('daily.addItem')}
      </button>
    </>
  )
}
