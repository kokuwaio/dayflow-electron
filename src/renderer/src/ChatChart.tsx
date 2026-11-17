import type { ChatChart as Spec } from '@shared/chat-content'
import { escapeHtml } from '@shared/html'
import { Chart, cssToken } from './Chart'

/** Upstream's chat chart palette (Views/UI/ChatCharts.swift); the first colour is the theme's (--chart-1). */
const PALETTE = ['#F96E00', '#1F6FEB', '#2E7D32', '#8E24AA', '#00897B']
const color = (c: string | null, i: number) => c ?? ((i % PALETTE.length === 0 && cssToken('--chart-1')) || PALETTE[i % PALETTE.length]!)
const grid = { left: 8, right: 8, top: 8, bottom: 4, containLabel: true }

/** ECharts options for upstream's chart blocks (tooltip formatters return HTML, so labels are escaped): bar, line, stacked_bar, donut, heatmap and gantt. */
function option(spec: Spec): Record<string, unknown> {
  switch (spec.type) {
    case 'bar':
    case 'line':
      return {
        grid,
        tooltip: { trigger: 'axis' },
        xAxis: { type: 'category', data: spec.labels },
        yAxis: { type: 'value' },
        series: [{ type: spec.type, data: spec.values, itemStyle: { color: color(spec.color, 0) }, smooth: spec.type === 'line' }]
      }
    case 'stacked_bar':
      return {
        grid,
        tooltip: { trigger: 'axis' },
        legend: { bottom: 0, textStyle: { fontSize: 11 } },
        xAxis: { type: 'category', data: spec.categories },
        yAxis: { type: 'value' },
        series: spec.series.map((s, i) => ({ type: 'bar', name: s.name, stack: 'total', data: s.values, itemStyle: { color: color(s.color, i) } }))
      }
    case 'donut':
      return {
        tooltip: { trigger: 'item' },
        series: [
          {
            type: 'pie',
            radius: ['50%', '80%'],
            label: { fontSize: 11 },
            data: spec.labels.map((name, i) => ({ name, value: spec.values[i], itemStyle: { color: color(spec.colors[i] ?? null, i) } }))
          }
        ]
      }
    case 'heatmap': {
      const max = Math.max(...spec.values.flat(), 0)
      return {
        grid,
        tooltip: { position: 'top' },
        xAxis: { type: 'category', data: spec.xLabels, splitArea: { show: true } },
        yAxis: { type: 'category', data: spec.yLabels, splitArea: { show: true } },
        visualMap: { min: 0, max: max || 1, show: false, inRange: { color: [cssToken('--chart-heat-low') || '#FFF4E9', color(spec.color, 0)] } },
        series: [{ type: 'heatmap', data: spec.values.flatMap((row, y) => row.map((v, x) => [x, y, v])) }]
      }
    }
    case 'gantt': {
      // A horizontal stacked bar: an invisible bar up to the start, then the visible span.
      const labels = spec.items.map((i) => i.label)
      return {
        grid,
        tooltip: { trigger: 'item', formatter: (p: { dataIndex: number }) => `${escapeHtml(labels[p.dataIndex] ?? '')}: ${spec.items[p.dataIndex]!.start}–${spec.items[p.dataIndex]!.end}` },
        xAxis: { type: 'value', min: Math.min(...spec.items.map((i) => i.start)) },
        yAxis: { type: 'category', data: labels, inverse: true },
        series: [
          { type: 'bar', stack: 'gantt', silent: true, itemStyle: { color: 'transparent' }, data: spec.items.map((i) => i.start) },
          { type: 'bar', stack: 'gantt', data: spec.items.map((i, n) => ({ value: i.end - i.start, itemStyle: { color: color(i.color, n) } })) }
        ]
      }
    }
  }
}

export function ChatChart({ spec }: { spec: Spec }) {
  return (
    <figure className="chat-chart">
      <figcaption>{spec.title}</figcaption>
      <Chart option={option(spec) as never} height={180} />
    </figure>
  )
}
