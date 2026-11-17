import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { backupDatabase, listBackups, openWithRecovery } from './backup'
import { Store } from './store'

let dir: string
let backups: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dayflow-backup-'))
  backups = join(dir, 'backups')
})
const opened: Store[] = []
afterEach(() => opened.splice(0).forEach((s) => s.close()))
const keep = (s: Store) => (opened.push(s), s)

describe('database backups (upstream StorageManager+Maintenance)', () => {
  it('writes a dated copy and keeps the newest three', async () => {
    const store = keep(Store.open(join(dir, 'dayflow.sqlite')))
    store.insertScreenshot({ capturedAt: 100, filePath: '/a.jpg', fileSize: 1, idleSeconds: null })
    for (const day of [1, 2, 3, 4]) await backupDatabase(store, backups, new Date(2026, 10, day, 12))
    expect(readdirSync(backups).sort()).toEqual(['dayflow-20261102-120000.sqlite', 'dayflow-20261103-120000.sqlite', 'dayflow-20261104-120000.sqlite'])
    const copy = keep(Store.open(join(backups, 'dayflow-20261104-120000.sqlite')))
    expect(copy.unbatchedScreenshots(0)).toHaveLength(1)
  })

  it('restores the newest backup when the database is corrupt, keeping the broken file aside', async () => {
    const path = join(dir, 'dayflow.sqlite')
    const store = Store.open(path)
    store.insertScreenshot({ capturedAt: 100, filePath: '/a.jpg', fileSize: 1, idleSeconds: null })
    await backupDatabase(store, backups, new Date(2026, 10, 1, 12))
    store.close()
    writeFileSync(path, 'this is not a database'.repeat(500))

    const { store: recovered, restoredFrom } = openWithRecovery(path, backups)
    keep(recovered)
    expect(restoredFrom).toBe(join(backups, 'dayflow-20261101-120000.sqlite'))
    expect(recovered.unbatchedScreenshots(0)).toHaveLength(1)
    expect(readdirSync(dir).some((f) => f.startsWith('dayflow.sqlite.corrupt-'))).toBe(true)
  })

  it('opens a healthy database as it is', () => {
    const { store, restoredFrom } = openWithRecovery(join(dir, 'dayflow.sqlite'), backups)
    keep(store)
    expect(restoredFrom).toBeNull()
  })

  it('passes other open errors on without touching the files or the backups', async () => {
    const store = keep(Store.open(join(dir, 'dayflow.sqlite')))
    await backupDatabase(store, backups, new Date(2026, 10, 1, 12))
    const notADatabaseFile = join(dir, 'a-folder')
    mkdirSync(notADatabaseFile)
    expect(() => openWithRecovery(notADatabaseFile, backups)).toThrow()
    expect(readdirSync(dir).some((f) => f.includes('.corrupt-'))).toBe(false)
  })

  it('never lists a backup that is still being written', async () => {
    mkdirSync(backups, { recursive: true })
    writeFileSync(join(backups, 'dayflow-20261105-120000.sqlite.partial'), 'half')
    expect(listBackups(backups)).toEqual([])
  })
})
