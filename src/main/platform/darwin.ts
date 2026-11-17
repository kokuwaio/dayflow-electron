// macOS through Electron: desktopCapturer for frames (needs the Screen
// Recording permission), powerMonitor for lock, sleep and idle, login items
// for autostart. The focused app comes from NSWorkspace and its window title
// from CGWindowListCopyWindowInfo, read by a long-running
// `osascript -l JavaScript` loop through the Objective-C bridge (no native
// module, no Automation or Accessibility permission).

import { startElectronCapture } from './electron-capture'
import type { ElectronApis } from './electron-apis'
import { watchPowerSession } from './power-session'
import { watchWindowProcess } from './window-process'
import type { Platform } from './types'

export const SCREEN_PERMISSION_MESSAGE =
  'Screen Recording permission is missing. Allow dayflow-electron in System Settings → Privacy & Security → Screen Recording, then quit and reopen the app.'

export const WINDOW_PERMISSION_MESSAGE =
  'Window detection needs the Screen Recording permission (it reads window titles). Allow dayflow-electron in System Settings → Privacy & Security → Screen Recording, then quit and reopen the app.'

/**
 * Prints {"app": bundle ID, "title": front window title} whenever the focused
 * window changes. Running the run loop between checks keeps NSWorkspace's
 * frontmost app current. Window titles need the Screen Recording permission,
 * which osascript inherits from the app. Dies with the app (SIGPIPE).
 */
export const WINDOW_SCRIPT = String.raw`
ObjC.import('AppKit');
ObjC.import('CoreGraphics');
function emit(line) {
  var data = $(line + '\n').dataUsingEncoding($.NSUTF8StringEncoding);
  $.NSFileHandle.fileHandleWithStandardOutput.writeData(data);
}
function titleOf(pid) {
  // kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements, front to back.
  var list = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(1 | 16, 0))) || [];
  for (var i = 0; i < list.length; i++) {
    var w = list[i];
    if (w.kCGWindowOwnerPID === pid && w.kCGWindowLayer === 0) return w.kCGWindowName || '';
  }
  return '';
}
try {
  var last = '';
  for (;;) {
    var front = $.NSWorkspace.sharedWorkspace.frontmostApplication;
    if (!front.isNil()) {
      var app = ObjC.unwrap(front.bundleIdentifier) || ObjC.unwrap(front.localizedName) || '';
      var line = JSON.stringify({ app: app, title: titleOf(front.processIdentifier) });
      if (line !== last) {
        emit(line);
        last = line;
      }
    }
    $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(1));
  }
} catch (e) {
  emit(JSON.stringify({ error: 'Window detection failed: ' + e }));
}
`

/** The loop runs for hours; a fresh osascript now and then keeps bridged objects from piling up. */
const WINDOW_SCRIPT_RECYCLE_MS = 5 * 60_000

export interface DarwinOptions {
  electron: ElectronApis
}

export function darwinPlatform(opts: DarwinOptions): Platform {
  const { app, desktopCapturer, screen, powerMonitor, systemPreferences } = opts.electron
  const screenGranted = () => systemPreferences.getMediaAccessStatus('screen') === 'granted'
  let prompted = false

  /** Null when capture may run; asks macOS once to show its permission prompt. */
  const screenAccess = () => {
    if (screenGranted()) return null
    if (!prompted && systemPreferences.getMediaAccessStatus('screen') === 'not-determined') {
      prompted = true
      // The first capture attempt makes macOS ask and lists the app under Screen Recording.
      void desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } }).catch(() => {})
    }
    return SCREEN_PERMISSION_MESSAGE
  }

  return {
    name: 'darwin',
    startCapture: (options, handlers) => startElectronCapture(options, handlers, { screen, desktopCapturer, checkAccess: screenAccess }),
    watchSession: (options, handlers) => watchPowerSession(options, handlers, powerMonitor),
    watchActiveWindow: (handlers) =>
      watchWindowProcess(
        {
          command: '/usr/bin/osascript',
          args: ['-l', 'JavaScript', '-e', WINDOW_SCRIPT],
          name: 'The osascript window watcher',
          checkAccess: () => (screenGranted() ? null : WINDOW_PERMISSION_MESSAGE),
          recycleMs: WINDOW_SCRIPT_RECYCLE_MS
        },
        handlers
      ),
    async setAutostart(enable) {
      app.setLoginItemSettings({ openAtLogin: enable })
    }
  }
}
