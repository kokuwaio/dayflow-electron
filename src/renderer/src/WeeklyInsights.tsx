// Weekly sections after upstream Views/UI/Weekly/Sections/WeeklyOverviewSection.swift,
// WeeklyHighlightsSection.swift and WeeklyApplicationInteractionsSection.swift.
// The numbers come from src/shared/weekly-insights.ts.

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { clockLabel, dateLabel, durationLabel, hourAxisLabel, t } from '@shared/i18n'
import { type AppInteractions, type AppKind, type OverviewTab, type PatternApp, type WeeklyHighlight, type WeeklyOverview, overviewFocusDays } from '@shared/weekly-insights'

const weekday = (day: string, style: 'short' | 'long' = 'short') => dateLabel(day, { weekday: style })
const times = (count: number) => t('weekly.times', { count })

const TABS: OverviewTab[] = ['all', 'longest', 'least', 'most']

/** "Time distribution": each day's cards as bars, with context switch and focus totals below. */
export function OverviewCard({ overview }: { overview: WeeklyOverview }) {
  const { t } = useTranslation()
  const [tab, setTab] = useState<OverviewTab>('all')
  const focus = overviewFocusDays(overview, tab)
  const span = Math.max(1, overview.endMinute - overview.startMinute)
  const pct = (minute: number) => ((minute - overview.startMinute) / span) * 100
  const hours: number[] = []
  const step = span > 12 * 60 ? 120 : 60
  for (let m = overview.startMinute; m <= overview.endMinute; m += step) hours.push(m)
  const longest = overview.longestFocus
  return (
    <section className="w-card wide overview">
      <div className="overview-head">
        <h3>{t('weekly.overview.title')}</h3>
        <div className="overview-tabs" role="tablist" aria-label={t('weekly.overview.tabsLabel')}>
          {TABS.map((id) => (
            <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
              {t(`weekly.overview.tabs.${id}`)}
            </button>
          ))}
        </div>
      </div>
      <div className="overview-chart">
        {overview.rows.map((row) => (
          <div key={row.day} className={`overview-row${focus && !focus.includes(row.day) ? ' dim' : ''}`}>
            <span className="day">{weekday(row.day)}</span>
            <div className="track">
              {row.segments.map((s) => (
                <span
                  key={`${s.start}-${s.category}`}
                  className="seg"
                  title={`${s.category}: ${hourText(s.start)} – ${hourText(s.end)}`}
                  style={{ left: `calc(${pct(s.start)}% + 1px)`, width: `max(2px, calc(${pct(s.end) - pct(s.start)}% - 2px))`, ['--seg' as string]: s.color }}
                />
              ))}
              {tab === 'longest' && longest?.day === row.day && (
                <span
                  className="longest"
                  title={t('weekly.overview.longestTitle', { duration: durationLabel(longest.minutes) })}
                  style={{ left: `${pct(Math.max(longest.start, overview.startMinute))}%`, width: `${pct(Math.min(longest.end, overview.endMinute)) - pct(Math.max(longest.start, overview.startMinute))}%` }}
                />
              )}
            </div>
          </div>
        ))}
        <div className="overview-axis">
          {hours.map((m) => {
            const at = pct(m)
            return (
              <span key={m} style={{ left: `${at}%`, transform: at <= 0 ? 'none' : at >= 100 ? 'translateX(-100%)' : 'translateX(-50%)' }}>
                {hourAxisLabel(m)}
              </span>
            )
          })}
        </div>
      </div>
      {overview.legend.length > 0 && (
        <ul className="overview-legend">
          {overview.legend.map((l) => (
            <li key={l.name}>
              {l.name}
              <span className="swatch" style={{ background: l.color }} />
            </li>
          ))}
        </ul>
      )}
      <div className="overview-foot">
        <SummaryGroup
          title={t('weekly.overview.switch')}
          metrics={[
            [t('weekly.overview.total'), times(overview.switchTotal)],
            [t('weekly.overview.average'), t('weekly.overview.perDay', { count: overview.switchAverage })]
          ]}
        />
        <SummaryGroup
          title={t('weekly.overview.focus')}
          metrics={[
            [t('weekly.overview.totalLength'), durationLabel(overview.focusMinutes)],
            [
              t('weekly.overview.longestDuration'),
              longest ? t('weekly.overview.durationOnDay', { duration: durationLabel(longest.minutes), day: weekday(longest.day, 'long') }) : t('weekly.overview.noFocus')
            ],
            [
              t('weekly.overview.primaryFocus'),
              overview.primaryFocus
                ? t('weekly.overview.categoryDuration', { name: overview.primaryFocus.name, duration: durationLabel(overview.primaryFocus.minutes) })
                : t('weekly.overview.noFocus')
            ]
          ]}
        />
      </div>
    </section>
  )
}

/** "9:15 AM" (or the language's clock) for a clock minute (24:00-28:00 after midnight). */
function hourText(minute: number): string {
  const m = Math.round(minute) % 1440
  return clockLabel(new Date(2000, 0, 1, Math.floor(m / 60), m % 60).getTime() / 1000)
}

function SummaryGroup({ title, metrics }: { title: string; metrics: Array<[string, string]> }) {
  return (
    <div className="summary-group">
      <h4>{title}</h4>
      <dl>
        {metrics.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

/** "Top highlights": the week's three longest cards. */
export function HighlightsCard({ highlights }: { highlights: WeeklyHighlight[] }) {
  const { t } = useTranslation()
  return (
    <section className="w-card wide highlights">
      <h3>{t('weekly.highlights.title')}</h3>
      {highlights.length ? (
        <ol>
          {highlights.map((h) => (
            <li key={h.id}>
              <span className="tag" style={{ ['--tag' as string]: h.color }}>
                {h.tag}
              </span>
              <p>{h.text}</p>
              <span className="meta">
                {weekday(h.day)} · {durationLabel(h.minutes)}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="note">{t('weekly.highlights.empty')}</p>
      )}
    </section>
  )
}

const KINDS: AppKind[] = ['work', 'personal', 'distraction']
/** Upstream's edge opacity and width per kind, from the switch's weight (0-1). */
const EDGE_STYLE: Record<AppKind, (w: number) => { opacity: number; width: number }> = {
  work: (w) => ({ opacity: 0.24 + w * 0.24, width: 0.9 + w * 0.95 }),
  personal: (w) => ({ opacity: 0.18 + w * 0.2, width: 0.8 + w * 0.75 }),
  distraction: (w) => ({ opacity: 0.66 + w * 0.34, width: 0.95 + w * 1.05 })
}
const shortName = (name: string) => (name.length > 14 ? `${name.slice(0, 13)}…` : name)

/** "Interactions between most used applications", with the week's work patterns and rabbit holes beside it. */
export function InteractionsCard({ data }: { data: AppInteractions }) {
  const { t } = useTranslation()
  const byId = new Map(data.nodes.map((n) => [n.id, n]))
  return (
    <section className="w-card wide interactions">
      <div className="interactions-graph">
        <h3>{t('weekly.interactions.title')}</h3>
        <p className="sub">{data.subtitle}</p>
        {data.nodes.length > 0 && (
          <>
            <svg viewBox="20 64 525 400" role="img" aria-label={t('weekly.interactions.aria')}>
              {data.edges.map((e) => {
                const a = byId.get(e.from)!
                const b = byId.get(e.to)!
                const style = EDGE_STYLE[e.kind](e.weight)
                return (
                  <path
                    key={`${e.from}-${e.to}`}
                    d={`M${a.x} ${a.y} Q${(a.x + b.x) / 2} ${(a.y + b.y) / 2 + e.curve} ${b.x} ${b.y}`}
                    fill="none"
                    strokeLinecap="round"
                    style={{ stroke: `var(--app-${e.kind}-edge)`, strokeOpacity: style.opacity, strokeWidth: style.width }}
                  >
                    <title>{`${a.name} → ${b.name}: ${times(e.count)}`}</title>
                  </path>
                )
              })}
              {data.nodes.map((n) => (
                <g key={n.id} className={`app-node ${n.kind}${n.muted ? ' muted' : ''}`}>
                  <title>{t('weekly.interactions.nodeTitle', { name: n.name, duration: durationLabel(n.minutes), count: n.visits })}</title>
                  <circle cx={n.x} cy={n.y} r={n.size / 2 + (n.primary ? 7 : 1)} className="base" />
                  {n.primary && <circle cx={n.x} cy={n.y} r={n.size / 2 + 5} className="halo" />}
                  <circle cx={n.x} cy={n.y} r={n.size / 2} strokeWidth={n.primary ? 3 : 2.5} />
                  <text x={n.x} y={n.y} className="mark" dy="0.35em" fontSize={n.primary ? 20 : 13}>
                    {n.mark}
                  </text>
                  <text x={n.x} y={n.y + n.size / 2 + (n.primary ? 20 : 13)} className="name">
                    {shortName(n.name)}
                  </text>
                </g>
              ))}
            </svg>
            <ul className="kind-legend">
              {KINDS.map((kind) => (
                <li key={kind}>
                  <span className={`swatch ${kind}`} />
                  {t(`weekly.interactions.kinds.${kind}`)}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      {data.nodes.length > 0 && (
        <div className="interactions-side">
          <h3>{t('weekly.interactions.patterns')}</h3>
          {data.patterns.length ? (
            data.patterns.map((p) => (
              <div key={`${p.from.id}-${p.to.id}`} className="pattern">
                <Flow from={[p.from]} to={[p.to]} fromAverage={p.from.average} toAverage={p.to.average} count={p.perDay} tone="work" />
                <p>{p.text}</p>
              </div>
            ))
          ) : (
            <p className="note">{t('weekly.interactions.noPatterns')}</p>
          )}
          <h3>{t('weekly.interactions.rabbitHoles')}</h3>
          {data.rabbitHole ? (
            <div className="rabbit-hole">
              <Flow
                from={[data.rabbitHole.from]}
                to={data.rabbitHole.targets}
                fromAverage={data.rabbitHole.from.average}
                toAverage={data.rabbitHole.average}
                count={data.rabbitHole.targets.length}
                tone="distraction"
              />
            </div>
          ) : (
            <p className="note">{t('weekly.interactions.noRabbitHoles')}</p>
          )}
        </div>
      )}
    </section>
  )
}

/** Dark letters on light app colours, white on dark ones. */
function chipInk(hex: string): string {
  const n = parseInt(hex.replace('#', ''), 16)
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b! > 0.4 ? '#333333' : '#ffffff'
}

function AppName({ app }: { app: PatternApp }) {
  return (
    <span className="app-name">
      <span className="app-chip" style={{ background: app.color, ['--chip-ink' as string]: chipInk(app.color) }}>
        {app.initial}
      </span>
      {app.name}
    </span>
  )
}

/** Apps on the left, a counter, apps on the right, each side with its average visit. */
function Flow(props: { from: PatternApp[]; to: PatternApp[]; fromAverage: number; toAverage: number; count: number; tone: 'work' | 'distraction' }) {
  return (
    <div className={`flow ${props.tone}`}>
      <div className="end">
        {props.from.map((a) => (
          <AppName key={a.id} app={a} />
        ))}
        <span className="avg">{t('weekly.interactions.average', { duration: durationLabel(props.fromAverage) })}</span>
      </div>
      <span className="count">
        <b>{props.count}</b>
      </span>
      <div className="end">
        <div className="apps">
          {props.to.map((a) => (
            <AppName key={a.id} app={a} />
          ))}
        </div>
        <span className="avg">{t('weekly.interactions.average', { duration: durationLabel(props.toAverage) })}</span>
      </div>
    </div>
  )
}
