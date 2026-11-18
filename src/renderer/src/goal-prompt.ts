// When the daily goal pop-up opens by itself, after upstream Dayflow
// (Views/UI/MainView/Lifecycle.swift, requestDailyGoalPromptIfNeeded): the app
// checks at start, when its window gets focus and every minute (the day
// changes at 4 AM), and then switches to today's timeline to show it. The
// rules are goalPromptAction in src/shared/goal-flow.ts.

import { todayKey } from '@shared/day'
import { goalPromptAction } from '@shared/goal-flow'

/** Days the pop-up was handled and yesterday's review shown, kept per device like upstream's UserDefaults. */
export const HANDLED_KEY = 'dayGoalPromptHandledTimelineDay'
export const REVIEW_SHOWN_KEY = 'dayGoalReviewShownTimelineDay'

export const readDay = (key: string): string | null => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
export const writeDay = (key: string, day: string) => {
  try {
    localStorage.setItem(key, day)
  } catch {
    // Without storage the pop-up may open once more; nothing else depends on it.
  }
}

/** Today's day key when the pop-up should open now, else null; marks the day handled when it needs no pop-up or gets one. */
export async function dueGoalPrompt(): Promise<string | null> {
  const today = todayKey()
  if (readDay(HANDLED_KEY) === today) return null
  const [settings, context] = await Promise.all([window.dayflow.getSettings(), window.dayflow.getGoalContext(today)])
  const action = goalPromptAction({ enabled: settings.showDailyGoalPopups, handledDay: readDay(HANDLED_KEY), today, ...context })
  if (action !== 'none') writeDay(HANDLED_KEY, today)
  return action === 'open' ? today : null
}
