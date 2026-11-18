import { DEFAULT_BLOCKLIST } from './blocklist'
import { type Category, DEFAULT_CATEGORIES } from './categories'
import type { StandupDraft } from './daily'
import type { UiStyle } from './ui-style'

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
  /** Chrome incognito and Firefox private windows count as blocked (upstream "Hide private browsing windows"). */
  hidePrivateWindows: boolean
  /** Black out secrets found by OCR in frames before they go to the AI provider (upstream Privacy Shield, rules only). On by default; it costs a few seconds per frame. */
  hideSecrets: boolean
  /** Optional absolute paths of the agent CLIs on the host; empty means find them. */
  cliPaths: Record<CliName, string>
  /** Timeline categories; the last one is Idle. */
  categories: Category[]
  /** Replacements for the prompt's rules; empty means upstream's text. */
  promptOverrides: PromptOverrides
  /** Window theme; dark unless changed. "system" follows the desktop. */
  theme: Theme
  /** Visual theme: the flat "Modern" one (the default) or upstream Dayflow's look. */
  uiStyle: UiStyle
  /** Show app and site icons on cards (fetched from the sites themselves). */
  showAppIcons: boolean
  /** The first-run setup is done. */
  onboarded: boolean
  /** One-time notifications already shown, and the day each kind of provider problem was last reported. */
  notified: { firstCards: boolean; weeklyUnlock: boolean; problemDays: Record<string, string> }
  /** Automatic standup tries on one day (upstream allows 3 a day, across restarts). */
  standupAttempts: { day: string; count: number }
  /** What the chat model remembers about the user ("Profile: …\nStyle: …"), from its memory blocks. */
  chatMemory: string
  /** Open the goal pop-up by itself on the first visit after 4 AM (upstream "Show daily goal popups"). */
  showDailyGoalPopups: boolean
  /** AI tools (CLI, MCP) may change categories, activities and goals through the running app. Off by default. */
  allowEdits: boolean
  /** Windows and macOS: download updates in the background and install them on the next quit. On by default. */
  autoInstallUpdates: boolean
  /** Ask GitHub Releases for new versions (installer builds only); the one request besides the AI provider. */
  checkForUpdates: boolean
}

/** The AI tools Settings → MCP / CLI connects: the agent CLIs, Claude Desktop (config file) and the editors (install links). */
export type AgentClient = CliName | 'claude-desktop' | 'cursor' | 'vscode'

/**
 * Whether a client has the "dayflow-electron" MCP server; "manual" when the app cannot
 * reach the client and shows what to run or paste instead; "openedInstaller"
 * after an install link opened (the client finishes in its own dialog).
 */
export type AgentClientState =
  | { state: 'connected' | 'available' | 'openedInstaller' }
  | { state: 'notFound' | 'failed'; message: string }
  | { state: 'manual'; message: string; command: string }

/** How AI tools and terminals reach the CLI, for the "MCP / CLI" settings. */
export interface AgentAccessInfo {
  /** The command line that starts the CLI (append "mcp" for the MCP server). */
  command: string
  /** Paste into a terminal to install `dayflow-electron` into ~/.local/bin, or remove it; null on Windows. */
  terminal: { install: string; remove: string } | null
  /** JSON for MCP clients without a registration command. */
  configSnippet: string
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
  // Upstream records at 1080p; 720p keeps requests and local models faster.
  captureHeight: 720,
  storageLimitGb: 10,
  launchAtLogin: false,
  blockedApps: [...DEFAULT_BLOCKLIST],
  hidePrivateWindows: true,
  hideSecrets: true,
  cliPaths: { claude: '', codex: '' },
  categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
  promptOverrides: { title: '', summary: '', detailedSummary: '' },
  theme: 'dark',
  uiStyle: 'modern',
  showAppIcons: false,
  showDailyGoalPopups: true,
  onboarded: false,
  notified: { firstCards: false, weeklyUnlock: false, problemDays: {} },
  standupAttempts: { day: '', count: 0 },
  chatMemory: '',
  allowEdits: false,
  autoInstallUpdates: true,
  checkForUpdates: true
}

export const THEMES = ['dark', 'light', 'system'] as const
export type Theme = (typeof THEMES)[number]

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

// ---------------------------------------------------------------- chat

/** Upstream's roles; "toolCall" rows record what the assistant looked up. */
export type ChatRole = 'user' | 'assistant' | 'toolCall'

export interface ChatConversation {
  id: string
  title: string
  provider: string
  createdAt: number
  updatedAt: number
}

export interface ChatStoredMessage {
  id: string
  role: ChatRole
  content: string
  createdAt: number
}

/** An answered chat message. */
export interface ChatReply {
  conversationId: string
  text: string
  suggestions: string[]
  model: string
}

/** Progress of a chat answer, streamed to the window. "reset" drops what streamed so far (a fallback provider takes over). */
export type ChatEvent =
  | { type: 'reset' }
  | { type: 'text'; delta: string }
  | { type: 'tool-start'; command: string }
  | { type: 'tool-end'; summary: string; failed: boolean }
