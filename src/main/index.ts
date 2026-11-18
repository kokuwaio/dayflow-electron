import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFile } from 'node:fs/promises'
import { BrowserWindow, Menu, Tray, app, clipboard, desktopCapturer, dialog, ipcMain, nativeImage, nativeTheme, net, powerMonitor, screen, shell, systemPreferences } from 'electron'
import { beforeBoundary, dayCount, dayRange, daysOf, shiftDay, todayKey } from '../shared/day'
import { PROVIDER_KINDS, cliOf, needsApiKey } from '../shared/providers'
import { describeRecorder, pauseLabel, pausePresets } from '../shared/status'
import { limitBytes, limitChange, observedBytesPerHour, totalBytes } from '../shared/storage'
import type { RecordingCheck } from '../shared/recording-status'
import { problemActions, problemKey, problemTextsFor, providerLabel, waitingLabel } from '../shared/provider-problem'
import { GeminiCooldowns } from '../shared/gemini-models'
import { currentLanguage, setLanguage, t } from '../shared/i18n'
import { resolveLanguage } from '../shared/languages'
import { renamedCategories } from '../shared/categories'
import { PRIVATE_WINDOWS_RULE } from '../shared/blocklist'
import { DEEP_LINK_SCHEME, deepLinkAction } from '../shared/deep-link'
import { isAgentClient } from '../shared/agent-clients'
import { type StandupDraft, accessProgress } from '../shared/daily'
import type { FrameRef } from '../shared/media'
import { type GoalPlan, defaultGoalPlan, summarizeDay } from '../shared/day-summary'
import { type GoalContext, minutesByCategory } from '../shared/goal-flow'
import { REVIEW_RATINGS, type ReviewRating, cardsToReviewPrompt, unreviewedCards } from '../shared/review'
import { exportFileName, rangeMarkdown, timelineText, weekText } from '../shared/export'
import { weekOf } from '../shared/week'
import { WEEKLY_MIN_TRACKED_MINUTES, trackedMinutes } from '../shared/weekly'
import type { AgentAccessInfo, AgentClient, AgentClientState, AppStatus, CardEdit, CliName, ProviderKind, ProviderProblem, Rating, Settings, StandupEntry, Tab } from '../shared/types'
import type { Span } from './db/store'
import { BridgeServer, agentSocketPath } from './agent/bridge'
import { type ClientEnv, clientStatus, connectClient, disconnectClient, repairStaleRegistrations } from './agent/clients'
import { cliInvocation, manualConfigSnippet, posixArgv, shellLine, terminalInstallCommand, terminalRemoveCommand, terminalTarget } from './agent/invocation'
import { WRITE_LOG } from './agent/protocol'
import { createWriteHandlers } from './agent/writes'
import { Pipeline } from './analysis/pipeline'
import { Recorder } from './capture/recorder'
import { backupDatabase, listBackups, openWithRecovery } from './db/backup'
import { ChatError, sendChatMessage } from './chat/service'
import { frameUrl } from '../shared/media'
import { AUTO_MIN_MINUTES, MANUAL_MIN_MINUTES, generateStandup, standupSourceDay } from './insights/daily'
import { handleMedia, registerMediaScheme } from './media'
import { createNotifier } from './notifications'
import { createPlatform } from './platform'
import { listInstalledApps } from './platform/installed-apps'
import { probeWindowDetection } from './platform/window-probe'
import { createProvider } from './providers'
import { findCli, hostAccess, nodeRunner } from './providers/cli/host'
import { CliSignIn } from './providers/cli/sign-in'
import { withDot } from './tray-dot'
import { selectFramesToPurge } from './retention'
import { secretFilter } from './privacy/masker'
import { tesseractEngine } from './privacy/tesseract'
import { LogFile } from './log-file'
import { debugReport } from './support'
import { SettingsStore } from './settings'
import { type Updater, startUpdater } from './updater'
import { type UpdateMode, parseCodesign, updateMode, isDevVersion } from '../shared/updates'
import { errorMessage } from '../shared/errors'
import { type ScreenPermission, type WindowCheck, liveWindowCheck, windowFixCommand } from '../shared/permissions'
import { type UiStyle, windowBackground } from '../shared/ui-style'
import { beginGuide } from '../shared/getting-started'
import { type DailyProviderOption, standupPlan } from '../shared/daily-provider'
import { createDailyBadge } from './daily-badge'
import { registerGettingStarted } from './getting-started'

const here = dirname(fileURLToPath(import.meta.url))
/** A deep link among the arguments (dayflow-electron://stop-recording), from the desktop or a second launch. */
const linkIn = (argv: string[]) => argv.find((a) => a.startsWith(`${DEEP_LINK_SCHEME}:`))
// A launch for a deep link does its job without showing the window. macOS
// login items get no arguments, so there the login launch is asked for.
const startHidden =
  process.argv.includes('--hidden') ||
  !!linkIn(process.argv) ||
  (process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAtLogin)
/** Set once the recorder exists; links that arrive earlier wait in pendingLink. */
let openLink: ((link: string) => void) | null = null
let pendingLink = linkIn(process.argv) ?? null
registerMediaScheme()
// Separate data for development and tests. Otherwise a fixed folder name:
// Electron would derive it from productName ("Dayflow Electron", with a space).
app.setPath('userData', process.env.DAYFLOW_DATA_DIR || join(app.getPath('appData'), 'dayflow-electron'))
/** logs/ in the data folder, for "Copy debug logs" (Settings → Other → Support). */
const logFile = new LogFile(join(app.getPath('userData'), 'logs'), { home: homedir() })

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    const link = linkIn(argv)
    if (!link) return showWindow()
    if (openLink) openLink(link)
    else pendingLink = link
  })
  // macOS delivers deep links as an event, also to a running app.
  app.on('open-url', (event, link) => {
    event.preventDefault()
    if (openLink) openLink(link)
    else pendingLink = link
  })
  app.whenReady().then(main).catch((err) => {
    console.error('startup failed', err)
    logFile.write(`startup failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`)
    app.exit(1)
  })
}

let window: BrowserWindow | null = null
/** The visual theme from settings, for the window's first colour and the page's first paint. */
let uiStyle: UiStyle = 'modern'
const changed = () => window?.webContents.send('cards:changed')
let tray: Tray | null = null
/** Set once the update check started (Windows and macOS packages). */
let updater: Updater | null = null
let quitting = false
/** Set by main(): the window gained or lost focus (the Daily badge clears once Daily is seen). */
let onWindowFocus: ((focused: boolean) => void) | null = null

const log = (message: string) => {
  console.log(`[dayflow-electron] ${message}`)
  logFile.write(message)
}

async function main(): Promise<void> {
  // Windows shows notifications only for an app ID that matches the installer's shortcut.
  if (process.platform === 'win32') app.setAppUserModelId('io.github.kokuwaio.DayflowElectron')
  const dataDir = app.getPath('userData')
  const recordingsDir = join(dataDir, 'recordings')
  mkdirSync(recordingsDir, { recursive: true })

  const settings = await SettingsStore.open(join(dataDir, 'settings.json'), join(dataDir, 'keys.json'))
  // The window follows this; CSS sees it as prefers-color-scheme.
  nativeTheme.themeSource = settings.get().theme
  uiStyle = settings.get().uiStyle
  // Tray, notifications and dialogs speak the app language; the window gets it in its URL and on changes.
  const appLanguage = () => resolveLanguage(settings.get().appLanguage, app.getPreferredSystemLanguages())
  await setLanguage(appLanguage())
  const backupDir = join(dataDir, 'backups')
  const { store, restoredFrom, damaged } = openWithRecovery(join(dataDir, 'dayflow.sqlite'), backupDir)
  log(`dayflow-electron ${app.getVersion()}`)
  if (restoredFrom) log(`the database was damaged; restored ${restoredFrom}`)
  if (damaged) log('warning: the database is damaged and there is no backup to restore; some data may be missing')
  // Upstream's maintenance: a backup a day (the first after an hour, or now when there is none) and a WAL checkpoint every 5 minutes.
  const backup = () => void backupDatabase(store, backupDir).catch((err) => log(`backup failed: ${String(err)}`))
  setTimeout(() => {
    backup()
    setInterval(backup, 24 * 3600_000)
  }, listBackups(backupDir).length ? 3600_000 : 0)
  setInterval(() => store.checkpoint(), 5 * 60_000)
  // After the data folder moved, stored paths point at the old place: follow the files
  // and give the batches that failed on missing frames another go.
  const relocated = store.relocateScreenshots(recordingsDir)
  if (relocated > 0) log(`moved ${relocated} screenshot paths to ${recordingsDir}; retrying ${store.retryFailedBatches()} failed batches`)
  const platform = createPlatform({
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
    tokenFile: join(dataDir, 'screencast-restore-token'),
    launchCommand: app.isPackaged ? [process.execPath] : [process.execPath, app.getAppPath()],
    electron: { app, desktopCapturer, screen, powerMonitor, systemPreferences, shell }
  })

  const captureOptions = (s: Settings) => ({ dir: recordingsDir, intervalSec: s.captureIntervalSec, height: s.captureHeight })
  const recorder = new Recorder(
    platform,
    captureOptions(settings.get()),
    (f) => {
      if (!f.blocked || !f.filePath) {
        store.insertScreenshot(f)
        return
      }
      // A frame that raced the block: delete it and keep only a placeholder.
      // If the delete fails, the row keeps the path so the purge removes it.
      void unlink(f.filePath).then(
        () => store.insertScreenshot({ ...f, filePath: '' }),
        (err: NodeJS.ErrnoException) => {
          if (err.code === 'ENOENT') store.insertScreenshot({ ...f, filePath: '' })
          else {
            log(`could not delete blocked frame ${f.filePath}: ${err.message}`)
            store.insertScreenshot(f)
          }
        }
      )
    },
    () => {
      const s = settings.get()
      return s.hidePrivateWindows ? [...s.blockedApps, PRIVATE_WINDOWS_RULE] : s.blockedApps
    }
  )

  const inFlatpak = !!process.env.FLATPAK_ID
  const cliEnv = { inFlatpak, home: homedir(), scratchDir: join(dataDir, 'cli-frames'), appId: process.env.FLATPAK_ID ?? '' }
  // Which Gemini models refused the key lately, for every request (upstream GeminiModelCooldowns).
  const geminiCooldowns = new GeminiCooldowns()
  const providerFor = (kind: ProviderKind) => {
    const s = settings.get()
    return createProvider({ kind, model: s.models[kind], baseUrl: s.openaiBaseUrl }, settings.apiKey(kind), {
      cli: { ...cliEnv, runner: nodeRunner, paths: s.cliPaths },
      geminiCooldowns
    })
  }
  const currentProvider = () => providerFor(settings.get().provider)
  const usable = (kind: ProviderKind) => !needsApiKey(kind, settings.get().openaiBaseUrl) || !!settings.apiKey(kind)

  const pipelineProviders = () => {
    const s = settings.get()
    const kinds = [s.provider, ...(s.fallbackProvider ? [s.fallbackProvider] : [])]
    for (const k of kinds.filter((k) => !usable(k))) log(`no API key for ${k}; skipping it`)
    const ready = kinds.filter(usable)
    return ready.length ? ready.map(providerFor) : `No API key set for ${s.provider}. Add one in Settings.`
  }

  // One OCR worker, started on the first masked frame and kept between batches.
  const ocr = tesseractEngine()
  const pipeline = new Pipeline({
    store,
    prepareFrame: secretFilter(ocr, () => settings.get().hideSecrets),
    providers: () => pipelineProviders(),
    language: () => settings.get().outputLanguage,
    overrides: () => settings.get().promptOverrides,
    categories: () => settings.get().categories,
    onCardsChanged: () => changed(),
    online: () => net.isOnline(),
    providerLabel: (kind) => providerLabel(kind, settings.get().openaiBaseUrl),
    log
  })

  // ---- provider problems: sign-in from the app, backup offers (upstream ProviderSignIn, ProviderProblemCenter)
  const signIn = new CliSignIn({
    runner: nodeRunner,
    env: cliEnv,
    configuredPath: (cli) => settings.get().cliPaths[cli],
    changed: () => pushStatus(),
    signedIn: (cli) => {
      log(`signed in to ${cli}; catching up`)
      void pipeline.resume(true)
    },
    log
  })
  /** The agent CLIs that are installed and signed in, checked when a problem comes up (they can be the backup). */
  const cliReady: Record<CliName, boolean> = { claude: false, codex: false }
  const checkCliReady = async () => {
    for (const cli of ['claude', 'codex'] as const) cliReady[cli] = await signIn.isReady(cli).catch(() => false)
  }
  /** Providers that could take over: API providers with a key (or a local server), CLIs that are signed in. */
  /** Whether a provider can run now: API providers with a key (or a local server), CLIs that are signed in. */
  const providerReady = (kind: ProviderKind): boolean => {
    const cli = cliOf(kind)
    return cli ? cliReady[cli] : usable(kind)
  }
  /** Providers that could take over. */
  const configuredKinds = (): ProviderKind[] => PROVIDER_KINDS.filter(providerReady)
  const currentProblem = (): ProviderProblem | null => {
    const p = pipeline.status().problem
    if (!p) return null
    const s = settings.get()
    return { ...p, ...problemActions(p, { primary: s.provider, fallback: s.fallbackProvider, configured: configuredKinds() }) }
  }

  const purge = async () => {
    const limit = limitBytes(settings.get().storageLimitGb)
    if (limit === Infinity) return
    const ids = selectFramesToPurge(store.storedFrames(), limit)
    for (const file of store.deleteScreenshots(ids)) await unlink(file).catch(() => {})
    if (ids.length) log(`purged ${ids.length} frames over the storage limit`)
  }

  const status = (): AppStatus => ({
    platform: platform.name,
    recorder: recorder.status(),
    analysis: { ...pipeline.status(), waiting: store.waitingSummary(), problem: currentProblem(), signIn: signIn.state() },
    keys: settings.hasKeys(),
    framesBytes: totalBytes(store.storedFrames())
  })

  // ---- IPC (see src/preload/index.ts)
  ipcMain.handle('day:get', (_e, day?: string) => {
    const key = day ?? todayKey()
    return { day: key, cards: store.cardsForDay(key), ratings: store.ratings(dayRange(key)) }
  })
  const daysWithCards = (days: string[]) => days.map((day) => ({ day, cards: store.cardsForDay(day) }))
  const notifier = createNotifier({
    open: (tab: Tab) => {
      showWindow()
      window?.webContents.send('navigate', tab)
    },
    windowFocused: () => !!window?.isFocused(),
    today: todayKey,
    problemDays: () => settings.get().notified.problemDays,
    saveProblemDays: (problemDays) => void settings.save({ notified: { ...settings.get().notified, problemDays } })
  })
  const access = () => accessProgress(store.analyzedBatchCount())
  const configuredProviders = () => {
    const p = pipelineProviders()
    return typeof p === 'string' ? [] : p
  }
  /** Who writes the standup (Daily's provider picker, upstream DailyRecapProvider): the providers, or why there are none. */
  const standupProviders = () => {
    const plan = standupPlan(settings.get().dailyProvider, settings.get(), usable)
    if (plan.kind === 'off') return t('daily.provider.off')
    if (plan.kind === 'unavailable') return t('daily.provider.unavailable', { name: providerLabel(plan.provider, settings.get().openaiBaseUrl) })
    return plan.providers.map(providerFor)
  }
  /** One standup run per day at a time, shared by the scheduler and the Regenerate button (upstream isRunningCheck). */
  const standupRuns = new Map<string, Promise<StandupEntry>>()
  const writeStandup = (day: string, minMinutes: number): Promise<StandupEntry> => {
    const running = standupRuns.get(day)
    if (running) return running
    const providers = standupProviders()
    if (typeof providers === 'string') return Promise.reject(new Error(providers))
    const run = generateStandup({ store, providers, target: day, language: settings.get().outputLanguage, minMinutes })
      .then((entry) => {
        store.saveStandup(day, entry)
        window?.webContents.send('daily:changed')
        return entry
      })
      .finally(() => standupRuns.delete(day))
    standupRuns.set(day, run)
    return run
  }
  // Upstream's scheduler: once Daily is unlocked, after 4 AM and with a day worth
  // summarizing, at most 3 tries a day, counted across restarts.
  const scheduleStandup = async () => {
    const day = todayKey()
    if (!access().daily.unlocked || beforeBoundary(new Date()) || store.standup(day) || standupRuns.has(day)) return
    const providers = standupProviders()
    if (typeof providers === 'string' || providers.length === 0 || !standupSourceDay(store, day, AUTO_MIN_MINUTES)) return
    const attempts = settings.get().standupAttempts
    const tries = attempts.day === day ? attempts.count : 0
    if (tries >= 3) return
    await settings.save({ standupAttempts: { day, count: tries + 1 } })
    try {
      await writeStandup(day, AUTO_MIN_MINUTES)
      notifier.standupReady(day)
      dailyBadge.recapReady(day)
    } catch (err) {
      log(`standup failed: ${String(err)}`)
    }
  }
  // The sidebar dot and Dock count for a recap the user has not opened (upstream NotificationBadgeManager).
  const dailyBadge = createDailyBadge({
    unseen: () => settings.get().dailyRecapUnseen,
    save: (dailyRecapUnseen) => void settings.save({ dailyRecapUnseen }),
    send: (pending) => window?.webContents.send('daily:badge', pending),
    setCount: (count) => (process.platform === 'darwin' || process.platform === 'linux') && app.setBadgeCount(count)
  })
  ipcMain.handle('daily:badge', () => dailyBadge.pending())
  ipcMain.on('app:view', (_e, tab: Tab) => dailyBadge.view({ tab }))
  onWindowFocus = (focused) => dailyBadge.view({ focused })
  setInterval(() => void scheduleStandup(), 5 * 60_000)
  void scheduleStandup()
  // The providers Daily's picker offers, and whether each can run now.
  ipcMain.handle('daily:providers', async (): Promise<DailyProviderOption[]> => {
    const s = settings.get()
    // The same check as the backup offer: a CLI counts once it is signed in, not just installed.
    await checkCliReady()
    return PROVIDER_KINDS.map((kind) => ({ kind, label: providerLabel(kind, s.openaiBaseUrl), model: s.models[kind], available: providerReady(kind) }))
  })

  ipcMain.handle('access:get', () => access())
  ipcMain.handle('daily:get', (_e, day: string) => store.standup(day))
  ipcMain.handle('daily:generate', async (_e, day: string) => {
    try {
      return { ok: true, entry: await writeStandup(day, MANUAL_MIN_MINUTES) }
    } catch (err) {
      return { ok: false, message: errorMessage(err) }
    }
  })
  // Chat (upstream ChatService): one answer at a time; its progress streams to the window as chat:event.
  let chatBusy = false
  ipcMain.handle('chat:conversations', () => store.conversations())
  ipcMain.handle('chat:messages', (_e, id: string) => store.chatMessages(id))
  ipcMain.handle('chat:delete', (_e, id: string) => store.deleteConversation(id))
  ipcMain.handle('chat:memory', () => settings.get().chatMemory)
  ipcMain.handle('chat:memory:save', async (_e, memory: string) => {
    await settings.save({ chatMemory: typeof memory === 'string' ? memory : '' })
  })
  const chatSuggestions = new Map<string, string[]>()
  ipcMain.handle('chat:providers', () => configuredProviders().map((p) => p.kind))
  ipcMain.handle('chat:send', async (_e, conversationId: string | null, text: string, preferred?: ProviderKind) => {
    if (chatBusy) return { ok: false, message: t('chat.errors.busy') }
    if (!access().chat.unlocked) return { ok: false, message: t('chat.errors.locked') }
    if (typeof text !== 'string' || !text.trim()) return { ok: false, message: t('chat.errors.empty') }
    chatBusy = true
    try {
      const reply = await sendChatMessage(
        { store, providers: configuredProviders, settings, categories: () => settings.get().categories, suggestions: chatSuggestions },
        { conversationId, text: text.slice(0, 20_000), preferred },
        (event) => window?.webContents.send('chat:event', event)
      )
      return { ok: true, reply }
    } catch (err) {
      return {
        ok: false,
        message: errorMessage(err),
        conversationId: err instanceof ChatError ? err.conversationId : conversationId
      }
    } finally {
      chatBusy = false
    }
  })
  ipcMain.handle('daily:save', (_e, day: string, draft: StandupDraft) => {
    // Edits to an unsaved draft create the entry, like upstream's editable placeholder.
    const current = store.standup(day)
    store.saveStandup(day, { draft, sourceDay: current?.sourceDay ?? null, provider: current?.provider ?? 'user', model: current?.model ?? '', generatedAt: current?.generatedAt ?? 0 })
  })

  const weekCards = (days: string[]) => days.flatMap((d) => store.cardsForDay(d))
  ipcMain.handle('weekly:get', (_e, day: string) => {
    const week = weekOf(day)
    return { week, cards: weekCards(week.days), previous: weekCards(weekOf(shiftDay(day, -7)).days) }
  })
  // Upstream opens the newest week with at least 15 h tracked (within a year), else the newest with data.
  ipcMain.handle('weekly:defaultDay', () => {
    const categories = settings.get().categories
    let newestWithData: string | null = null
    for (let back = 0; back < 52; back++) {
      const day = shiftDay(todayKey(), -7 * back)
      const minutes = trackedMinutes(weekCards(weekOf(day).days), categories)
      if (minutes >= WEEKLY_MIN_TRACKED_MINUTES) return day
      if (minutes > 0) newestWithData ??= day
    }
    return newestWithData ?? todayKey()
  })
  ipcMain.handle('week:get', (_e, day: string) => {
    const week = weekOf(day)
    const last = week.days[week.days.length - 1]!
    return { ...week, columns: daysWithCards(week.days), ratings: store.ratings({ start: dayRange(week.days[0]!).start, end: dayRange(last).end }) }
  })
  ipcMain.handle('goals:get', (_e, day: string) => {
    const categories = settings.get().categories
    return store.goalPlan(day, categories) ?? defaultGoalPlan(categories)
  })
  ipcMain.handle('goals:set', (_e, day: string, plan: GoalPlan) => {
    store.setGoalPlan(day, plan, settings.get().categories)
  })
  // What the goal pop-up needs: whether to open, yesterday's review and the reference stats.
  ipcMain.handle('goals:context', (_e, day: string): GoalContext => {
    const categories = settings.get().categories
    const totalsOf = (d: string, plan: GoalPlan) => summarizeDay(store.cardsForDay(d), categories, plan, d)
    const fallback = defaultGoalPlan(categories)
    const yesterday = shiftDay(day, -1)
    const yesterdayPlan = store.hasOwnGoalPlan(yesterday) ? store.goalPlan(yesterday, categories) : null
    const yesterdayStats = totalsOf(yesterday, yesterdayPlan ?? fallback)
    const week: Record<string, number> = {}
    for (let i = 1; i <= 7; i++) for (const t of totalsOf(shiftDay(day, -i), fallback).totals) week[t.category] = (week[t.category] ?? 0) + t.minutes
    return {
      activeDays: store.activeCardDays(day),
      skipStreak: store.goalSkipStreak(day),
      hasOwnPlan: store.hasOwnGoalPlan(day),
      yesterday: yesterdayPlan && { plan: yesterdayPlan, focusMinutes: yesterdayStats.focusMinutes, distractedMinutes: yesterdayStats.distractedMinutes, focusTotals: yesterdayStats.totals.filter((t) => yesterdayPlan.focusCategories.some((n) => n.trim().toLowerCase() === t.category.trim().toLowerCase())) },
      yesterdayMinutes: minutesByCategory(yesterdayStats.totals),
      weekMinutes: week
    }
  })
  // Timeline review (upstream TimelineReviewOverlay): ratings per time range, and how many cards still need one.
  ipcMain.handle('review:get', (_e, day: string) => {
    const segments = store.reviewRatings(dayRange(day))
    const count = unreviewedCards(store.cardsForDay(day), segments, day).length
    const recent = store.hasReviewRatingSince(dayRange(shiftDay(todayKey(), -7)).start)
    return { segments, toReview: cardsToReviewPrompt(count, { hasAny: store.hasAnyReviewRating(), hasRecent: recent }) }
  })
  ipcMain.handle('review:rate', (_e, span: Span, rating: ReviewRating) => {
    if (REVIEW_RATINGS.includes(rating)) store.applyReviewRating(span, rating)
  })
  ipcMain.handle('clipboard:write', (_e, text: string) => {
    if (typeof text === 'string') clipboard.writeText(text.slice(0, 100_000))
  })
  ipcMain.handle('timeline:copy', (_e, mode: 'day' | 'week', day: string) => {
    const opts = { today: todayKey() }
    const week = weekOf(day)
    const text = mode === 'day' ? timelineText(day, store.cardsForDay(day), opts) : weekText(week.title, daysWithCards(week.days), opts)
    clipboard.writeText(text)
  })
  ipcMain.handle('timeline:export', async (_e, from: string, to: string) => {
    if (from > to) return { ok: false, message: t('settings.export.startAfterEnd') }
    if (dayCount(from, to) > 3660) return { ok: false, message: t('settings.export.tooLong') }
    const target = await dialog.showSaveDialog({
      defaultPath: join(app.getPath('documents'), exportFileName(from, to)),
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    })
    if (target.canceled || !target.filePath) return { ok: false, message: t('settings.export.canceled') }
    const days = daysWithCards(daysOf(from, to))
    try {
      await writeFile(target.filePath, rangeMarkdown(days, { today: todayKey() }), 'utf8')
    } catch (err) {
      return { ok: false, message: t('settings.export.saveFailed', { error: errorMessage(err) }) }
    }
    const activities = days.reduce((n, d) => n + d.cards.length, 0)
    return { ok: true, message: t('settings.export.saved', { path: target.filePath, activities, days: days.length }) }
  })
  ipcMain.handle('card:update', (_e, id: number, change: CardEdit) => {
    const card = store.updateCard(id, change)
    changed()
    return card
  })
  ipcMain.handle('card:delete', (_e, id: number) => {
    store.deleteCard(id)
    changed()
  })
  ipcMain.handle('card:rate', (_e, span: Span, rating: Rating['rating'], feedback?: string) => {
    store.rateRange(span, rating, feedback ?? null)
    changed()
  })
  ipcMain.handle('batch:reprocess', (_e, batchId: number) => {
    const reset = store.reprocessBatch(batchId)
    changed()
    // A waiting batch's "Try now" also lets held providers try again.
    void pipeline.resume()
    return reset
  })
  ipcMain.handle('day:reprocess', (_e, day: string) => {
    const count = store.reprocessDay(day)
    changed()
    void pipeline.tick()
    return count
  })

  // ---- agent access: the write bridge for the CLI and MCP server (src/main/agent/)
  const writeHandlers = createWriteHandlers({
    store,
    categories: () => settings.get().categories,
    saveCategories: async (categories) => (await savePreferences({ categories })).categories,
    cardsChanged: () => changed(),
    today: todayKey
  })
  const bridge = new BridgeServer({
    socketPath: agentSocketPath(dataDir),
    logFile: join(dataDir, WRITE_LOG),
    editsEnabled: () => settings.get().allowEdits,
    handle: async (operation, args) => {
      const result = await writeHandlers(operation, args)
      // Category and goal writes change what open views show (Settings included), not only cards.
      changed()
      return result
    }
  })
  const syncBridge = () =>
    (settings.get().allowEdits ? bridge.start() : bridge.stop()).catch((err: unknown) => log(`agent bridge: ${String(err)}`))
  void syncBridge()
  const agentInvocation = () =>
    cliInvocation({ flatpakId: process.env.FLATPAK_ID, execPath: process.execPath, script: join(app.getAppPath(), 'out/main/cli.js') })
  const clientEnv = (client: AgentClient): ClientEnv => ({
    runner: nodeRunner,
    inFlatpak,
    appId: cliEnv.appId,
    home: cliEnv.home,
    configuredPath: client === 'claude' || client === 'codex' ? settings.get().cliPaths[client] : '',
    invocation: agentInvocation(),
    places: {
      platform: process.platform,
      home: cliEnv.home,
      // The Flatpak sets its own XDG_CONFIG_HOME; Claude Desktop on the host uses the default.
      ...(!inFlatpak && process.env.XDG_CONFIG_HOME ? { xdgConfigHome: process.env.XDG_CONFIG_HOME } : {}),
      ...(process.env.APPDATA ? { appData: process.env.APPDATA } : {}),
      ...(process.env.LOCALAPPDATA ? { localAppData: process.env.LOCALAPPDATA } : {})
    },
    openExternal: (url) => shell.openExternal(url)
  })
  // Upstream repairs registrations at launch that point at a moved app. Not in
  // development: that would point the user's tools at the dev build.
  if (app.isPackaged && !isDevVersion(app.getVersion())) {
    void repairStaleRegistrations(clientEnv).then(
      (lines) => lines.forEach((line) => log(`agent access: ${line}`)),
      (err: unknown) => log(`agent access: repairing registrations failed: ${errorMessage(err)}`)
    )
  }
  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('agent:info', (): AgentAccessInfo => {
    const inv = agentInvocation()
    return {
      command: shellLine(posixArgv(inv)),
      terminal:
        process.platform === 'win32'
          ? null
          : { install: terminalInstallCommand(inv, process.platform), remove: terminalRemoveCommand(process.platform), dir: terminalTarget(process.platform).dir },
      configSnippet: manualConfigSnippet(inv)
    }
  })
  ipcMain.handle('agent:client', (_e, cli: unknown, action: unknown): Promise<AgentClientState> => {
    if (!isAgentClient(cli)) return Promise.resolve({ state: 'failed', message: 'Unknown client.' })
    if (action === 'connect') return connectClient(cli, clientEnv(cli))
    if (action === 'disconnect') return disconnectClient(cli, clientEnv(cli))
    return clientStatus(cli, clientEnv(cli))
  })

  /** Saves preferences like the Settings page does: autostart, card renames, recorder, storage, bridge. */
  async function savePreferences(next: Partial<Settings>): Promise<Settings> {
    const before = settings.get()
    // Apply autostart first so a failure leaves the stored setting unchanged.
    if (next.launchAtLogin !== undefined && next.launchAtLogin !== before.launchAtLogin) {
      await platform.setAutostart(next.launchAtLogin)
    }
    const saved = await settings.save(next)
    if (saved.theme !== before.theme) nativeTheme.themeSource = saved.theme
    if (saved.theme !== before.theme || saved.uiStyle !== before.uiStyle) {
      uiStyle = saved.uiStyle
      window?.setBackgroundColor(windowBackground(uiStyle, nativeTheme.shouldUseDarkColors))
    }
    // Cards follow renamed categories (matched by id after the names were cleaned up).
    const renames = renamedCategories(before.categories, saved.categories)
    for (const { from, to } of renames) store.renameCategory(from, to)
    if (renames.length) changed()
    if (saved.appLanguage !== before.appLanguage) {
      const language = appLanguage()
      await setLanguage(language)
      updateTray()
      window?.webContents.send('language:changed', language)
    }
    if (saved.captureIntervalSec !== before.captureIntervalSec || saved.captureHeight !== before.captureHeight) {
      recorder.reconfigure(captureOptions(saved))
    }
    recorder.refreshBlocking()
    if (limitChange(before.storageLimitGb, saved.storageLimitGb) === 'confirm') await purge()
    if (saved.allowEdits !== before.allowEdits) await syncBridge()
    // The tray offers the pause lengths and "Check for updates…" only while that is on.
    if (String(saved.pauseMinutes) !== String(before.pauseMinutes) || saved.checkForUpdates !== before.checkForUpdates) updateTray()
    if (saved.autoInstallUpdates !== before.autoInstallUpdates) updater?.setAutoInstall(saved.autoInstallUpdates)
    // New provider settings may fix what batches wait for: try them now (upstream's setup signature).
    const routing = (x: Settings) => JSON.stringify([x.provider, x.fallbackProvider, x.models, x.openaiBaseUrl, x.cliPaths])
    if (routing(saved) !== routing(before)) void pipeline.resume(true)
    return saved
  }

  ipcMain.handle('status:get', () => status())
  ipcMain.handle('settings:get', () => settings.get())
  ipcMain.handle('settings:save', async (_e, next: Partial<Settings>) => {
    // The window only edits preferences; the app's own bookkeeping is not its to change.
    const { notified: _n, standupAttempts: _a, onboarded: _o, chatMemory: _m, gettingStarted: _g, dailyRecapUnseen: _d, ...preferences } = next
    return savePreferences(preferences)
  })
  ipcMain.handle('key:set', async (_e, kind: ProviderKind, key: string) => {
    await settings.setApiKey(kind, key)
    void pipeline.resume(true)
  })
  ipcMain.handle('provider:signIn', (_e, cli: CliName) => {
    if (cli === 'claude' || cli === 'codex') void signIn.start(cli)
  })
  ipcMain.handle('provider:signInCancel', () => signIn.cancel())
  // "Use X as backup" (upstream acceptBackupOffer): X becomes the fallback and what waits goes out.
  ipcMain.handle('provider:useBackup', async (_e, kind: ProviderKind) => {
    const s = settings.get()
    if (kind === s.provider || !configuredKinds().includes(kind)) return
    await savePreferences({ fallbackProvider: kind })
    void pipeline.resume(true)
  })
  ipcMain.handle('provider:test', async () => {
    try {
      const provider = currentProvider()
      const reply = await provider.generate({
        turns: [{ role: 'user', parts: [{ type: 'text', text: 'Reply with the single word OK.' }] }]
      })
      return { ok: true, message: t('settings.providers.testAnswered', { model: reply.model, text: reply.text.trim().slice(0, 80) }) }
    } catch (err) {
      return { ok: false, message: errorMessage(err) }
    }
  })
  ipcMain.handle('capture:pause', (_e, seconds: number | null) => {
    recorder.pause(seconds)
    updateTray()
  })
  ipcMain.handle('capture:resume', () => {
    recorder.resume()
    updateTray()
  })
  ipcMain.handle('recordings:open', () => shell.openPath(recordingsDir))
  ipcMain.handle('support:copyDebugLogs', () => {
    const build = inFlatpak ? 'flatpak' : app.isPackaged ? 'packaged' : 'development'
    const sources = { store, logFile, settings: settings.get(), status: status(), version: app.getVersion(), build, language: currentLanguage(), home: homedir() }
    clipboard.writeText(debugReport(sources))
  })
  ipcMain.handle('support:openLogs', () => {
    mkdirSync(logFile.dir, { recursive: true })
    return shell.openPath(logFile.dir)
  })
  // Settings → Storage: disk use, and "Run status check" (purges first, like upstream).
  ipcMain.handle('storage:check', async (_e, run: boolean) => {
    if (run === true) await purge()
    const frames = store.storedFrames()
    const now = Math.floor(Date.now() / 1000)
    const r = recorder.status()
    const check: RecordingCheck = {
      platform: process.platform,
      screen: platform.screenAccess(),
      recorder: r.state,
      lastError: r.lastError,
      lastFrameAt: store.captureStatus().lastCaptureAt,
      intervalSec: settings.get().captureIntervalSec,
      captureRunning: recorder.captureRunning(),
      checkedAt: now
    }
    return { check, framesBytes: totalBytes(frames), observedBytesPerHour: observedBytesPerHour(frames, now) }
  })
  // Settings → Privacy: installed apps to block (src/main/platform/installed-apps.ts).
  ipcMain.handle('apps:installed', () =>
    listInstalledApps({
      platform: process.platform,
      home: homedir(),
      env: process.env,
      flatpakId: process.env.FLATPAK_ID ?? '',
      language: currentLanguage(),
      ...(process.platform === 'win32' ? { readShortcutLink: (path: string) => shell.readShortcutLink(path) } : {})
    })
  )
  ipcMain.handle('cli:check', async (_e, cli: CliName) => {
    const access = await hostAccess(nodeRunner, inFlatpak, cliEnv.appId)
    if (!access.ok) return { ok: false, message: access.reason }
    const configuredPath = settings.get().cliPaths[cli]
    const found = await findCli(nodeRunner, cli, { ...cliEnv, ...(configuredPath ? { configuredPath } : {}) })
    return found
      ? { ok: true, message: t('settings.providers.cliFound', { path: found.path }) }
      : { ok: false, message: configuredPath ? t('settings.providers.cliNotFoundAt', { path: configuredPath }) : t('settings.providers.cliNotFound') }
  })
  ipcMain.handle('analysis:run', () => pipeline.tick())

  // ---- tray
  /** Shows the window and asks it to show the problem's card again (upstream showCardAgain). */
  const showProblem = () => {
    showWindow()
    window?.webContents.send('navigate', 'timeline')
    window?.webContents.send('problem:show')
  }
  /** "Claude Code is signed out · 3 hrs waiting · Click to sign in" (upstream problemItem). */
  const problemLine = (problem: ProviderProblem) => {
    const parts = [problemTextsFor(problem, settings.get().openaiBaseUrl).title]
    const time = waitingLabel(store.waitingSummary().minutes)
    if (time) parts.push(t('waiting.tray.time', { time }))
    parts.push(problem.signIn ? t('waiting.tray.clickToSignIn') : t('waiting.tray.clickToFix'))
    return parts.join(' · ')
  }
  const updateTray = () => {
    if (!tray) return
    const r = recorder.status()
    const paused = r.state === 'paused'
    const description = describeRecorder(r.state, r.until)
    const updateItem = updater?.menuItem()
    const checkItem = updater?.checkItem()
    updateAppMenu()
    const problem = currentProblem()
    tray.setImage(problem ? trayImages.attention : trayImages.normal)
    tray.setToolTip(t('tray.tooltip', { status: problem ? problemLine(problem) : description }))
    tray.setContextMenu(
      Menu.buildFromTemplate([
        ...(problem ? [{ label: problemLine(problem), click: showProblem }, { type: 'separator' as const }] : []),
        { label: description, enabled: false },
        ...(updateItem ? [{ ...updateItem, enabled: !!updateItem.click }] : []),
        ...(checkItem ? [checkItem] : []),
        { type: 'separator' },
        paused
          ? { label: t('tray.resume'), click: () => (recorder.resume(), updateTray()) }
          : {
              label: t('tray.pause'),
              submenu: pausePresets(settings.get().pauseMinutes).map((p) => ({
                label: pauseLabel(p.seconds),
                click: () => {
                  recorder.pause(p.seconds)
                  updateTray()
                }
              }))
            },
        { label: t('tray.open'), click: () => showWindow() },
        { label: t('tray.openRecordings'), click: () => void shell.openPath(recordingsDir) },
        { type: 'separator' },
        { label: t('tray.quit'), click: () => app.quit() }
      ])
    )
  }
  // macOS: the app menu gets "Check for updates…" too, once the updater runs (installer builds).
  let appMenuLabel: string | null = null
  const updateAppMenu = () => {
    if (process.platform !== 'darwin' || !updater) return
    const item = updater.checkItem()
    const key = item ? `${item.label}|${item.enabled}` : ''
    if (key === appMenuLabel) return
    appMenuLabel = key
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          role: 'appMenu',
          submenu: [
            { role: 'about' },
            ...(item ? [{ label: item.label, enabled: item.enabled, click: item.click }] : []),
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' }
          ]
        },
        { role: 'editMenu' },
        { role: 'viewMenu' },
        { role: 'windowMenu' }
      ])
    )
  }
  // macOS tints a "…Template" image for light and dark menu bars; other panels get the coloured tile.
  // createFromPath also loads the @2x variant next to the file.
  const trayIcon = process.platform === 'darwin' ? 'resources/trayTemplate.png' : 'resources/tray.png'
  const trayImages = trayIconSet(nativeImage.createFromPath(join(app.getAppPath(), trayIcon)))
  tray = new Tray(trayImages.normal)
  tray.on('click', () => (currentProblem() ? showProblem() : showWindow()))

  // ---- updates (src/main/updater.ts): Windows and macOS packages only
  const updates: Promise<UpdateMode> = (async () => {
    // Squirrel.Mac installs only into a Developer ID signed app; ad-hoc builds only notify.
    const macSignature =
      process.platform === 'darwin' && app.isPackaged
        ? parseCodesign((await nodeRunner.run('codesign', ['-dv', '--verbose=2', join(dirname(process.execPath), '..', '..')], { timeoutMs: 10_000 })).stderr)
        : undefined
    return updateMode({ platform: process.platform, version: app.getVersion(), packaged: app.isPackaged, inFlatpak, ...(macSignature ? { macSignature } : {}) })
  })()
  ipcMain.handle('updates:support', () => updates)
  void updates
    .then(async (mode) => {
      if (mode.mode === 'off') return log(`updates: off (${mode.reason})`)
      updater = await startUpdater({
        mode: mode.mode,
        currentVersion: app.getVersion(),
        autoInstall: settings.get().autoInstallUpdates,
        enabled: () => settings.get().checkForUpdates,
        log,
        changed: () => updateTray(),
        beforeRestart: () => {
          quitting = true
        }
      })
      updateTray()
    })
    .catch((err: unknown) => log(`updates: ${errorMessage(err)}`))

  let lastStatus = ''
  let lastProblem: string | null = null
  const checkNotifications = () => {
    const shown = settings.get().notified
    if (!shown.firstCards && store.hasTimelineCards()) {
      notifier.firstCards()
      void settings.save({ notified: { ...settings.get().notified, firstCards: true } })
    }
    if (!shown.weeklyUnlock && access().weekly.unlocked) {
      notifier.weeklyUnlocked()
      void settings.save({ notified: { ...settings.get().notified, weeklyUnlock: true } })
    }
    const problem = currentProblem()
    const key = problem && problemKey(problem)
    if (problem && key !== lastProblem) {
      // A new problem: see which other providers could be the backup, and say it once a day.
      void checkCliReady().then(() => pushStatus())
      const texts = problemTextsFor(problem, settings.get().openaiBaseUrl)
      notifier.providerProblem({ kind: problem.kind, ...texts }, store.waitingSummary().minutes)
      signIn.clearFailure()
    }
    if (!problem && lastProblem) signIn.cancel()
    lastProblem = key
  }
  // Back online: give the network a moment to settle, then send what waits (upstream ConnectivityMonitor).
  let wasOnline = net.isOnline()
  const watchNetwork = () => {
    const online = net.isOnline()
    if (online && !wasOnline) {
      log('back online')
      setTimeout(() => net.isOnline() && void pipeline.resume(), 5_000)
    }
    wasOnline = online
  }
  // After a wake the network takes a few seconds; a local model does not need it.
  powerMonitor.on('resume', () => setTimeout(() => void pipeline.resume(), 10_000))
  // Coming back to the window may mean the problem was fixed elsewhere (upstream allowNextAttemptNow).
  app.on('browser-window-focus', () => {
    if (store.waitingSummary().batches > 0) void pipeline.resume()
  })
  const pushStatus = () => {
    const s = status()
    const key = JSON.stringify([s.recorder, s.analysis])
    if (key === lastStatus) return
    lastStatus = key
    updateTray()
    window?.webContents.send('status:changed', s)
  }
  setInterval(() => {
    watchNetwork()
    checkNotifications()
    pushStatus()
  }, 2_000)

  handleMedia({
    recordingsDir,
    iconDir: join(dataDir, 'icons'),
    framePath: (id) => store.screenshotPath(id),
    iconsEnabled: () => settings.get().showAppIcons
  })
  ipcMain.handle('frames:get', (_e, span: Span) =>
    store.framesInRange(span).map((f): FrameRef => ({ capturedAt: f.capturedAt, url: frameUrl(f.id) }))
  )
  // Recording starts once the first-run setup is done (upstream records only after onboarding).
  ipcMain.handle('onboarding:complete', async () => {
    if (settings.get().onboarded) return // a second click must not start a second recorder
    // The first-day guide starts here (upstream GettingStarted.begin): tour, then the checklist.
    await settings.save({ onboarded: true, gettingStarted: beginGuide(Math.floor(Date.now() / 1000)) })
    recorder.start()
    updateTray()
  })
  // Upstream's "Reset Onboarding": back through setup, keeping data and settings; recording waits for the end of it.
  ipcMain.handle('onboarding:reset', async () => {
    if (!settings.get().onboarded) return
    await settings.save({ onboarded: false })
    recorder.stop()
    updateTray()
    window?.webContents.reload()
  })
  registerGettingStarted({
    ipcMain,
    settings,
    hasCards: () => store.hasTimelineCards(),
    changed: (guide) => window?.webContents.send('gettingStarted:changed', guide)
  })
  if (settings.get().onboarded) recorder.start()

  // The onboarding's Permissions step (src/shared/permissions.ts): ask before recording starts.
  let screenRequested = false
  let screenRequest: Promise<{ ok: boolean; message: string }> | null = null
  ipcMain.handle('permissions:get', (): ScreenPermission => ({ screen: platform.screenAccess(), requested: screenRequested }))
  ipcMain.handle('permissions:requestScreen', () => {
    screenRequested = true
    // One share dialog at a time.
    screenRequest ??= platform
      .requestScreenAccess()
      .then(
        () => ({ ok: true, message: '' }),
        (err: unknown) => ({ ok: false, message: errorMessage(err) })
      )
      .finally(() => {
        screenRequest = null
      })
    return screenRequest
  })
  // macOS applies Screen Recording only to a new process (upstream's Quit and Reopen).
  ipcMain.handle('permissions:relaunch', () => {
    app.relaunch()
    app.quit()
  })
  ipcMain.handle('permissions:window', async (): Promise<WindowCheck> => {
    // Settings → Permissions while recording: the recorder's own state (src/shared/permissions.ts, liveWindowCheck).
    if (recorder.status().state !== 'stopped') return liveWindowCheck(recorder.status(), process.env.FLATPAK_ID ?? '')
    const result = await probeWindowDetection(platform)
    return { ...result, command: windowFixCommand(result.reason, process.env.FLATPAK_ID ?? '') }
  })

  // Deep links (upstream AppDeepLinkRouter): start resumes a pause, stop pauses until resumed.
  openLink = (link) => {
    const action = deepLinkAction(link)
    if (!action || !settings.get().onboarded) return
    log(`deep link: ${action}`)
    if (action === 'start') recorder.resume()
    else recorder.pause(null)
  }
  // Outside the Flatpak the desktop file is not installed; register the scheme for this user.
  if (!process.env.FLATPAK_ID && app.isPackaged) app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME)
  if (pendingLink) openLink(pendingLink)
  pendingLink = null
  pipeline.start()
  updateTray()
  void purge()
  setInterval(() => void purge(), 3600_000)

  app.on('before-quit', () => {
    quitting = true
    signIn.cancel()
    void bridge.stop()
    recorder.stop()
    pipeline.stop()
    void ocr.close()
    store.close()
  })
  // Closing the window keeps recording; quit from the tray.
  app.on('window-all-closed', () => {})
  // macOS: clicking the Dock icon brings the window back.
  app.on('activate', () => showWindow())

  if (!startHidden) showWindow()
}

/** The tray icon, and the same with an orange dot for a problem that needs the user. */
function trayIconSet(normal: Electron.NativeImage): { normal: Electron.NativeImage; attention: Electron.NativeImage } {
  const attention = nativeImage.createEmpty()
  for (const scaleFactor of normal.getScaleFactors()) {
    const bitmap = normal.toBitmap({ scaleFactor })
    // Tray icons are square.
    const side = Math.sqrt(bitmap.length / 4)
    if (!Number.isInteger(side) || side === 0) continue
    const dotted = nativeImage.createFromBitmap(withDot(bitmap, side, side), { width: side, height: side, scaleFactor })
    attention.addRepresentation({ scaleFactor, buffer: dotted.toPNG() })
  }
  if (normal.isTemplateImage()) attention.setTemplateImage(true)
  return { normal, attention: attention.isEmpty() ? normal : attention }
}

function showWindow(): void {
  if (window) {
    window.show()
    window.focus()
    return
  }
  window = new BrowserWindow({
    width: 1195,
    height: 675,
    minWidth: 900,
    minHeight: 558,
    title: 'Dayflow Electron',
    // The theme's base colour, so the window does not flash before the page paints.
    backgroundColor: windowBackground(uiStyle, nativeTheme.shouldUseDarkColors),
    icon: join(app.getAppPath(), 'resources/icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(here, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true
    }
  })
  window.on('close', (e) => {
    if (!quitting) {
      e.preventDefault()
      window?.hide()
    }
  })
  window.on('closed', () => {
    window = null
  })
  window.on('focus', () => onWindowFocus?.(true))
  window.on('blur', () => onWindowFocus?.(false))
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  // The window only ever shows the app: a link that would replace it opens in the browser instead.
  window.webContents.on('will-navigate', (event, url) => {
    if (url === window?.webContents.getURL()) return
    event.preventDefault()
    if (/^https?:/.test(url)) void shell.openExternal(url)
  })
  // The page sets its theme and language from the query before React renders, so it does not flash the other look.
  const query = { uiStyle, lang: currentLanguage() }
  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}?${new URLSearchParams(query)}`)
  else void window.loadFile(join(here, '../renderer/index.html'), { query })
}
