import { useEffect, useRef, useState } from 'react'
import { BarChart, HeatmapChart, LineChart, PieChart, SankeyChart, TreemapChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TitleComponent, TooltipComponent, VisualMapComponent } from 'echarts/components'
import * as echarts from 'echarts/core'
import { SVGRenderer } from 'echarts/renderers'

// Only the charts the Weekly tab and chat answers use, so the bundle stays small.
echarts.use([
  PieChart,
  BarChart,
  LineChart,
  HeatmapChart,
  TreemapChart,
  SankeyChart,
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
  VisualMapComponent,
  SVGRenderer
])

type Option = Parameters<echarts.ECharts['setOption']>[0]

/** An ECharts chart that follows its option, its container's size, the colour scheme and the visual theme. */
export function Chart({ option, height = 280 }: { option: Option; height?: number }) {
  const el = useRef<HTMLDivElement>(null)
  const chart = useRef<echarts.ECharts | null>(null)
  const dark = useDark()
  const uiStyle = useUiStyle()
  useEffect(() => {
    if (!el.current) return
    // Dayflow keeps ECharts' own light and dark themes; Modern takes its colours from the CSS tokens.
    const theme = uiStyle === 'modern' ? tokenTheme() : dark ? 'dark' : undefined
    chart.current = echarts.init(el.current, theme, { renderer: 'svg' })
    const resize = new ResizeObserver(() => chart.current?.resize())
    resize.observe(el.current)
    return () => {
      resize.disconnect()
      chart.current?.dispose()
    }
  }, [dark, uiStyle])
  useEffect(() => {
    chart.current?.setOption({ backgroundColor: 'transparent', textStyle: { fontFamily: cssToken('--font-ui') }, ...(option as object) }, true)
  }, [option, dark, uiStyle])
  return <div ref={el} style={{ height }} />
}

/** A design token from styles.css, as the root element resolves it now. */
export function cssToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

/** ECharts colours for text, axes, grid lines and tooltips, from the --chart-* tokens. */
function tokenTheme(): object {
  const text = cssToken('--chart-text')
  const muted = cssToken('--chart-muted')
  const axis = { color: cssToken('--chart-axis') }
  const grid = cssToken('--chart-grid')
  const axisStyle = {
    axisLine: { lineStyle: axis },
    axisTick: { lineStyle: axis },
    axisLabel: { color: muted },
    splitLine: { lineStyle: { color: [grid] } },
    splitArea: { areaStyle: { color: ['transparent', grid] } }
  }
  return {
    textStyle: { color: text },
    title: { textStyle: { color: text }, subtextStyle: { color: muted } },
    legend: { textStyle: { color: text } },
    tooltip: { backgroundColor: cssToken('--chart-tooltip'), borderColor: cssToken('--chart-axis'), textStyle: { color: text } },
    categoryAxis: axisStyle,
    valueAxis: axisStyle,
    timeAxis: axisStyle,
    logAxis: axisStyle
  }
}

/** The visual theme on the root element (`data-ui-style`), while it changes. */
function useUiStyle(): string {
  const read = () => document.documentElement.dataset.uiStyle ?? 'dayflow'
  const [style, setStyle] = useState(read)
  useEffect(() => {
    const observer = new MutationObserver(() => setStyle(read()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-ui-style'] })
    return () => observer.disconnect()
  }, [])
  return style
}

/** Follows the system light/dark setting while the window is open. */
export function useDark(): boolean {
  const [dark, setDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (e: MediaQueryListEvent) => setDark(e.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return dark
}
