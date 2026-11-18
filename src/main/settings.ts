// Settings live in settings.json; API keys are encrypted with Electron's
// safeStorage (KWallet or Secret Service on Linux) in keys.json.

import { PROVIDER_KINDS } from '../shared/providers'
import { readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { safeStorage } from 'electron'
import { sanitizeCategories } from '../shared/categories'
import { CAPTURE_INTERVALS, DEFAULT_SETTINGS, type ProviderKind, type Settings, THEMES, type Theme } from '../shared/types'
import { sanitizeAppLanguage } from '../shared/languages'
import { sanitizeUiStyle } from '../shared/ui-style'
import { sanitizeGuide } from '../shared/getting-started'
import { sanitizeDailyProvider } from '../shared/daily-provider'
import { sanitizePauseMinutes } from '../shared/status'
import { snapStorageLimit } from '../shared/storage'

/** Providers that use an API key (the agent CLIs use the user's own login). */
const KEY_KINDS: ProviderKind[] = ['anthropic', 'gemini', 'openai']

/** Writes per file, one after another: saves share the temporary file and must not interleave. */
const writes = new Map<string, Promise<void>>()

/** Replaces `file` atomically; overlapping calls for one file run in call order. */
function writeAtomic(file: string, data: string): Promise<void> {
  const write = async () => {
    await mkdir(dirname(file), { recursive: true })
    const tmp = `${file}.tmp`
    await writeFile(tmp, data, { mode: 0o600 })
    await rename(tmp, file)
  }
  const next = (writes.get(file) ?? Promise.resolve()).then(write, write)
  writes.set(file, next)
  return next
}

function readJson(file: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return {}
  }
}

const overrideText = (v: unknown) => (typeof v === 'string' ? v.slice(0, 4000) : '')

/** Upstream's limit for the chat memory blob. */
export const CHAT_MEMORY_MAX = 10_000

/** Installs from before these notifications existed already have cards, so they skip the one-time ones. */
function sanitizeNotified(r: Partial<Settings>): Settings['notified'] {
  const existingInstall = r.notified === undefined && typeof r.provider === 'string'
  const days = r.notified?.problemDays && typeof r.notified.problemDays === 'object' ? r.notified.problemDays : {}
  return {
    firstCards: existingInstall || r.notified?.firstCards === true,
    weeklyUnlock: existingInstall || r.notified?.weeklyUnlock === true,
    problemDays: Object.fromEntries(Object.entries(days).filter((e): e is [string, string] => typeof e[1] === 'string'))
  }
}

/** Fills gaps with defaults and clamps values to what the app supports. */
export function sanitizeSettings(raw: Partial<Settings> | Record<string, unknown>): Settings {
  const r = raw as Partial<Settings>
  const models = { ...DEFAULT_SETTINGS.models }
  for (const k of PROVIDER_KINDS) {
    const m = r.models?.[k]
    if (typeof m === 'string' && m.trim()) models[k] = m.trim()
  }
  const provider = PROVIDER_KINDS.includes(r.provider as ProviderKind) ? (r.provider as ProviderKind) : DEFAULT_SETTINGS.provider
  const secondary = PROVIDER_KINDS.includes(r.fallbackProvider as ProviderKind) ? (r.fallbackProvider as ProviderKind) : null
  return {
    provider,
    fallbackProvider: secondary === provider ? null : secondary,
    models,
    openaiBaseUrl: typeof r.openaiBaseUrl === 'string' && r.openaiBaseUrl.trim() ? r.openaiBaseUrl.trim() : DEFAULT_SETTINGS.openaiBaseUrl,
    outputLanguage: typeof r.outputLanguage === 'string' ? r.outputLanguage.trim().slice(0, 40) : '',
    appLanguage: sanitizeAppLanguage(r.appLanguage),
    captureIntervalSec: (CAPTURE_INTERVALS as readonly number[]).includes(Number(r.captureIntervalSec))
      ? Number(r.captureIntervalSec)
      : DEFAULT_SETTINGS.captureIntervalSec,
    captureHeight: r.captureHeight === 1080 ? 1080 : 720,
    storageLimitGb: snapStorageLimit(r.storageLimitGb, DEFAULT_SETTINGS.storageLimitGb),
    launchAtLogin: r.launchAtLogin === true,
    pauseMinutes: sanitizePauseMinutes(r.pauseMinutes),
    cliPaths: {
      claude: typeof r.cliPaths?.claude === 'string' ? r.cliPaths.claude.trim() : '',
      codex: typeof r.cliPaths?.codex === 'string' ? r.cliPaths.codex.trim() : ''
    },
    categories: sanitizeCategories(r.categories ?? DEFAULT_SETTINGS.categories),
    promptOverrides: {
      title: overrideText(r.promptOverrides?.title),
      summary: overrideText(r.promptOverrides?.summary),
      detailedSummary: overrideText(r.promptOverrides?.detailedSummary)
    },
    showAppIcons: r.showAppIcons === true,
    showDailyGoalPopups: r.showDailyGoalPopups !== false,
    theme: (THEMES as readonly string[]).includes(r.theme as string) ? (r.theme as Theme) : DEFAULT_SETTINGS.theme,
    uiStyle: sanitizeUiStyle(r.uiStyle),
    notified: sanitizeNotified(r),
    standupAttempts: {
      day: typeof r.standupAttempts?.day === 'string' ? r.standupAttempts.day : '',
      count: Number.isInteger(r.standupAttempts?.count) ? Number(r.standupAttempts?.count) : 0
    },
    chatMemory: typeof r.chatMemory === 'string' ? r.chatMemory.slice(0, CHAT_MEMORY_MAX) : '',
    allowEdits: r.allowEdits === true,
    autoInstallUpdates: r.autoInstallUpdates !== false,
    checkForUpdates: r.checkForUpdates !== false,
    // Existing installs that never saw onboarding count as set up once a provider was chosen.
    onboarded: r.onboarded === true || (r.onboarded === undefined && typeof r.provider === 'string'),
    hidePrivateWindows: r.hidePrivateWindows !== false,
    hideSecrets: r.hideSecrets !== false,
    blockedApps: Array.isArray(r.blockedApps)
      ? r.blockedApps.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim()).slice(0, 100)
      : [...DEFAULT_SETTINGS.blockedApps],
    gettingStarted: sanitizeGuide(r.gettingStarted),
    dailyProvider: sanitizeDailyProvider(r.dailyProvider),
    dailyRecapUnseen: typeof r.dailyRecapUnseen === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.dailyRecapUnseen) ? r.dailyRecapUnseen : ''
  }
}

export class SettingsStore {
  private settings: Settings
  private keys: Partial<Record<ProviderKind, string>> = {}

  private constructor(
    private readonly settingsFile: string,
    private readonly keysFile: string
  ) {
    this.settings = sanitizeSettings(readJson(settingsFile))
  }

  static async open(settingsFile: string, keysFile: string): Promise<SettingsStore> {
    const store = new SettingsStore(settingsFile, keysFile)
    const stored = readJson(keysFile) as Record<string, string>
    for (const k of KEY_KINDS) {
      const encrypted = stored[k]
      if (!encrypted) continue
      try {
        store.keys[k] = (await safeStorage.decryptStringAsync(Buffer.from(encrypted, 'base64'))).result
      } catch {
        // The keyring changed or is locked; the user has to enter the key again.
      }
    }
    return store
  }

  get(): Settings {
    return structuredClone(this.settings)
  }

  async save(next: Partial<Settings>): Promise<Settings> {
    this.settings = sanitizeSettings({ ...this.settings, ...next, models: { ...this.settings.models, ...next.models } })
    await writeAtomic(this.settingsFile, JSON.stringify(this.settings, null, 2))
    return this.get()
  }

  apiKey(kind: ProviderKind): string | undefined {
    return this.keys[kind]
  }

  hasKeys(): Record<ProviderKind, boolean> {
    return Object.fromEntries(PROVIDER_KINDS.map((k) => [k, !!this.keys[k]])) as Record<ProviderKind, boolean>
  }


  /** Stores the key encrypted; an empty key removes it. */
  async setApiKey(kind: ProviderKind, key: string): Promise<void> {
    const trimmed = key.trim()
    if (trimmed && !(await safeStorage.isAsyncEncryptionAvailable())) {
      throw new Error('No keyring is available to store the API key safely (KWallet or Secret Service).')
    }
    if (trimmed) this.keys[kind] = trimmed
    else delete this.keys[kind]
    const out: Record<string, string> = {}
    for (const k of KEY_KINDS) {
      const value = this.keys[k]
      if (value) out[k] = (await safeStorage.encryptStringAsync(value)).toString('base64')
    }
    await writeAtomic(this.keysFile, JSON.stringify(out))
  }
}
