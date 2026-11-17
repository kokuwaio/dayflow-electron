import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type ElectronApis, createPlatform } from './index'

/** Electron stand-ins: creating a platform must not touch them yet. */
const electron = {
  app: { setLoginItemSettings: vi.fn() },
  desktopCapturer: { getSources: vi.fn() },
  screen: { getCursorScreenPoint: vi.fn(), getAllDisplays: vi.fn() },
  powerMonitor: { on: vi.fn(), removeListener: vi.fn(), getSystemIdleTime: vi.fn() },
  systemPreferences: { getMediaAccessStatus: vi.fn() }
} as unknown as ElectronApis

const opts = {
  appPath: '/nonexistent/app',
  resourcesPath: '/nonexistent/resources',
  tokenFile: '/nonexistent/token',
  launchCommand: ['/opt/dayflow/dayflow-electron'],
  electron
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('createPlatform', () => {
  it('picks the Electron-based platform on Windows and macOS without starting anything', () => {
    expect(createPlatform(opts, 'win32').name).toBe('win32')
    expect(createPlatform(opts, 'darwin').name).toBe('darwin')
    for (const fn of Object.values(electron).flatMap((api) => Object.values(api as object))) {
      expect(fn).not.toHaveBeenCalled()
    }
  })

  it('keeps the Go helper on Linux and reports a missing helper through capture', async () => {
    vi.stubEnv('DAYFLOW_HELPER', '/nonexistent/helper')
    const platform = createPlatform(opts, 'linux')
    expect(platform.name).toBe('linux')
    const failed: string[] = []
    platform.startCapture({ dir: '/f', intervalSec: 10, height: 720 }, { frame() {}, skipped() {}, failed: (m) => failed.push(m) })
    await vi.advanceTimersByTimeAsync(0)
    expect(failed).toEqual(['dayflow-linux-helper not found; build it with "npm run helper"'])
  })

  it('reports other systems as unsupported', async () => {
    const platform = createPlatform(opts, 'freebsd')
    expect(platform.name).toBe('freebsd')
    const failed: string[] = []
    const unavailable: string[] = []
    platform.startCapture({ dir: '/f', intervalSec: 10, height: 720 }, { frame() {}, skipped() {}, failed: (m) => failed.push(m) })
    platform.watchActiveWindow({ window() {}, unavailable: (r) => unavailable.push(r) })
    await vi.advanceTimersByTimeAsync(0)
    expect(failed).toEqual(['Screen capture is not supported on freebsd.'])
    expect(unavailable).toEqual(['Screen capture is not supported on freebsd.'])
    await expect(platform.setAutostart(true)).rejects.toThrow('not supported on freebsd')
  })
})
