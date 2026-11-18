// The first-day guide's state in the main process (upstream
// Views/UI/GettingStarted/GettingStarted.swift keeps it in UserDefaults):
// the window reads it, ticks "Open a card", finishes the tour, collapses or
// dismisses the checklist, and replays it from Settings → Other.

import type { IpcMain } from 'electron'
import { type GettingStarted, markCardOpened, replayGuide, sanitizeGuide } from '../shared/getting-started'
import type { Settings } from '../shared/types'

/** What the window may change; the rest (active, startedAt) only onboarding and replay set. */
export type GuidePatch = Partial<Pick<GettingStarted, 'tourPending' | 'openedCard' | 'dismissed' | 'collapsed'>>

/** Applies a patch from the window: booleans only, and "Open a card" only ticks while the guide runs. */
export function applyGuidePatch(guide: GettingStarted, patch: unknown): GettingStarted {
  const p = (patch && typeof patch === 'object' ? patch : {}) as Record<string, unknown>
  let next = guide
  for (const key of ['tourPending', 'dismissed', 'collapsed'] as const) {
    if (typeof p[key] === 'boolean' && p[key] !== next[key]) next = { ...next, [key]: p[key] }
  }
  if (p.openedCard === true) next = markCardOpened(next)
  return sanitizeGuide(next)
}

export function registerGettingStarted(opts: {
  ipcMain: IpcMain
  settings: { get(): Settings; save(next: Partial<Settings>): Promise<Settings> }
  /** Cards the model wrote are on the timeline ("First cards" ticks from this). */
  hasCards: () => boolean
  /** Tells the window the guide changed. */
  changed: (guide: GettingStarted) => void
}): void {
  const save = async (guide: GettingStarted) => {
    if (JSON.stringify(guide) === JSON.stringify(opts.settings.get().gettingStarted)) return guide
    const saved = (await opts.settings.save({ gettingStarted: guide })).gettingStarted
    opts.changed(saved)
    return saved
  }
  opts.ipcMain.handle('gettingStarted:get', () => ({ guide: opts.settings.get().gettingStarted, hasCards: opts.hasCards() }))
  opts.ipcMain.handle('gettingStarted:update', (_e, patch: unknown) => save(applyGuidePatch(opts.settings.get().gettingStarted, patch)))
  opts.ipcMain.handle('gettingStarted:replay', () => save(replayGuide(opts.settings.get().gettingStarted, Math.floor(Date.now() / 1000))))
}
