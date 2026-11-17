import { type LinuxOptions, linuxPlatform } from './linux'
import type { Platform } from './types'

/** A platform without capture: every start fails with `message` (Windows and macOS come later). */
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
    setAutostart: () => Promise.reject(new Error(message))
  }
}

export function createPlatform(opts: LinuxOptions): Platform {
  if (process.platform !== 'linux') {
    return unsupportedPlatform(process.platform, `Screen capture is not implemented for ${process.platform} yet.`)
  }
  try {
    return linuxPlatform(opts)
  } catch (err) {
    return unsupportedPlatform('linux', err instanceof Error ? err.message : String(err))
  }
}
