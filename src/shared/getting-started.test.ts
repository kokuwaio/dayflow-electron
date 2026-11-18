import { describe, expect, it } from 'vitest'
import { accessProgress } from './daily'
import {
  CHECKLIST_LIFETIME_SEC,
  INACTIVE_GUIDE,
  beginGuide,
  checklistCount,
  checklistItems,
  checklistVisible,
  markCardOpened,
  replayGuide,
  sanitizeGuide
} from './getting-started'

const at = (y: number, mo: number, d: number, h = 9, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime() / 1000
const started = at(2026, 11, 17)

describe('the first-day guide', () => {
  it('starts after onboarding with the tour pending and nothing ticked', () => {
    expect(beginGuide(started)).toEqual({ active: true, startedAt: started, tourPending: true, openedCard: false, dismissed: false, collapsed: false })
  })

  it('stays off for installs that never finished onboarding after this feature, and repairs broken values', () => {
    expect(sanitizeGuide(undefined)).toEqual(INACTIVE_GUIDE)
    expect(sanitizeGuide({ active: 'yes', startedAt: -5, openedCard: true })).toEqual({ ...INACTIVE_GUIDE, openedCard: true })
    expect(sanitizeGuide({ ...beginGuide(started), collapsed: true })).toEqual({ ...beginGuide(started), collapsed: true })
  })

  it('shows the checklist for a week, unless dismissed', () => {
    const guide = beginGuide(started)
    expect(checklistVisible(guide, started + 3600)).toBe(true)
    // Monday 9:00 to the next Monday 9:00 is exactly the lifetime: still shown; a minute later it retires.
    expect(checklistVisible(guide, started + CHECKLIST_LIFETIME_SEC)).toBe(true)
    expect(checklistVisible(guide, at(2026, 11, 24, 9, 1))).toBe(false)
    expect(checklistVisible({ ...guide, dismissed: true }, started + 60)).toBe(false)
    expect(checklistVisible(INACTIVE_GUIDE, started)).toBe(false)
  })

  it('replays with a fresh week and the tour, keeping what was already done', () => {
    const old = { ...beginGuide(started), tourPending: false, openedCard: true, dismissed: true, collapsed: true }
    const later = at(2026, 12, 1)
    expect(replayGuide(old, later)).toEqual({ active: true, startedAt: later, tourPending: true, openedCard: true, dismissed: false, collapsed: false })
    // Existing users who never had the guide get it on replay.
    expect(replayGuide(INACTIVE_GUIDE, later)).toMatchObject({ active: true, startedAt: later, tourPending: true })
  })

  it('ticks "open a card" once, and only while the guide runs', () => {
    const guide = beginGuide(started)
    const opened = markCardOpened(guide)
    expect(opened.openedCard).toBe(true)
    expect(markCardOpened(opened)).toBe(opened)
    expect(markCardOpened(INACTIVE_GUIDE)).toBe(INACTIVE_GUIDE)
  })
})

describe('checklist items', () => {
  const fresh = { hasCards: false, recording: true, openedCard: false, access: accessProgress(0) }

  it('right after onboarding: first cards are on their way, the rest is to do', () => {
    const items = checklistItems(fresh)
    expect(items.map((i) => [i.id, i.status])).toEqual([
      ['firstCards', 'working'],
      ['openCard', 'todo'],
      ['daily', 'progress'],
      ['chat', 'progress']
    ])
    expect(items[0]!.subtitle).toBe('Usually ready about 15 minutes after recording starts')
    expect(items[2]!.subtitle).toBe('0h / 5h recorded')
    expect(items[2]!.progress).toBe(0)
  })

  it('while paused, says recording has to be on', () => {
    const [first] = checklistItems({ ...fresh, recording: false })
    expect(first).toMatchObject({ status: 'todo', subtitle: 'Recording is paused. Turn it on to get your first cards.' })
  })

  it('after 9 batches (2h 15m): cards are there, Daily is 45% and Chat 22.5% of the way', () => {
    const items = checklistItems({ ...fresh, hasCards: true, openedCard: true, access: accessProgress(9) })
    expect(items.map((i) => i.status)).toEqual(['done', 'done', 'progress', 'progress'])
    expect(items[0]!.subtitle).toBe('Dayflow Electron is turning your screen time into cards')
    expect(items[2]).toMatchObject({ subtitle: '2h 15m / 5h recorded', progress: 0.45, open: null })
    expect(items[3]).toMatchObject({ progress: 0.225 })
  })

  it('after 20 batches (5 h): Daily can be opened', () => {
    const daily = checklistItems({ ...fresh, hasCards: true, access: accessProgress(20) })[2]!
    expect(daily).toMatchObject({ status: 'done', subtitle: 'Ready to open', open: 'daily' })
  })

  it('counts the done steps for the header and the progress bar', () => {
    expect(checklistCount(fresh)).toEqual({ done: 0, total: 4 })
    expect(checklistCount({ ...fresh, hasCards: true, openedCard: true, access: accessProgress(20) })).toEqual({ done: 3, total: 4 })
  })

  it('collapses into one "all set" row once everything is done', () => {
    const items = checklistItems({ ...fresh, hasCards: true, openedCard: true, access: accessProgress(40) })
    expect(items).toEqual([
      {
        id: 'allDone',
        status: 'done',
        title: "You're all set",
        subtitle: "You've unlocked everything Dayflow Electron does. Enjoy your timeline.",
        progress: 1,
        open: null
      }
    ])
  })
})
