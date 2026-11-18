import type { App, DesktopCapturer, PowerMonitor, Screen, Shell, SystemPreferences } from 'electron'

/**
 * The Electron modules the Windows and macOS platforms use. index.ts passes
 * them in, so the platform code never imports Electron itself and the tests
 * run without it.
 */
export interface ElectronApis {
  app: Pick<App, 'setLoginItemSettings'>
  desktopCapturer: Pick<DesktopCapturer, 'getSources'>
  screen: Pick<Screen, 'getCursorScreenPoint' | 'getAllDisplays'>
  powerMonitor: Pick<PowerMonitor, 'on' | 'removeListener' | 'getSystemIdleTime'>
  systemPreferences: Pick<SystemPreferences, 'getMediaAccessStatus'>
  shell: Pick<Shell, 'openExternal'>
}
