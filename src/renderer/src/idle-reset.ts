// Watches whether the window is in use for "back to today" (rules in
// src/shared/inactivity.ts, after upstream App/InactivityMonitor.swift): key
// presses, clicks and scrolling count as use; the check runs when the window
// gets focus (before the click that focused it counts) and every minute while
// it has focus.

import { useEffect, useRef } from 'react'
import { checkIntervalMs, idleCheck, interacted, startInactivity } from '@shared/inactivity'

export function useIdleReset(onReset: () => void): void {
  const callback = useRef(onReset)
  callback.current = onReset
  useEffect(() => {
    let state = startInactivity(Date.now())
    const input = () => {
      state = interacted(Date.now())
    }
    const check = () => {
      const result = idleCheck(state, Date.now())
      state = result.state
      if (result.reset) callback.current()
    }
    const events = ['keydown', 'mousedown', 'wheel'] as const
    for (const e of events) window.addEventListener(e, input, { capture: true, passive: true })
    window.addEventListener('focus', check)
    const timer = setInterval(() => document.hasFocus() && check(), checkIntervalMs())
    return () => {
      for (const e of events) window.removeEventListener(e, input, { capture: true })
      window.removeEventListener('focus', check)
      clearInterval(timer)
    }
  }, [])
}
