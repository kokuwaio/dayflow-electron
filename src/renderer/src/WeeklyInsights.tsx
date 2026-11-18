// Weekly sections after upstream Views/UI/Weekly/Sections/WeeklyOverviewSection.swift,
// WeeklyHighlightsSection.swift and WeeklyApplicationInteractionsSection.swift.
// The numbers come from src/shared/weekly-insights.ts.

import { useState } from 'react'
import { hourLabel, parseKey } from '@shared/day'
import { formatMinutes } from '@shared/day-summary'
import { type AppInteractions, type AppKind, type OverviewTab, type PatternApp, type WeeklyHighlight, type WeeklyOverview, overviewFocusDays } from '@shared/weekly-insights'

const weekday = (day: string, style: 'short' | 'long' = 'short') => parseKey(day).toLocaleDateString(style === 'long' ? 'en-US' : [], { weekday: style })
const times = (n: number) => `${n} ${n === 1 ? 'time' : 'times'}`

const TABS: Array<[OverviewTab, string]> = [
  ['all', 'All'],
  ['longest', 'Longest focus period'],
  ['least', 'Least context shifts'],
  ['most', 'Most context shifts']
]

/** "Time distribution": each day's cards as bars, with context switch and focus totals below. */
export function OverviewCard({ overview }: { overview: WeeklyOverview }) {
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
        <h3>Time distribution</h3>
        <div className="overview-tabs" role="tablist" aria-label="Highlight days">
          {TABS.map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
              {label}
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
                  title={`Longest focus: ${formatMinutes(longest.minutes)}`}
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
                {hourLabel(m)}
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
          title="Context switch"
          metrics={[
            ['Total', times(overview.switchTotal)],
            ['Average', `${times(overview.switchAverage)} / day`]
          ]}
        />
        <SummaryGroup
          title="Focus"
          metrics={[
            ['Total length', formatMinutes(overview.focusMinutes)],
            ['Longest duration', longest ? `${formatMinutes(longest.minutes)}, ${weekday(longest.day, 'long')}` : 'No focus yet'],
            ['Primary focus', overview.primaryFocus ? `${overview.primaryFocus.name}, ${formatMinutes(overview.primaryFocus.minutes)}` : 'No focus yet']
          ]}
        />
      </div>
    </section>
  )
}

/** "9:15 AM" for a clock minute (24:00-28:00 after midnight). */
function hourText(minute: number): string {
  const m = Math.round(minute) % 1440
  const h = Math.floor(m / 60)
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
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
  return (
    <section className="w-card wide highlights">
      <h3>Top highlights</h3>
      {highlights.length ? (
        <ol>
          {highlights.map((h) => (
            <li key={h.id}>
              <span className="tag" style={{ ['--tag' as string]: h.color }}>
                {h.tag}
              </span>
              <p>{h.text}</p>
              <span className="meta">
                {weekday(h.day)} · {formatMinutes(h.minutes)}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="note">No highlights this week yet.</p>
      )}
    </section>
  )
}

const KIND_LABELS: Array<[AppKind, string]> = [
  ['work', 'Work'],
  ['personal', 'Personal'],
  ['distraction', 'Distraction']
]
/** Upstream's edge opacity and width per kind, from the switch's weight (0-1). */
const EDGE_STYLE: Record<AppKind, (w: number) => { opacity: number; width: number }> = {
  work: (w) => ({ opacity: 0.24 + w * 0.24, width: 0.9 + w * 0.95 }),
  personal: (w) => ({ opacity: 0.18 + w * 0.2, width: 0.8 + w * 0.75 }),
  distraction: (w) => ({ opacity: 0.66 + w * 0.34, width: 0.95 + w * 1.05 })
}
const shortName = (name: string) => (name.length > 14 ? `${name.slice(0, 13)}…` : name)

/** "Interactions between most used applications", with the week's work patterns and rabbit holes beside it. */
export function InteractionsCard({ data }: { data: AppInteractions }) {
  const byId = new Map(data.nodes.map((n) => [n.id, n]))
  return (
    <section className="w-card wide interactions">
      <div className="interactions-graph">
        <h3>Interactions between most used applications</h3>
        <p className="sub">{data.subtitle}</p>
        {data.nodes.length > 0 && (
          <>
            <svg viewBox="20 64 525 400" role="img" aria-label="Apps as circles, lines for switches between them">
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
                  <title>{`${n.name}: ${formatMinutes(n.minutes)} in ${n.visits} ${n.visits === 1 ? 'card' : 'cards'}`}</title>
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
              {KIND_LABELS.map(([kind, label]) => (
                <li key={kind}>
                  <span className={`swatch ${kind}`} />
                  {label}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      {data.nodes.length > 0 && (
        <div className="interactions-side">
          <h3>Most common work patterns</h3>
          {data.patterns.length ? (
            data.patterns.map((p) => (
              <div key={`${p.from.id}-${p.to.id}`} className="pattern">
                <Flow from={[p.from]} to={[p.to]} fromAverage={p.from.average} toAverage={p.to.average} count={p.perDay} tone="work" />
                <p>{p.text}</p>
              </div>
            ))
          ) : (
            <p className="note">No app switches between work apps this week.</p>
          )}
          <h3>Distractions and rabbit holes</h3>
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
            <p className="note">No distracting apps this week.</p>
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
        <span className="avg">{formatMinutes(props.fromAverage)} avg</span>
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
        <span className="avg">{formatMinutes(props.toAverage)} avg</span>
      </div>
    </div>
  )
}
