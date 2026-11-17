// Database backups and recovery, after upstream Dayflow
// (Core/Recording/StorageManager+Maintenance.swift): a daily copy, the newest
// three kept, and a damaged database replaced by the newest copy on start.

import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { Store } from './store'

const KEEP = 3
const PREFIX = 'dayflow-'
const pad = (n: number) => String(n).padStart(2, '0')
const stamp = (d: Date) =>
  `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`

/** Backups in `dir`, newest first (the timestamp in the name sorts). */
export function listBackups(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.startsWith(PREFIX) && f.endsWith('.sqlite'))
    .sort()
    .reverse()
    .map((f) => join(dir, f))
}

/** Writes dayflow-<timestamp>.sqlite into `dir` and drops all but the newest three. */
export async function backupDatabase(store: Store, dir: string, now = new Date()): Promise<string> {
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${PREFIX}${stamp(now)}.sqlite`)
  // Written under a temporary name and renamed when complete, so an interrupted
  // backup is never taken for the newest one.
  const partial = `${path}.partial`
  try {
    await store.backupTo(partial)
    renameSync(partial, path)
  } finally {
    rmSync(partial, { force: true })
  }
  for (const old of listBackups(dir).slice(KEEP)) rmSync(old, { force: true })
  return path
}

/** SQLITE_CORRUPT (11) and SQLITE_NOTADB (26), possibly as extended codes. */
function isCorruption(err: unknown): boolean {
  const code = (err as { errcode?: unknown } | null)?.errcode
  return typeof code === 'number' && [11, 26].includes(code & 0xff)
}

/** Opens the database; if it is damaged, keeps it aside as .corrupt-<timestamp> and restores the newest backup. */
export function openWithRecovery(path: string, backupDir: string): { store: Store; restoredFrom: string | null } {
  try {
    const store = Store.open(path)
    if (store.isHealthy()) return { store, restoredFrom: null }
    store.close()
  } catch (err) {
    // Only a damaged file is replaced; a busy database or any other startup
    // error must not cost the live database and its recent changes.
    if (!isCorruption(err)) throw err
  }
  const newest = listBackups(backupDir)[0]
  if (!newest) return { store: Store.open(path), restoredFrom: null }
  const aside = `${path}.corrupt-${stamp(new Date())}`
  if (existsSync(path)) renameSync(path, aside)
  for (const suffix of ['-wal', '-shm']) rmSync(`${path}${suffix}`, { force: true })
  copyFileSync(newest, path)
  return { store: Store.open(path), restoredFrom: newest }
}
