// "Back to today" after time away from the window, after upstream Dayflow
// (App/InactivityMonitor.swift, MainView/Lifecycle.swift performIdleResetAndScroll):
// after 15 minutes without a key press, click or scroll in the window, the
// timeline goes back to today, closes the open card and scrolls to now. The
// window checks when it gets focus again and every minute while it has it.

export const IDLE_RESET_MS = 15 * 60_000

export interface InactivityState {
  /** Epoch ms of the last key press, click or scroll in the window. */
  lastInteractionAt: number
  /** Epoch ms of the last reset; null once the user was back. */
  lastResetAt: number | null
}

export const startInactivity = (now: number): InactivityState => ({ lastInteractionAt: now, lastResetAt: null })

export const interacted = (now: number): InactivityState => ({ lastInteractionAt: now, lastResetAt: null })

/** Whether to reset now; at most once per threshold while the user stays away. */
export function idleCheck(state: InactivityState, now: number, thresholdMs = IDLE_RESET_MS): { reset: boolean; state: InactivityState } {
  if (now - state.lastInteractionAt < thresholdMs) return { reset: false, state }
  if (state.lastResetAt !== null && now - state.lastResetAt < thresholdMs) return { reset: false, state }
  return { reset: true, state: { ...state, lastResetAt: now } }
}

/** How often to check while the window has focus: half the threshold, between 5 and 60 s. */
export const checkIntervalMs = (thresholdMs = IDLE_RESET_MS): number => Math.max(5_000, Math.min(60_000, thresholdMs / 2))
