// The timeline header's calendar (upstream Views/UI/MainView/TimelineCalendarPopover.swift,
// Layout+TimelineHeader.swift): a Monday-first month grid; future days are disabled.

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { type Month, monthGrid, shiftMonth } from '@shared/calendar'
import { parseKey, shiftDay } from '@shared/day'
import { dateLabel, monthLabel } from '@shared/i18n'

/** Monday to Sunday as one letter (or sign) in the app language; 2024-01-01 was a Monday. */
const weekdays = () => Array.from({ length: 7 }, (_, i) => dateLabel(shiftDay('2024-01-01', i), { weekday: 'narrow' }))

export function CalendarPopover(props: { day: string; today: string; mode: 'day' | 'week'; onPick: (day: string) => void; onClose: () => void }) {
  const { t } = useTranslation()
  const d = parseKey(props.day)
  const [month, setMonth] = useState<Month>({ year: d.getFullYear(), month: d.getMonth() })
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      // The pill toggles the popover itself.
      const target = e.target as Element
      if (!ref.current?.contains(target) && !target.closest('.cal-pill')) props.onClose()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose()
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [props])

  const weeks = monthGrid(month.year, month.month)
  const inMonth = (key: string) => parseKey(key).getMonth() === month.month
  const title = monthLabel(month.year, month.month)

  return (
    <div className="cal-popover" ref={ref} role="dialog" aria-label={t('timeline.pickDate')}>
      <div className="cal-head">
        <span>{title}</span>
        <button aria-label={t('calendar.previousMonth')} onClick={() => setMonth(shiftMonth(month, -1))}>
          <ChevronLeft size={16} />
        </button>
        <button aria-label={t('calendar.nextMonth')} onClick={() => setMonth(shiftMonth(month, 1))}>
          <ChevronRight size={16} />
        </button>
      </div>
      <div className="cal-weekdays" aria-hidden="true">
        {weekdays().map((w, i) => (
          <span key={i}>{w}</span>
        ))}
      </div>
      <div className="cal-grid" role="grid">
        {weeks.map((week) => {
          const selectedWeek = props.mode === 'week' && week.includes(props.day)
          return (
            <div key={week[0]} className={`cal-week ${selectedWeek ? 'selected' : ''}`} role="row">
              {week.map((key) => {
                const future = key > props.today
                const selected = props.mode === 'day' && key === props.day
                return (
                  <button
                    key={key}
                    role="gridcell"
                    className={`${inMonth(key) && !future ? '' : 'dim'} ${selected ? 'selected' : ''}`}
                    disabled={future}
                    aria-selected={selected || selectedWeek}
                    aria-label={dateLabel(key, { weekday: 'long', month: 'long', day: 'numeric' })}
                    onClick={() => props.onPick(key)}
                  >
                    {parseKey(key).getDate()}
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
