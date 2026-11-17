// Types shared by the main process and the renderer.

export interface Distraction {
  startTime: string
  endTime: string
  title: string
  summary: string
}

export interface AppSites {
  primary?: string
  secondary?: string
}

export interface TimelineCard {
  id: number
  batchId: number | null
  /** Clock labels like "2:30 PM". */
  startTime: string
  endTime: string
  /** Unix seconds. */
  start: number
  end: number
  /** "YYYY-MM-DD", 4 AM boundary. */
  day: string
  title: string
  summary: string
  category: string
  subcategory: string
  detailedSummary: string
  distractions: Distraction[]
  appSites: AppSites
}

export type ProviderKind = 'anthropic' | 'gemini' | 'openai'

export interface Settings {
  provider: ProviderKind
  /** Used when the primary provider fails; null for none. */
  fallbackProvider: ProviderKind | null
  models: Record<ProviderKind, string>
  /** OpenAI-compatible endpoint, e.g. http://localhost:11434/v1 for Ollama. */
  openaiBaseUrl: string
  /** Language for card text, e.g. "German"; empty for English. */
  outputLanguage: string
  captureIntervalSec: number
  captureHeight: 720 | 1080
  storageLimitGb: number
  launchAtLogin: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  provider: 'anthropic',
  fallbackProvider: null,
  models: { anthropic: 'claude-opus-5-5', gemini: 'gemini-4-hydrogen', openai: 'gpt-5.1' },
  openaiBaseUrl: 'https://api.openai.com/v1',
  outputLanguage: '',
  captureIntervalSec: 10,
  captureHeight: 1080,
  storageLimitGb: 10,
  launchAtLogin: false
}

export const CAPTURE_INTERVALS = [1, 5, 10, 20, 30, 60] as const

export type RecorderState = 'recording' | 'paused' | 'locked' | 'sleeping' | 'backoff' | 'stopped'

export interface AppStatus {
  platform: string
  recorder: { state: RecorderState; until: number | null; lastError: string | null }
  analysis: { busy: boolean; lastRunAt: number | null; lastError: string | null }
  keys: Record<ProviderKind, boolean>
  framesBytes: number
}
