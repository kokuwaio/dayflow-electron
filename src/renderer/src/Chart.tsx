import { useEffect, useRef } from 'react'
import { BarChart, PieChart, SankeyChart, TreemapChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TitleComponent, TooltipComponent } from 'echarts/components'
import * as echarts from 'echarts/core'
import { SVGRenderer } from 'echarts/renderers'

// Only the charts the Weekly tab uses, so the bundle stays small.
echarts.use([PieChart, BarChart, TreemapChart, SankeyChart, GridComponent, LegendComponent, TitleComponent, TooltipComponent, SVGRenderer])

type Option = Parameters<echarts.ECharts['setOption']>[0]

/** An ECharts chart that follows its option and its container's size. */
export function Chart({ option, height = 280 }: { option: Option; height?: number }) {
  const el = useRef<HTMLDivElement>(null)
  const chart = useRef<echarts.ECharts | null>(null)
  useEffect(() => {
    if (!el.current) return
    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches
    chart.current = echarts.init(el.current, dark ? 'dark' : undefined, { renderer: 'svg' })
    const resize = new ResizeObserver(() => chart.current?.resize())
    resize.observe(el.current)
    return () => {
      resize.disconnect()
      chart.current?.dispose()
    }
  }, [])
  useEffect(() => {
    chart.current?.setOption({ backgroundColor: 'transparent', ...(option as object) }, true)
  }, [option])
  return <div ref={el} style={{ height }} />
}
