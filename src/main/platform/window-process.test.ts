import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActiveWindow } from '../../shared/blocklist'
import { type SpawnFn, watchWindowProcess } from './window-process'

/** A child process whose output and exit the test drives by hand. */
class FakeChild extends EventEmitter {
  stdout = new PassThrough()
  stderr = new PassThrough()
  killed = false
  kill() {
    this.killed = true
    return true
  }
  /** Prints lines, then lets the readline interface see them. */
  async print(...lines: string[]) {
    for (const l of lines) this.stdout.write(l + '\n')
    await vi.advanceTimersByTimeAsync(0)
  }
  async exit(code: number | null) {
    this.stdout.end()
    this.stderr.end()
    await vi.advanceTimersByTimeAsync(0)
    this.emit('close', code)
  }
}

async function setup(checkAccess?: () => string | null, recycleMs?: number) {
  const children: FakeChild[] = []
  const spawned: Array<{ command: string; args: readonly string[] }> = []
  const spawn: SpawnFn = (command, args) => {
    spawned.push({ command, args })
    const child = new FakeChild()
    children.push(child)
    return child as unknown as ReturnType<SpawnFn>
  }
  const windows: ActiveWindow[] = []
  const unavailable: string[] = []
  const watch = watchWindowProcess(
    { command: 'watcher', args: ['-x'], name: 'The window watcher', spawn, checkAccess, recycleMs },
    { window: (w) => windows.push(w), unavailable: (r) => unavailable.push(r) }
  )
  await vi.advanceTimersByTimeAsync(0)
  return { children, spawned, windows, unavailable, watch }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('watchWindowProcess', () => {
  it('reports each window line the script prints', async () => {
    const { children, spawned, windows, watch } = await setup()
    expect(spawned).toEqual([{ command: 'watcher', args: ['-x'] }])
    await children[0]!.print('﻿{"app":"code","title":"notes.md"}\r', 'garbage', '{"app":"KeePassXC","title":"db"}')
    expect(windows).toEqual([
      { app: 'code', title: 'notes.md' },
      { app: 'KeePassXC', title: 'db' }
    ])
    watch.stop()
    expect(children[0]!.killed).toBe(true)
  })

  it('reports the script error as unavailable and restarts it after 10 s when it worked before', async () => {
    const { children, unavailable, watch } = await setup()
    await children[0]!.print('{"app":"code","title":""}', '{"error":"lost the desktop"}')
    await children[0]!.exit(1)
    expect(unavailable).toEqual(['lost the desktop'])
    await vi.advanceTimersByTimeAsync(10_000)
    expect(children).toHaveLength(2)
    watch.stop()
  })

  it('waits 5 minutes before retrying a script that never reported, and falls back to stderr', async () => {
    const { children, unavailable, watch } = await setup()
    children[0]!.stderr.write('powershell: cannot run scripts\n')
    await children[0]!.exit(1)
    expect(unavailable).toEqual(['powershell: cannot run scripts'])
    await vi.advanceTimersByTimeAsync(299_000)
    expect(children).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(children).toHaveLength(2)
    watch.stop()
  })

  it('names the exit code when the script said nothing', async () => {
    const { children, unavailable, watch } = await setup()
    await children[0]!.exit(3)
    expect(unavailable).toEqual(['The window watcher exited (3).'])
    watch.stop()
  })

  it('reports a program that cannot start', async () => {
    const { children, unavailable, watch } = await setup()
    children[0]!.emit('error', new Error('spawn watcher ENOENT'))
    await children[0]!.exit(null)
    expect(unavailable).toEqual(['spawn watcher ENOENT'])
    watch.stop()
  })

  it('does not start while access is missing, and checks again every minute', async () => {
    let access: string | null = 'Needs the Screen Recording permission.'
    const { children, unavailable, windows, watch } = await setup(() => access)
    await vi.advanceTimersByTimeAsync(0)
    expect(children).toHaveLength(0)
    expect(unavailable).toEqual(['Needs the Screen Recording permission.'])
    access = null
    await vi.advanceTimersByTimeAsync(60_000)
    expect(children).toHaveLength(1)
    await children[0]!.print('{"app":"com.apple.Terminal","title":"zsh"}')
    expect(windows).toEqual([{ app: 'com.apple.Terminal', title: 'zsh' }])
    watch.stop()
  })

  it('swaps in a fresh script after recycleMs without reporting a gap', async () => {
    const { children, unavailable, windows, watch } = await setup(undefined, 60_000)
    await children[0]!.print('{"app":"code","title":"a"}')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(children).toHaveLength(2)
    expect(children[0]!.killed).toBe(true)
    await children[0]!.exit(null)
    await children[1]!.print('{"app":"code","title":"b"}')
    expect(windows.map((w) => w.title)).toEqual(['a', 'b'])
    expect(unavailable).toEqual([])
    watch.stop()
    expect(children[1]!.killed).toBe(true)
  })

  it('stays quiet after stop', async () => {
    const { children, unavailable, watch } = await setup()
    watch.stop()
    await children[0]!.exit(null)
    await vi.advanceTimersByTimeAsync(600_000)
    expect(unavailable).toEqual([])
    expect(children).toHaveLength(1)
  })
})
