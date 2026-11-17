// Windows through Electron: desktopCapturer for frames, powerMonitor for
// lock, sleep and idle, login items for autostart. The focused window comes
// from a long-running Windows PowerShell process calling user32 (no native
// module), after dayflow-windows (src/main/capture.js, MIT, see NOTICE.md).

import { win32 as winPath } from 'node:path'
import { startElectronCapture } from './electron-capture'
import type { ElectronApis } from './electron-apis'
import { watchPowerSession } from './power-session'
import { watchWindowProcess } from './window-process'
import type { Platform } from './types'

/**
 * Prints {"app": process name, "title": window title} whenever the focused
 * window changes. Checks twice a second, so a password manager that comes to
 * the front is blocked within about one capture interval. Exits once the app
 * closes its end of the pipe.
 */
export const WINDOW_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
# Without a console (hidden window) the encoding cannot be set; the output is ASCII anyway.
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch {}
try {
  Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class DayflowForeground {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
'@
} catch {
  [Console]::Out.WriteLine((@{ error = "user32 is not available: $($_.Exception.Message)" } | ConvertTo-Json -Compress))
  exit 1
}
$last = ''
$names = @{}
while ($true) {
  $hwnd = [DayflowForeground]::GetForegroundWindow()
  if ($hwnd -ne [IntPtr]::Zero) {
    $text = New-Object System.Text.StringBuilder ([DayflowForeground]::GetWindowTextLength($hwnd) + 1)
    [void][DayflowForeground]::GetWindowText($hwnd, $text, $text.Capacity)
    $processId = [uint32]0
    [void][DayflowForeground]::GetWindowThreadProcessId($hwnd, [ref]$processId)
    if (-not $names.ContainsKey($processId)) {
      if ($names.Count -gt 500) { $names.Clear() }
      try { $names[$processId] = [System.Diagnostics.Process]::GetProcessById([int]$processId).ProcessName } catch { $names[$processId] = '' }
    }
    $line = [ordered]@{ app = $names[$processId]; title = $text.ToString() } | ConvertTo-Json -Compress
    # JSON escapes for everything outside ASCII, so no console code page can garble titles.
    $line = [regex]::Replace($line, '[^\x00-\x7F]', { param($m) '\u{0:x4}' -f [int][char]$m.Value })
    if ($line -ne $last) {
      try { [Console]::Out.WriteLine($line); [Console]::Out.Flush() } catch { exit 0 }
      $last = $line
    }
  }
  Start-Sleep -Milliseconds 500
}
`

/** Windows PowerShell 5.1 ships with every Windows 10 and 11; the full path avoids a different powershell.exe on PATH. */
function powershellPath(): string {
  return winPath.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}

export interface Win32Options {
  electron: ElectronApis
  /** Program and arguments to start at login. */
  launchCommand: string[]
}

export function win32Platform(opts: Win32Options): Platform {
  const { app, desktopCapturer, screen, powerMonitor } = opts.electron
  return {
    name: 'win32',
    startCapture: (options, handlers) => startElectronCapture(options, handlers, { screen, desktopCapturer }),
    watchSession: (options, handlers) => watchPowerSession(options, handlers, powerMonitor),
    watchActiveWindow: (handlers) =>
      watchWindowProcess(
        {
          command: powershellPath(),
          args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', WINDOW_SCRIPT],
          name: 'The PowerShell window watcher'
        },
        handlers
      ),
    async setAutostart(enable) {
      const [path, ...args] = opts.launchCommand
      app.setLoginItemSettings({ openAtLogin: enable, path, args: [...args, '--hidden'] })
    }
  }
}
