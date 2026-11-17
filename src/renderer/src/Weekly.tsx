import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { Category } from '@shared/categories'
import type { FeatureAccess } from '@shared/daily'
import { hourLabel, parseKey, shiftDay, todayKey } from '@shared/day'
import { formatMinutes } from '@shared/day-summary'
import { escapeHtml } from '@shared/html'
import type { TimelineCard } from '@shared/types'
import type { Week } from '@shared/week'
import { type FocusHeatmap, WEEKLY_MIN_TRACKED_MINUTES, contextShifts, donutItems, focusHeatmap, heatmapColor, sankeyLinks, trackedMinutes, treemap, workflowHeatmap } from '@shared/weekly'
import { Chart, cssToken, useDark } from './Chart'
import { LockedFeature, ProgressBar } from './LockedFeature'

/** "#RRGGBB" at the given alpha, for ECharts (which cannot mix CSS colours). */
function withAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return hex
  const n = parseInt(m[1]!, 16)
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

/** "(+30m more than last week)", or nothing when there is no earlier week to compare with. */
const changeText = (change: number | null | undefined) =>
  change == null ? '' : change === 0 ? ' (same as last week)' : ` (${change > 0 ? '+' : '−'}${formatMinutes(Math.abs(change))} ${change > 0 ? 'more' : 'less'} than last week)`

/** The Weekly tab (upstream WeeklyView): charts built from the week's cards, no AI. */
export function Weekly() {
  const [access, setAccess] = useState<FeatureAccess | null>(null)
  const [day, setDay] = useState<string | null>(null)
  const [data, setData] = useState<{ week: Week; cards: TimelineCard[]; previous: TimelineCard[] } | null>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const dark = useDark()

  useEffect(() => {
    void window.dayflow.getAccess().then((a) => setAccess(a.weekly))
    void window.dayflow.getSettings().then((s) => setCategories(s.categories))
    void window.dayflow.getWeeklyDefaultDay().then(setDay)
  }, [])
  useEffect(() => {
    if (!day) return
    let current = true
    void window.dayflow.getWeekly(day).then((d) => current && setData(d))
    return () => {
      current = false
    }
  }, [day])

  const charts = useMemo(() => {
    if (!data) return null
    const { cards, previous, week } = data
    return {
      tracked: trackedMinutes(cards, categories),
      donut: donutItems(cards, categories),
      shifts: contextShifts(cards, categories, week.days),
      heatmap: workflowHeatmap(cards, categories, week.days),
      focus: focusHeatmap(cards, categories, week.days),
      tree: treemap(cards, previous, categories),
      sankey: sankeyLinks(cards, categories)
    }
  }, [data, categories])

  if (!access) return null
  if (!access.unlocked) {
    return (
      <LockedFeature title="Unlock Weekly" access={access}>
        <p>Weekly unlocks after 30 hours of recorded timeline data.</p>
      </LockedFeature>
    )
  }
  if (!data || !charts || !day) return null
  const isCurrent = data.week.days.includes(todayKey())
  const long = (d: string) => parseKey(d).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
  const total = charts.donut.reduce((sum, d) => sum + d.minutes, 0)
  const ink = cssToken('--text-primary') || (dark ? '#FFFFFF' : '#333333')
  const titleFont = cssToken('--font-serif')

  return (
    <div className="weekly">
      <div className="weekly-page">
        <div className="date-row">
          <button className="nav-arrow" aria-label="Previous week" onClick={() => setDay(shiftDay(day, -7))}>
            <ChevronLeft size={24} strokeWidth={1.5} />
          </button>
          <h1>
            {long(data.week.days[0]!)} - {long(data.week.days[6]!)}
          </h1>
          <button className="nav-arrow" aria-label="Next week" disabled={isCurrent} onClick={() => setDay(shiftDay(day, 7))}>
            <ChevronRight size={24} strokeWidth={1.5} />
          </button>
        </div>
        {charts.tracked < WEEKLY_MIN_TRACKED_MINUTES ? (
          <section className="w-card gate">
            <h2 className="serif-heading" style={{ color: 'var(--text-primary)' }}>
              Keep recording to unlock this week
            </h2>
            <span className="progress-pill">
              {formatMinutes(charts.tracked)} / {formatMinutes(WEEKLY_MIN_TRACKED_MINUTES)}
            </span>
            <ProgressBar
              value={charts.tracked / WEEKLY_MIN_TRACKED_MINUTES}
              label="Weekly unlock progress"
              text={`${formatMinutes(charts.tracked)} of ${formatMinutes(WEEKLY_MIN_TRACKED_MINUTES)}`}
            />
            <p className="note">{formatMinutes(WEEKLY_MIN_TRACKED_MINUTES - charts.tracked)} more to see this week's charts.</p>
          </section>
        ) : (
          <div className="weekly-grid">
            <section className="w-card">
              <h3>Weekly distribution</h3>
              <Chart
                height={300}
                option={{
                  tooltip: { trigger: 'item', valueFormatter: (v: unknown) => formatMinutes(Number(v)) },
                  legend: {
                    orient: 'vertical',
                    right: 0,
                    top: 'middle',
                    icon: 'roundRect',
                    itemWidth: 12,
                    itemHeight: 8,
                    textStyle: { fontSize: 14 },
                    formatter: (name: string) => {
                      const item = charts.donut.find((d) => d.name === name)
                      return `${name}  ${item && total ? Math.round((item.minutes / total) * 100) : 0}%`
                    }
                  },
                  title: {
                    text: 'TOTAL',
                    subtext: formatMinutes(charts.tracked),
                    left: '35%',
                    top: 'middle',
                    textAlign: 'center',
                    textStyle: { fontSize: 12, fontWeight: 700, color: cssToken('--donut-total') },
                    subtextStyle: { fontSize: 16, fontFamily: titleFont }
                  },
                  series: [
                    {
                      type: 'pie',
                      center: ['35%', '50%'],
                      radius: ['58%', '78%'],
                      padAngle: 1.5,
                      itemStyle: { borderRadius: 4 },
                      label: { show: false },
                      data: charts.donut.map((d) => ({ name: d.name, value: d.minutes, itemStyle: { color: d.color, opacity: 0.8 } }))
                    }
                  ]
                }}
              />
            </section>
            <section className="w-card">
              <h3>Context shift and distractions comparison</h3>
              <Chart
                height={242}
                option={{
                  tooltip: { trigger: 'axis' },
                  legend: { top: 0, left: 0, icon: 'circle', itemWidth: 8, textStyle: { fontSize: 12 } },
                  grid: { left: 8, right: 12, top: 36, bottom: 4, containLabel: true },
                  xAxis: {
                    type: 'category',
                    data: charts.shifts.days.map((d) => parseKey(d.day).toLocaleDateString([], { weekday: 'short' })),
                    axisTick: { show: false }
                  },
                  yAxis: { type: 'value', minInterval: 1, splitLine: { show: false }, axisLine: { show: true } },
                  series: [
                    {
                      name: 'Number of times distracted',
                      type: 'line',
                      smooth: true,
                      symbolSize: 6,
                      lineStyle: { width: 2 },
                      data: charts.shifts.days.map((d) => d.distractions),
                      itemStyle: { color: '#FF8A8A' }
                    },
                    {
                      name: 'Number of context shifts',
                      type: 'line',
                      smooth: true,
                      symbolSize: 6,
                      lineStyle: { width: 2 },
                      data: charts.shifts.days.map((d) => d.shifts),
                      itemStyle: { color: '#A78CFF' }
                    }
                  ]
                }}
              />
              <p className="insight">{charts.shifts.insight}</p>
            </section>
            <section className="w-card wide">
              <h3>Your workflow this week</h3>
              <div className="heat" style={{ gridTemplateColumns: `48px repeat(${charts.heatmap.slots}, 1fr)` }}>
                <span />
                {Array.from({ length: Math.ceil(charts.heatmap.slots / 4) }, (_, i) => (
                  // The last label spans only the slots left, so the header never wraps.
                  <span key={i} className="hour" style={{ gridColumn: `span ${Math.min(4, charts.heatmap.slots - i * 4)}` }}>
                    {hourLabel(charts.heatmap.startMinute + i * 60)}
                  </span>
                ))}
                {charts.heatmap.rows.map((row) => (
                  <HeatRow key={row.day} day={row.day} cells={row.cells} />
                ))}
              </div>
            </section>
            <FocusHeatmapCard map={charts.focus} />
            <section className="w-card wide">
              <h3>Most used per category</h3>
              <Chart
                height={320}
                option={{
                  tooltip: {
                    formatter: (p: unknown) => {
                      const { name, value, data } = p as { name: string; value: number; data: { change?: number | null } }
                      // Tooltips render HTML; app names come from the model.
                      return `${escapeHtml(name)}: ${formatMinutes(value)}${changeText(data.change)}`
                    }
                  },
                  series: [
                    {
                      type: 'treemap',
                      roam: false,
                      nodeClick: false,
                      breadcrumb: { show: false },
                      left: 0,
                      right: 0,
                      top: 0,
                      bottom: 0,
                      upperLabel: { show: true, height: 26, fontFamily: titleFont, fontSize: 16, color: ink },
                      label: { fontFamily: titleFont, fontSize: 15, color: ink },
                      // Category shells at 25% of their colour, app tiles at 42% (upstream's treemap).
                      levels: [
                        // A parent's background is its border colour in ECharts treemaps.
                        { upperLabel: { show: false }, itemStyle: { color: 'transparent', borderColor: 'transparent', borderWidth: 0, gapWidth: 6 } },
                        { itemStyle: { borderWidth: 3, gapWidth: 3, borderRadius: 4 } },
                        { itemStyle: { borderWidth: 0, borderColor: 'transparent', borderRadius: 4 } }
                      ],
                      data: charts.tree.map((c) => ({
                        name: c.category,
                        value: c.minutes,
                        itemStyle: { color: withAlpha(c.color, 0.25), borderColor: withAlpha(c.color, 0.25) },
                        children: c.apps.map((a) => ({ name: a.app, value: a.minutes, change: a.change, itemStyle: { color: withAlpha(c.color, 0.42) } }))
                      }))
                    }
                  ]
                }}
              />
            </section>
            <section className="w-card wide">
              <h3>Weekly breakdown</h3>
              <Chart
                height={360}
                option={{
                  tooltip: { trigger: 'item', valueFormatter: (v: unknown) => formatMinutes(Number(v)) },
                  series: [
                    {
                      type: 'sankey',
                      emphasis: { focus: 'adjacency' },
                      nodeAlign: 'left',
                      nodeWidth: 12,
                      label: { fontSize: 12 },
                      data: [...new Set(charts.sankey.flatMap((l) => [l.source, l.target]))].map((name) => ({
                        name,
                        itemStyle: { color: categories.find((c) => c.name === name)?.color ?? '#C9B8AC', borderWidth: 0 }
                      })),
                      links: charts.sankey.map((l) => ({ source: l.source, target: l.target, value: l.minutes })),
                      lineStyle: { color: 'gradient', opacity: 0.25 }
                    }
                  ]
                }}
              />
            </section>
          </div>
        )}
      </div>
    </div>
  )
}

function HeatRow({ day, cells }: { day: string; cells: Array<{ category: string | null; color: string; occupancy: number }> }) {
  return (
    <>
      <span className="row-label">{parseKey(day).toLocaleDateString([], { weekday: 'short' })}</span>
      {cells.map((c, i) => (
        <span
          key={i}
          className="cell"
          title={c.category ?? undefined}
          style={{ background: c.category ? `color-mix(in srgb, ${c.color} ${Math.round((0.3 + 0.7 * c.occupancy) * 100)}%, transparent)` : 'var(--empty-cell)' }}
        />
      ))}
    </>
  )
}

/** "Focus and distraction heat map": 5-minute cells per day, Sunday first (upstream WeeklyFocusHeatmapSection). */
function FocusHeatmapCard({ map }: { map: FocusHeatmap }) {
  const count = map.rows[0]?.values.length ?? 0
  const span = map.endMinute - map.startMinute
  const hours: number[] = []
  for (let m = Math.ceil(map.startMinute / 60) * 60; m <= map.endMinute; m += 60) hours.push(m)
  return (
    <section className="w-card wide focus-heat">
      <div className="focus-heat-head">
        <h3>Focus and distraction heat map</h3>
        <div className="focus-heat-legend" aria-hidden="true">
          <span className="bar" />
          <span className="labels">
            <span>Focused work</span>
            <span>Distracted</span>
          </span>
        </div>
      </div>
      <div className="focus-heat-body">
        <div className="focus-heat-days">
          {map.rows.map((r) => (
            <span key={r.day}>{parseKey(r.day).toLocaleDateString([], { weekday: 'short' })}</span>
          ))}
        </div>
        <div className="focus-heat-scroll">
          <div className="focus-heat-grid" role="img" aria-label="Focus (blue) and distraction (peach) per 5 minutes and day" style={{ gridTemplateColumns: `repeat(${count}, minmax(4px, 1fr))` }}>
            {map.rows.flatMap((r) =>
              r.values.map((_, i) => {
                const color = heatmapColor(r.values, i)
                return <span key={`${r.day}-${i}`} style={color ? { background: color } : undefined} />
              })
            )}
          </div>
          <div className="focus-heat-axis">
            {hours.map((m) => {
              const at = span ? ((m - map.startMinute) / span) * 100 : 0
              return (
                <span key={m} style={{ left: `${at}%`, transform: at <= 0 ? 'none' : at >= 100 ? 'translateX(-100%)' : 'translateX(-50%)' }}>
                  {hourLabel(m)}
                </span>
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
}
