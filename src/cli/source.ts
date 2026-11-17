// Where the CLI finds the app's data, and the read side it works on. Reads
// open SQLite read-only (upstream Database.swift); categories and the "Allow
// edits" switch come from settings.json, which the app owns.

import { existsSync, readFileSync } from 'node:fs'
import { connect } from 'node:net'
import { join } from 'node:path'
import { type Category, sanitizeCategories } from '../shared/categories'
import { Store } from '../main/db/store'
import { agentSocketPath } from '../main/agent/bridge'

/** Electron's userData folder name: package.json "name". */
export const APP_DIR_NAME = 'dayflow-electron'

export interface AgentPaths {
  dataDir: string
  database: string
  settings: string
  socket: string
}

/**
 * The app's data folder as Electron's app.getPath('userData') finds it, with
 * the app's DAYFLOW_DATA_DIR override and upstream's DAYFLOW_DB override for
 * the database. Inside the Flatpak XDG_CONFIG_HOME points into ~/.var/app.
 */
export function agentPaths(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, home: string): AgentPaths {
  let dataDir = env.DAYFLOW_DATA_DIR
  if (!dataDir) {
    if (platform === 'darwin') dataDir = join(home, 'Library', 'Application Support', APP_DIR_NAME)
    else if (platform === 'win32') dataDir = join(env.APPDATA || join(home, 'AppData', 'Roaming'), APP_DIR_NAME)
    else dataDir = join(env.XDG_CONFIG_HOME || join(home, '.config'), APP_DIR_NAME)
  }
  return {
    dataDir,
    database: env.DAYFLOW_DB || join(dataDir, 'dayflow.sqlite'),
    settings: join(dataDir, 'settings.json'),
    socket: agentSocketPath(dataDir)
  }
}

export type ReadStore = Pick<Store, 'card' | 'cardsForDay' | 'cardsOverlapping' | 'searchCards' | 'standup' | 'captureStatus'>

/** What the read commands and tools see. */
export interface ReadSource {
  /** The database; throws NoDataError when the app has not recorded yet. */
  store(): ReadStore
  categories(): Category[]
  editsEnabled(): boolean
  /** True when the app answers on its socket (it only listens while edits are on). */
  appRunning(): Promise<boolean>
}

export class NoDataError extends Error {
  constructor() {
    super('No Dayflow data found. Open Dayflow and let it record for a bit.')
  }
}

function readSettings(file: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function fileSource(paths: AgentPaths): ReadSource {
  let store: Store | null = null
  return {
    store() {
      if (store) return store
      if (!existsSync(paths.database)) throw new NoDataError()
      store = Store.openReadOnly(paths.database)
      return store
    },
    // Fresh on every call, so a long-running MCP server sees changes made in the app.
    categories: () => sanitizeCategories(readSettings(paths.settings).categories),
    editsEnabled: () => readSettings(paths.settings).allowEdits === true,
    appRunning: () =>
      new Promise((resolve) => {
        if (!existsSync(paths.socket)) return resolve(false)
        const socket = connect(paths.socket)
        socket.setTimeout(1_000)
        const finish = (ok: boolean) => {
          socket.destroy()
          resolve(ok)
        }
        socket.on('connect', () => finish(true))
        socket.on('error', () => finish(false))
        socket.on('timeout', () => finish(false))
      })
  }
}
