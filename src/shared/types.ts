import { DEFAULT_BLOCKLIST } from './blocklist'
import { type Category, DEFAULT_CATEGORIES } from './categories'
import type { StandupDraft } from './daily'

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

/** A saved standup (upstream DailyStandupDraft plus how it was made). */
export interface StandupEntry {
  draft: StandupDraft
  /** The day it summarizes. */
  sourceDay: string | null
  provider: string
  model: string
  /** Unix seconds; 0 for a placeholder. */
  generatedAt: number
}

/** A thumbs up/down on a time range (upstream timeline_review_ratings). */
export interface Rating {
  start: number
  end: number
  rating: 'up' | 'down'
  feedback: string | null
}

/** What the user may change on a card. */
export interface CardEdit {
  title?: string
  category?: string
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

export type ProviderKind = 'anthropic' | 'gemini' | 'openai' | 'claude-cli' | 'codex-cli'

/** The agent CLIs that can act as providers. */
export type CliName = 'claude' | 'codex'

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
  /** Blocklist rules: app IDs, or "title:<text>" for window titles. */
  blockedApps: string[]
  /** Optional absolute paths of the agent CLIs on the host; empty means find them. */
  cliPaths: Record<CliName, string>
  /** Timeline categories; the last one is Idle. */
  categories: Category[]
  /** Replacements for the prompt's rules; empty means upstream's text. */
  promptOverrides: PromptOverrides
  /** Show app and site icons on cards (fetched from the sites themselves). */
  showAppIcons: boolean
  /** The first-run setup is done. */
  onboarded: boolean
  /** One-time notifications already shown, and the day each kind of provider problem was last reported. */
  notified: { firstCards: boolean; weeklyUnlock: boolean; problemDays: Record<string, string> }
  /** Automatic standup tries on one day (upstream allows 3 a day, across restarts). */
  standupAttempts: { day: string; count: number }
}

/** The window's tabs; notifications and the tray open one of them. */
export type Tab = 'timeline' | 'daily' | 'weekly' | 'chat' | 'settings'

export interface PromptOverrides {
  title: string
  summary: string
  detailedSummary: string
}

export const DEFAULT_SETTINGS: Settings = {
  provider: 'anthropic',
  fallbackProvider: null,
  models: { anthropic: 'claude-opus-5-5', gemini: 'gemini-4-hydrogen', openai: 'gpt-5.1', 'claude-cli': 'haiku', 'codex-cli': 'gpt-6-luna' },
  openaiBaseUrl: 'https://api.openai.com/v1',
  outputLanguage: '',
  captureIntervalSec: 10,
  captureHeight: 1080,
  storageLimitGb: 10,
  launchAtLogin: false,
  blockedApps: [...DEFAULT_BLOCKLIST],
  cliPaths: { claude: '', codex: '' },
  categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
  promptOverrides: { title: '', summary: '', detailedSummary: '' },
  showAppIcons: false,
  onboarded: false,
  notified: { firstCards: false, weeklyUnlock: false, problemDays: {} },
  standupAttempts: { day: '', count: 0 }
}

export const CAPTURE_INTERVALS = [1, 5, 10, 20, 30, 60] as const

export type RecorderState = 'recording' | 'paused' | 'locked' | 'sleeping' | 'backoff' | 'stopped'

export interface AppStatus {
  platform: string
  recorder: {
    state: RecorderState
    until: number | null
    lastError: string | null
    /** The blocklist rule that currently stops frames from being saved. */
    blockedBy: string | null
    windowDetection: 'ok' | 'unavailable' | 'starting'
    windowDetectionError: string | null
  }
  analysis: { busy: boolean; lastRunAt: number | null; lastError: string | null }
  keys: Record<ProviderKind, boolean>
  framesBytes: number
}
