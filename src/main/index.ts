import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFile } from 'node:fs/promises'
import { BrowserWindow, Menu, Tray, app, clipboard, dialog, ipcMain, nativeImage, shell } from 'electron'
import { dayKey, dayRange, shiftDay, todayKey } from '../shared/day'
import { needsApiKey } from '../shared/providers'
import { PAUSE_PRESETS, describeRecorder } from '../shared/status'
import { renamedCategories } from '../shared/categories'
import { type StandupDraft, accessProgress } from '../shared/daily'
import type { FrameRef } from '../shared/media'
import { type GoalPlan, defaultGoalPlan } from '../shared/day-summary'
import { exportFileName, rangeMarkdown, timelineText, weekText } from '../shared/export'
import { weekOf } from '../shared/week'
import { WEEKLY_MIN_TRACKED_MINUTES, trackedMinutes } from '../shared/weekly'
import type { AppStatus, CardEdit, CliName, ProviderKind, Rating, Settings, StandupEntry, Tab } from '../shared/types'
import type { Span } from './db/store'
import { Pipeline } from './analysis/pipeline'
import { Recorder } from './capture/recorder'
import { Store } from './db/store'
import { frameUrl } from '../shared/media'
import { AUTO_MIN_MINUTES, MANUAL_MIN_MINUTES, generateStandup, standupSourceDay } from './insights/daily'
import { handleMedia, registerMediaScheme } from './media'
import { createNotifier } from './notifications'
import { createPlatform } from './platform'
import { createProvider } from './providers'
import { findCli, hostAccess, nodeRunner } from './providers/cli/host'
import { selectFramesToPurge } from './retention'
import { SettingsStore } from './settings'

const here = dirname(fileURLToPath(import.meta.url))
const startHidden = process.argv.includes('--hidden')
registerMediaScheme()
// Separate data for development and tests.
if (process.env.DAYFLOW_DATA_DIR) app.setPath('userData', process.env.DAYFLOW_DATA_DIR)

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showWindow())
  app.whenReady().then(main).catch((err) => {
    console.error('startup failed', err)
    app.exit(1)
  })
}

let window: BrowserWindow | null = null
const changed = () => window?.webContents.send('cards:changed')
let tray: Tray | null = null
let quitting = false

const log = (message: string) => console.log(`[dayflow] ${message}`)

async function main(): Promise<void> {
  const dataDir = app.getPath('userData')
  const recordingsDir = join(dataDir, 'recordings')
  mkdirSync(recordingsDir, { recursive: true })

  const settings = await SettingsStore.open(join(dataDir, 'settings.json'), join(dataDir, 'keys.json'))
  const store = Store.open(join(dataDir, 'dayflow.sqlite'))
  const platform = createPlatform({
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
    tokenFile: join(dataDir, 'screencast-restore-token'),
    launchCommand: app.isPackaged ? [process.execPath] : [process.execPath, app.getAppPath()]
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
    () => settings.get().blockedApps
  )

  const inFlatpak = !!process.env.FLATPAK_ID
  const cliEnv = { inFlatpak, home: homedir(), scratchDir: join(dataDir, 'cli-frames'), appId: process.env.FLATPAK_ID ?? '' }
  const providerFor = (kind: ProviderKind) => {
    const s = settings.get()
    return createProvider({ kind, model: s.models[kind], baseUrl: s.openaiBaseUrl }, settings.apiKey(kind), {
      cli: { ...cliEnv, runner: nodeRunner, paths: s.cliPaths }
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

  const pipeline = new Pipeline({
    store,
    providers: () => pipelineProviders(),
    language: () => settings.get().outputLanguage,
    overrides: () => settings.get().promptOverrides,
    categories: () => settings.get().categories,
    onCardsChanged: () => changed(),
    log
  })

  const purge = async () => {
    const limit = settings.get().storageLimitGb * 1024 ** 3
    const ids = selectFramesToPurge(store.storedFrames(), limit)
    for (const file of store.deleteScreenshots(ids)) await unlink(file).catch(() => {})
    if (ids.length) log(`purged ${ids.length} frames over the storage limit`)
  }

  const status = (): AppStatus => ({
    platform: platform.name,
    recorder: recorder.status(),
    analysis: pipeline.status(),
    keys: settings.hasKeys(),
    framesBytes: store.storedFrames().reduce((sum, f) => sum + f.bytes, 0)
  })

  // ---- IPC (see src/preload/index.ts)
  ipcMain.handle('day:get', (_e, day?: string) => {
    const key = day ?? dayKey(Math.floor(Date.now() / 1000))
    return { day: key, cards: store.cardsForDay(key), ratings: store.ratings(dayRange(key)) }
  })
  const daysWithCards = (days: string[]) => days.map((day) => ({ day, cards: store.cardsForDay(day) }))
  const daysBetween = (from: string, to: string) => {
    const days: string[] = []
    for (let d = from; d <= to; d = shiftDay(d, 1)) days.push(d)
    return days
  }
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
  /** One standup run per day at a time, shared by the scheduler and the Regenerate button (upstream isRunningCheck). */
  const standupRuns = new Map<string, Promise<StandupEntry>>()
  const writeStandup = (day: string, minMinutes: number): Promise<StandupEntry> => {
    const running = standupRuns.get(day)
    if (running) return running
    const run = generateStandup({ store, providers: configuredProviders(), target: day, language: settings.get().outputLanguage, minMinutes })
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
    if (!access().daily.unlocked || new Date().getHours() < 4 || store.standup(day) || standupRuns.has(day)) return
    if (configuredProviders().length === 0 || !standupSourceDay(store, day, AUTO_MIN_MINUTES)) return
    const attempts = settings.get().standupAttempts
    const tries = attempts.day === day ? attempts.count : 0
    if (tries >= 3) return
    await settings.save({ standupAttempts: { day, count: tries + 1 } })
    try {
      await writeStandup(day, AUTO_MIN_MINUTES)
      notifier.standupReady(day)
    } catch (err) {
      log(`standup failed: ${String(err)}`)
    }
  }
  setInterval(() => void scheduleStandup(), 5 * 60_000)
  void scheduleStandup()

  ipcMain.handle('access:get', () => access())
  ipcMain.handle('daily:get', (_e, day: string) => store.standup(day))
  ipcMain.handle('daily:generate', async (_e, day: string) => {
    try {
      return { ok: true, entry: await writeStandup(day, MANUAL_MIN_MINUTES) }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) }
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
    if (from > to) return { ok: false, message: 'Start must be on or before end.' }
    if (daysBetween(from, to).length > 3660) return { ok: false, message: 'Choose at most ten years.' }
    const target = await dialog.showSaveDialog({
      defaultPath: join(app.getPath('documents'), exportFileName(from, to)),
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    })
    if (target.canceled || !target.filePath) return { ok: false, message: 'Export canceled' }
    const days = daysWithCards(daysBetween(from, to))
    try {
      await writeFile(target.filePath, rangeMarkdown(days, { today: todayKey() }), 'utf8')
    } catch (err) {
      return { ok: false, message: `Couldn't save file: ${err instanceof Error ? err.message : String(err)}` }
    }
    const activities = days.reduce((n, d) => n + d.cards.length, 0)
    return { ok: true, message: `Saved to ${target.filePath}. Activities: ${activities}; days: ${days.length}.` }
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
    void pipeline.tick()
    return reset
  })
  ipcMain.handle('day:reprocess', (_e, day: string) => {
    const count = store.reprocessDay(day)
    changed()
    void pipeline.tick()
    return count
  })

  ipcMain.handle('status:get', () => status())
  ipcMain.handle('settings:get', () => settings.get())
  ipcMain.handle('settings:save', async (_e, next: Partial<Settings>) => {
    const before = settings.get()
    // Apply autostart first so a failure leaves the stored setting unchanged.
    if (next.launchAtLogin !== undefined && next.launchAtLogin !== before.launchAtLogin) {
      await platform.setAutostart(next.launchAtLogin)
    }
    // The window only edits preferences; the app's own bookkeeping is not its to change.
    const { notified: _n, standupAttempts: _a, onboarded: _o, ...preferences } = next
    const saved = await settings.save(preferences)
    // Cards follow renamed categories (matched by id after the names were cleaned up).
    const renames = renamedCategories(before.categories, saved.categories)
    for (const { from, to } of renames) store.renameCategory(from, to)
    if (renames.length) changed()
    if (saved.captureIntervalSec !== before.captureIntervalSec || saved.captureHeight !== before.captureHeight) {
      recorder.reconfigure(captureOptions(saved))
    }
    recorder.refreshBlocking()
    if (saved.storageLimitGb < before.storageLimitGb) await purge()
    return saved
  })
  ipcMain.handle('key:set', (_e, kind: ProviderKind, key: string) => settings.setApiKey(kind, key))
  ipcMain.handle('provider:test', async () => {
    try {
      const provider = currentProvider()
      const reply = await provider.generate({
        turns: [{ role: 'user', parts: [{ type: 'text', text: 'Reply with the single word OK.' }] }]
      })
      return { ok: true, message: `${reply.model} answered: ${reply.text.trim().slice(0, 80)}` }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) }
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
  ipcMain.handle('cli:check', async (_e, cli: CliName) => {
    const access = await hostAccess(nodeRunner, inFlatpak, cliEnv.appId)
    if (!access.ok) return { ok: false, message: access.reason }
    const configuredPath = settings.get().cliPaths[cli]
    const found = await findCli(nodeRunner, cli, { ...cliEnv, ...(configuredPath ? { configuredPath } : {}) })
    return found
      ? { ok: true, message: `Found ${found.path}. Click "Test connection" to check that you are logged in.` }
      : { ok: false, message: `Not found${configuredPath ? ` at ${configuredPath}` : ''}. Install it, or enter its full path.` }
  })
  ipcMain.handle('analysis:run', () => pipeline.tick())

  // ---- tray
  const updateTray = () => {
    if (!tray) return
    const r = recorder.status()
    const paused = r.state === 'paused'
    const description = describeRecorder(r.state, r.until)
    tray.setToolTip(`Dayflow: ${description}`)
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: description, enabled: false },
        { type: 'separator' },
        paused
          ? { label: 'Resume recording', click: () => (recorder.resume(), updateTray()) }
          : {
              label: 'Pause recording',
              submenu: PAUSE_PRESETS.map((p) => ({
                label: p.label,
                click: () => {
                  recorder.pause(p.seconds)
                  updateTray()
                }
              }))
            },
        { label: 'Open Dayflow', click: () => showWindow() },
        { label: 'Open recordings folder', click: () => void shell.openPath(recordingsDir) },
        { type: 'separator' },
        { label: 'Quit', click: () => app.quit() }
      ])
    )
  }
  tray = new Tray(nativeImage.createFromPath(join(app.getAppPath(), 'resources/tray.png')))
  tray.on('click', () => showWindow())

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
    const problem = pipeline.status().lastError
    if (problem && problem !== lastProblem) {
      const waiting = (store.pendingBatches().length + store.retryableBatches(0, 3).length) * 15
      notifier.providerProblem(problem, waiting)
    }
    lastProblem = problem
  }
  setInterval(() => {
    checkNotifications()
    const s = status()
    const key = JSON.stringify([s.recorder, s.analysis])
    if (key === lastStatus) return
    lastStatus = key
    updateTray()
    window?.webContents.send('status:changed', s)
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
    await settings.save({ onboarded: true })
    recorder.start()
    updateTray()
  })
  if (settings.get().onboarded) recorder.start()
  pipeline.start()
  updateTray()
  void purge()
  setInterval(() => void purge(), 3600_000)

  app.on('before-quit', () => {
    quitting = true
    recorder.stop()
    pipeline.stop()
    store.close()
  })
  // Closing the window keeps recording; quit from the tray.
  app.on('window-all-closed', () => {})

  if (!startHidden) showWindow()
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
    title: 'Dayflow',
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
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void window.loadFile(join(here, '../renderer/index.html'))
}
