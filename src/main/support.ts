// Gathers the debug report behind Settings → Other → Support → "Copy debug
// logs" (upstream DebugLogSnapshot.makeCurrent). The text itself comes from
// formatDebugReport in src/shared/debug-report.ts.

import { release, type } from 'node:os'
import { DEBUG_REPORT_LIMITS, type DebugReportInput, formatDebugReport } from '../shared/debug-report'
import type { AppStatus, Settings } from '../shared/types'
import type { Store } from './db/store'
import type { LogFile } from './log-file'

export interface DebugReportSources {
  store: Store
  logFile: LogFile
  settings: Settings
  status: Pick<AppStatus, 'platform' | 'recorder' | 'analysis'>
  version: string
  /** "flatpak", "packaged" or "development". */
  build: string
  language: string
  home: string
  env?: NodeJS.ProcessEnv
  now?: Date
}

/** What the app knows about itself, for the report's App section. Nothing personal: no paths, keys or URLs. */
export function aboutApp(s: DebugReportSources): DebugReportInput['about'] {
  const env = s.env ?? process.env
  const { settings, status } = s
  const backlog = s.store.captureStatus()
  const provider = (kind: string | null) => (kind ? `${kind} (${settings.models[kind as keyof Settings['models']] || 'default model'})` : null)
  const { recorder } = status
  return [
    ['Version', s.version],
    ['Platform', `${process.platform} ${process.arch}, ${type()} ${release()}`],
    ['Runtime', `Electron ${process.versions.electron}, Chrome ${process.versions.chrome}, Node ${process.versions.node}`],
    ['Build', s.build],
    ['Desktop', env.XDG_CURRENT_DESKTOP ? `${env.XDG_CURRENT_DESKTOP} (${env.XDG_SESSION_TYPE || 'unknown session'})` : null],
    ['Capture backend', status.platform],
    ['Language', `app ${s.language}, cards ${settings.outputLanguage || 'English'}`],
    ['Provider', provider(settings.provider)],
    ['Fallback provider', provider(settings.fallbackProvider)],
    ['Capture', `every ${settings.captureIntervalSec} s at ${settings.captureHeight}p, hide secrets ${settings.hideSecrets ? 'on' : 'off'}`],
    ['Recorder', `${recorder.state}, window detection ${recorder.windowDetection}`],
    ['Recorder error', recorder.lastError],
    ['Window detection error', recorder.windowDetectionError],
    ['Analysis', `${backlog.pendingBatches} pending, ${backlog.failedBatches} failed batches${status.analysis.busy ? ', running' : ''}`],
    ['Last analysis error', status.analysis.lastError]
  ]
}

export function debugReport(s: DebugReportSources): string {
  const snapshot = s.store.debugSnapshot(DEBUG_REPORT_LIMITS)
  return formatDebugReport({
    createdAt: s.now ?? new Date(),
    about: aboutApp(s),
    ...snapshot,
    logLines: s.logFile.tail(DEBUG_REPORT_LIMITS.logLines),
    home: s.home
  })
}
