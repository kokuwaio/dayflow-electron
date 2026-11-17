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

/** An ECharts chart that follows its option, its container's size and the colour scheme. */
export function Chart({ option, height = 280 }: { option: Option; height?: number }) {
  const el = useRef<HTMLDivElement>(null)
  const chart = useRef<echarts.ECharts | null>(null)
  const dark = useDark()
  useEffect(() => {
    if (!el.current) return
    chart.current = echarts.init(el.current, dark ? 'dark' : undefined, { renderer: 'svg' })
    const resize = new ResizeObserver(() => chart.current?.resize())
    resize.observe(el.current)
    return () => {
      resize.disconnect()
      chart.current?.dispose()
    }
  }, [dark])
  useEffect(() => {
    chart.current?.setOption(
      { backgroundColor: 'transparent', textStyle: { fontFamily: "'Figtree Variable', system-ui, sans-serif" }, ...(option as object) },
      true
    )
  }, [option, dark])
  return <div ref={el} style={{ height }} />
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
