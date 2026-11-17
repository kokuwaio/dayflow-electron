import { describe, expect, it, vi } from 'vitest'
import { SCREEN_SETTINGS_URL, darwinPlatform } from './darwin'
import type { ElectronApis } from './electron-apis'

function fakeElectron(status: string) {
  return {
    app: { setLoginItemSettings: vi.fn() },
    desktopCapturer: { getSources: vi.fn().mockResolvedValue([]) },
    screen: { getCursorScreenPoint: vi.fn(), getAllDisplays: vi.fn() },
    powerMonitor: { on: vi.fn(), removeListener: vi.fn(), getSystemIdleTime: vi.fn() },
    systemPreferences: { getMediaAccessStatus: vi.fn().mockReturnValue(status) },
    shell: { openExternal: vi.fn().mockResolvedValue(undefined) }
  }
}

describe('darwin screen access', () => {
  it('reports the Screen Recording permission', () => {
    expect(darwinPlatform({ electron: fakeElectron('granted') as unknown as ElectronApis }).screenAccess()).toBe('granted')
    for (const status of ['not-determined', 'denied', 'restricted', 'unknown']) {
      expect(darwinPlatform({ electron: fakeElectron(status) as unknown as ElectronApis }).screenAccess()).toBe('not-granted')
    }
  })

  it('asks macOS (which lists the app) and opens the Screen Recording settings', async () => {
    const electron = fakeElectron('not-determined')
    await darwinPlatform({ electron: electron as unknown as ElectronApis }).requestScreenAccess()
    expect(electron.desktopCapturer.getSources).toHaveBeenCalledOnce()
    expect(electron.shell.openExternal).toHaveBeenCalledWith(SCREEN_SETTINGS_URL)
  })

  it('opens the settings even when the capture attempt fails', async () => {
    const electron = fakeElectron('denied')
    electron.desktopCapturer.getSources.mockRejectedValue(new Error('denied'))
    await darwinPlatform({ electron: electron as unknown as ElectronApis }).requestScreenAccess()
    expect(electron.shell.openExternal).toHaveBeenCalledWith(SCREEN_SETTINGS_URL)
  })

  it('does nothing once granted', async () => {
    const electron = fakeElectron('granted')
    await darwinPlatform({ electron: electron as unknown as ElectronApis }).requestScreenAccess()
    expect(electron.desktopCapturer.getSources).not.toHaveBeenCalled()
    expect(electron.shell.openExternal).not.toHaveBeenCalled()
  })
})
