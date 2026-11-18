import { describe, expect, it } from 'vitest'
import { monthGrid, shiftMonth } from './calendar'

describe('calendar popover grid (upstream TimelineCalendarPopover)', () => {
  it('fills whole Monday-first weeks with the neighbouring months', () => {
    const weeks = monthGrid(2026, 10) // November 2026 starts on a Sunday
    expect(weeks).toHaveLength(6)
    expect(weeks[0]).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01'])
    expect(weeks[5]![6]).toBe('2026-12-06')
    expect(monthGrid(2027, 1)).toHaveLength(4) // February 2027 starts on a Monday and has 28 days
  })

  it('moves between months across years', () => {
    expect(shiftMonth({ year: 2026, month: 11 }, 1)).toEqual({ year: 2027, month: 0 })
    expect(shiftMonth({ year: 2026, month: 0 }, -1)).toEqual({ year: 2025, month: 11 })
  })
})
