import { darwinPlatform } from './darwin'
import type { ElectronApis } from './electron-apis'
import { type LinuxOptions, linuxPlatform } from './linux'
import type { Platform } from './types'
import { win32Platform } from './win32'
import { errorMessage } from '../../shared/errors'

export type { ElectronApis } from './electron-apis'

export interface PlatformOptions extends LinuxOptions {
  /** Electron modules for the Windows and macOS platforms. */
  electron: ElectronApis
}

/** A platform without capture: every start fails with `message`. */
function unsupportedPlatform(name: string, message: string): Platform {
  return {
    name,
    startCapture(_options, handlers) {
      const timer = setTimeout(() => handlers.failed(message), 0)
      return { stop: () => clearTimeout(timer), setBlocked() {} }
    },
    watchSession() {
      return { stop() {} }
    },
    watchActiveWindow(handlers) {
      const timer = setTimeout(() => handlers.unavailable(message), 0)
      return { stop: () => clearTimeout(timer) }
    },
    setAutostart: () => Promise.reject(new Error(message)),
    screenAccess: () => 'not-granted',
    requestScreenAccess: () => Promise.reject(new Error(message))
  }
}

/** The platform for `os`: the Go helper on Linux, Electron APIs on Windows and macOS. */
export function createPlatform(opts: PlatformOptions, os: string = process.platform): Platform {
  switch (os) {
    case 'win32':
      return win32Platform({ electron: opts.electron, launchCommand: opts.launchCommand })
    case 'darwin':
      return darwinPlatform({ electron: opts.electron })
    case 'linux':
      try {
        return linuxPlatform(opts)
      } catch (err) {
        return unsupportedPlatform('linux', errorMessage(err))
      }
    default:
      return unsupportedPlatform(os, `Screen capture is not supported on ${os}.`)
  }
}
