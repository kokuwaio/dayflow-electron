// The daily goal pop-up's rules, after upstream Dayflow
// (Views/UI/MainView/Lifecycle.swift, Views/Components/DayGoalFlowView.swift,
// DayGoalDurationPicker.swift, DaySummaryStats.swift).

import { categoryKey } from './categories'
import type { CategoryTotal, GoalPlan } from './day-summary'
import { t } from './i18n'

/** Days with cards (before today) needed before the pop-up opens by itself (upstream FeatureAccessRequirements). */
export const GOAL_PROMPT_MIN_ACTIVE_DAYS = 3
/** Skipped days in a row after which it stops opening by itself. */
export const GOAL_PROMPT_MAX_SKIPS = 5
/** The duration wheels stop at 12 hours. */
export const GOAL_MAX_MINUTES = 720

export interface GoalPromptCheck {
  /** Settings → "Show daily goal popups". */
  enabled: boolean
  /** The day the pop-up was last opened or found unnecessary. */
  handledDay: string | null
  today: string
  hasOwnPlan: boolean
  activeDays: number
  skipStreak: number
}

/**
 * Whether to open the pop-up now: "handled" means today needs none (goals are
 * set) and should not be checked again; "none" checks again later.
 */
export function goalPromptAction(c: GoalPromptCheck): 'open' | 'handled' | 'none' {
  if (!c.enabled || c.handledDay === c.today) return 'none'
  if (c.hasOwnPlan) return 'handled'
  if (c.activeDays < GOAL_PROMPT_MIN_ACTIVE_DAYS || c.skipStreak >= GOAL_PROMPT_MAX_SKIPS) return 'none'
  return 'open'
}

/** Yesterday's review comes first, once a day, when yesterday had confirmed goals. */
export function goalFlowStart(yesterday: GoalPlan | null, reviewShownDay: string | null, today: string): 'review' | 'setup' {
  return yesterday && !yesterday.skipped && reviewShownDay !== today ? 'review' : 'setup'
}


/** Clicking a category chip: untracked → focus → distraction → untracked. */
export function cycleCategory(plan: GoalPlan, name: string): GoalPlan {
  const inFocus = plan.focusCategories.some((n) => categoryKey(n) === categoryKey(name))
  const inDistraction = plan.distractionCategories.some((n) => categoryKey(n) === categoryKey(name))
  const without = (list: string[]) => list.filter((n) => categoryKey(n) !== categoryKey(name))
  if (inFocus) return { ...plan, focusCategories: without(plan.focusCategories), distractionCategories: [...without(plan.distractionCategories), name] }
  if (inDistraction) return { ...plan, distractionCategories: without(plan.distractionCategories) }
  return { ...plan, focusCategories: [...plan.focusCategories, name] }
}

/** Moves a category into one panel (a drop), out of the other. */
export function assignCategory(plan: GoalPlan, name: string, kind: 'focus' | 'distraction' | null): GoalPlan {
  const without = (list: string[]) => list.filter((n) => categoryKey(n) !== categoryKey(name))
  return {
    ...plan,
    focusCategories: kind === 'focus' ? [...without(plan.focusCategories), name] : without(plan.focusCategories),
    distractionCategories: kind === 'distraction' ? [...without(plan.distractionCategories), name] : without(plan.distractionCategories)
  }
}

/** Minutes per category name → the minutes of the given categories ("Yesterday's focus"). */
export function referenceMinutes(minutes: Record<string, number>, names: string[]): number {
  const wanted = new Set(names.map(categoryKey))
  return Object.entries(minutes).reduce((sum, [name, m]) => sum + (wanted.has(categoryKey(name)) ? m : 0), 0)
}

/** What the pop-up needs from the main process (IPC goals:context). */
export interface GoalContext {
  activeDays: number
  skipStreak: number
  hasOwnPlan: boolean
  /** Yesterday's own, confirmed or skipped plan and how it went; null without one. */
  yesterday: { plan: GoalPlan; focusMinutes: number; distractedMinutes: number; focusTotals: CategoryTotal[] } | null
  /** Minutes per category yesterday. */
  yesterdayMinutes: Record<string, number>
  /** Minutes per category over the 7 days before (divide by 7 for upstream's weekly average). */
  weekMinutes: Record<string, number>
}

/** Minutes per category from a day's totals. */
export const minutesByCategory = (totals: CategoryTotal[]): Record<string, number> => Object.fromEntries(totals.map((t) => [t.category, t.minutes]))

/** "2 hours, 30 minutes", like upstream's spelled-out durations. */
export function spelledDuration(total: number): string {
  const h = Math.floor(total / 60)
  const m = Math.floor(total % 60)
  const hours = t('format.spelledHours', { count: h })
  const minutes = t('format.spelledMinutes', { count: m })
  if (h && m) return t('format.spelledHoursMinutes', { hours, minutes })
  return h ? hours : minutes
}

/** The wheels' total: hours 0-12, minutes 0-55 in steps of 5, at most 12 hours. */
export function wheelMinutes(hours: number, minutes: number): number {
  const h = Math.max(0, Math.min(12, Math.round(hours)))
  const m = Math.max(0, Math.min(55, Math.round(minutes / 5) * 5))
  return Math.min(GOAL_MAX_MINUTES, h * 60 + m)
}
