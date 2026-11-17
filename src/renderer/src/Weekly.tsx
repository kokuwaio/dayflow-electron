import { useEffect, useMemo, useState } from 'react'
import type { Category } from '@shared/categories'
import type { FeatureAccess } from '@shared/daily'
import { hourLabel, parseKey, shiftDay, todayKey } from '@shared/day'
import { formatMinutes as hm } from '@shared/day-summary'
import type { TimelineCard } from '@shared/types'
import { type Week, weekOf } from '@shared/week'
import { WEEKLY_MIN_TRACKED_MINUTES, contextShifts, donutItems, sankeyLinks, trackedMinutes, treemap, workflowHeatmap } from '@shared/weekly'
import { Chart } from './Chart'

/** "(+30m more than last week)", or nothing when there is no earlier week to compare with. */
const changeText = (change: number | null | undefined) =>
  change == null ? '' : change === 0 ? ' (same as last week)' : ` (${change > 0 ? '+' : '−'}${hm(Math.abs(change))} ${change > 0 ? 'more' : 'less'} than last week)`

/** The Weekly tab (upstream WeeklyView): charts built from the week's cards, no AI. */
export function Weekly() {
  const [access, setAccess] = useState<FeatureAccess | null>(null)
  const [day, setDay] = useState<string | null>(null)
  const [data, setData] = useState<{ week: Week; cards: TimelineCard[]; previous: TimelineCard[] } | null>(null)
  const [categories, setCategories] = useState<Category[]>([])

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
      tree: treemap(cards, previous, categories),
      sankey: sankeyLinks(cards, categories)
    }
  }, [data, categories])

  if (!access) return null
  if (!access.unlocked) {
    return (
      <div className="locked">
        <h2>Unlock Weekly</h2>
        <p className="note">Weekly unlocks after 30 hours of recorded timeline data. {access.label}</p>
      </div>
    )
  }
  if (!data || !charts || !day) return null
  const isCurrent = data.week.days.includes(todayKey())

  return (
    <div className="weekly">
      <div className="daynav">
        <button aria-label="Previous week" onClick={() => setDay(shiftDay(day, -7))}>
          ‹
        </button>
        <h1>{data.week.title}</h1>
        <button aria-label="Next week" disabled={isCurrent} onClick={() => setDay(shiftDay(day, 7))}>
          ›
        </button>
        {!isCurrent && (
          <button className="link" onClick={() => setDay(todayKey())}>
            This week
          </button>
        )}
      </div>
      {charts.tracked < WEEKLY_MIN_TRACKED_MINUTES ? (
        <section className="locked">
          <p>
            {hm(charts.tracked)} / 15h tracked. {hm(WEEKLY_MIN_TRACKED_MINUTES - charts.tracked)} more to unlock this week.
          </p>
        </section>
      ) : (
        <div className="weekly-grid">
          <section>
            <h3>Weekly distribution</h3>
            <Chart
              option={{
                tooltip: { trigger: 'item', valueFormatter: (v: unknown) => hm(Number(v)) },
                series: [
                  {
                    type: 'pie',
                    radius: ['62%', '82%'],
                    label: { formatter: '{b}\n{d}%' },
                    data: charts.donut.map((d) => ({ name: d.name, value: d.minutes, itemStyle: { color: d.color } }))
                  }
                ],
                title: { text: 'TOTAL', subtext: hm(charts.tracked), left: 'center', top: 'center', textStyle: { fontSize: 11 } }
              }}
            />
          </section>
          <section>
            <h3>Context shifts and distractions</h3>
            <Chart
              option={{
                tooltip: { trigger: 'axis' },
                legend: { bottom: 0 },
                xAxis: { type: 'category', data: charts.shifts.days.map((d) => parseKey(d.day).toLocaleDateString([], { weekday: 'short' })) },
                yAxis: { type: 'value', minInterval: 1 },
                series: [
                  { name: 'Context shifts', type: 'bar', data: charts.shifts.days.map((d) => d.shifts), itemStyle: { color: '#6A7EFF' } },
                  { name: 'Distractions', type: 'bar', data: charts.shifts.days.map((d) => d.distractions), itemStyle: { color: '#FF5950' } }
                ]
              }}
            />
            <p className="note">{charts.shifts.insight}</p>
          </section>
          <section className="wide">
            <h3>Weekly workflow</h3>
            <div className="workflow" style={{ gridTemplateColumns: `60px repeat(${charts.heatmap.slots}, 1fr)` }}>
              <span />
              {Array.from({ length: Math.ceil(charts.heatmap.slots / 4) }, (_, i) => (
                <span key={i} className="hour" style={{ gridColumn: 'span 4' }}>
                  {hourLabel(charts.heatmap.startMinute + i * 60)}
                </span>
              ))}
              {charts.heatmap.rows.map((row) => (
                <HeatRow key={row.day} day={row.day} cells={row.cells} />
              ))}
            </div>
          </section>
          <section className="wide">
            <h3>Most used per category</h3>
            <Chart
              height={320}
              option={{
                tooltip: {
                  formatter: (p: unknown) => {
                    const { name, value, data } = p as { name: string; value: number; data: { change?: number | null } }
                    return `${name}: ${hm(value)}${changeText(data.change)}`
                  }
                },
                series: [
                  {
                    type: 'treemap',
                    roam: false,
                    nodeClick: false,
                    breadcrumb: { show: false },
                    upperLabel: { show: true, height: 22 },
                    data: charts.tree.map((c) => ({
                      name: c.category,
                      value: c.minutes,
                      itemStyle: { color: c.color },
                      children: c.apps.map((a) => ({ name: a.app, value: a.minutes, change: a.change }))
                    }))
                  }
                ]
              }}
            />
          </section>
          <section className="wide">
            <h3>Where the time went</h3>
            <Chart
              height={360}
              option={{
                tooltip: { trigger: 'item', valueFormatter: (v: unknown) => hm(Number(v)) },
                series: [
                  {
                    type: 'sankey',
                    emphasis: { focus: 'adjacency' },
                    nodeAlign: 'left',
                    data: [...new Set(charts.sankey.flatMap((l) => [l.source, l.target]))].map((name) => ({
                      name,
                      itemStyle: { color: categories.find((c) => c.name === name)?.color ?? '#9AA3B2' }
                    })),
                    links: charts.sankey.map((l) => ({ source: l.source, target: l.target, value: l.minutes })),
                    lineStyle: { color: 'gradient', opacity: 0.35 }
                  }
                ]
              }}
            />
          </section>
        </div>
      )}
    </div>
  )
}

function HeatRow({ day, cells }: { day: string; cells: Array<{ category: string | null; color: string; occupancy: number }> }) {
  return (
    <>
      <span className="row-label">{parseKey(day).toLocaleDateString([], { weekday: 'short' })}</span>
      {cells.map((c, i) => (
        <span key={i} className="cell" title={c.category ?? undefined} style={{ background: c.category ? c.color : 'var(--line)', opacity: c.category ? 0.25 + 0.75 * c.occupancy : 0.3 }} />
      ))}
    </>
  )
}
