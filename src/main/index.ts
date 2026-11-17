import { mkdirSync } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BrowserWindow, Menu, Tray, app, ipcMain, nativeImage, shell } from 'electron'
import { dayKey } from '../shared/day'
import { needsApiKey } from '../shared/providers'
import { PAUSE_PRESETS, describeRecorder } from '../shared/status'
import type { AppStatus, ProviderKind, Settings } from '../shared/types'
import { Pipeline } from './analysis/pipeline'
import { DEFAULT_CATEGORIES } from './analysis/prompt'
import { Recorder } from './capture/recorder'
import { Store } from './db/store'
import { createPlatform } from './platform'
import { createProvider } from './providers'
import { selectFramesToPurge } from './retention'
import { SettingsStore } from './settings'

const here = dirname(fileURLToPath(import.meta.url))
const startHidden = process.argv.includes('--hidden')
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

  const providerFor = (kind: ProviderKind) => {
    const s = settings.get()
    return createProvider({ kind, model: s.models[kind], baseUrl: s.openaiBaseUrl }, settings.apiKey(kind))
  }
  const currentProvider = () => providerFor(settings.get().provider)
  const usable = (kind: ProviderKind) => !needsApiKey(kind, settings.get().openaiBaseUrl) || !!settings.apiKey(kind)

  const pipeline = new Pipeline({
    store,
    providers: () => {
      const s = settings.get()
      const kinds = [s.provider, ...(s.fallbackProvider ? [s.fallbackProvider] : [])]
      for (const k of kinds.filter((k) => !usable(k))) log(`no API key for ${k}; skipping it`)
      const ready = kinds.filter(usable)
      return ready.length ? ready.map(providerFor) : `No API key set for ${s.provider}. Add one in Settings.`
    },
    language: () => settings.get().outputLanguage,
    categories: () => DEFAULT_CATEGORIES,
    onCardsChanged: () => window?.webContents.send('cards:changed'),
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
    return { day: key, cards: store.cardsForDay(key) }
  })
  ipcMain.handle('status:get', () => status())
  ipcMain.handle('settings:get', () => settings.get())
  ipcMain.handle('settings:save', async (_e, next: Partial<Settings>) => {
    const before = settings.get()
    // Apply autostart first so a failure leaves the stored setting unchanged.
    if (next.launchAtLogin !== undefined && next.launchAtLogin !== before.launchAtLogin) {
      await platform.setAutostart(next.launchAtLogin)
    }
    const saved = await settings.save(next)
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
  setInterval(() => {
    const s = status()
    const key = JSON.stringify([s.recorder, s.analysis])
    if (key === lastStatus) return
    lastStatus = key
    updateTray()
    window?.webContents.send('status:changed', s)
  }, 2_000)

  recorder.start()
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
