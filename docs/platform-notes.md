# Platform notes

Findings from the M0 spike; its capture code became
[`helper/linux`](../helper/linux). Tested on 2026-11-17 on Manjaro,
KDE Plasma 6.7.5 (Wayland), KWin 6.7.5, xdg-desktop-portal 1.22.1, PipeWire
1.6.9, Electron 45.3.3, Flatpak 1.18.4 with the Freedesktop 25.08 runtime,
two 2560×1440 monitors.

## Decisions

- **Linux ships as a Flatpak.** One package for all distributions, and the
  portals know the app ID, so granted permissions are stored reliably.
- **Capture through the ScreenCast portal**, on every Wayland desktop. The
  user shares all screens once; the restore token skips the dialog on every
  later start. One code path for KDE, GNOME and wlroots.
- **Read frames with a small native PipeWire client** (cgo against
  `libpipewire` from the Freedesktop SDK), not GStreamer. `gst-launch` used
  about one full CPU core and exited when a stream vanished on lock; the
  native client uses under 1% CPU and restarts the session by itself.
- **Keep only the screen under the mouse**, like upstream. That's where the
  work happens. The portal's cursor metadata (`cursor_mode=4`) tells which
  stream has the mouse, so this needs no KWin access.
- **Pause capture while the screen is locked.** The compositor happily
  captures the lock screen otherwise.
- **One Go helper for Linux desktop access.** D-Bus with file descriptor
  passing would need a native Node module (`usocket`) rebuilt per Electron
  version. The Go helper (`godbus`, no cgo, static) prints JSON lines on
  stdout and speaks the Wayland wire protocol directly for idle detection.

## Results on KDE Wayland inside the Flatpak

| Need | How | Result |
| --- | --- | --- |
| Screenshot of the screen under the mouse | ScreenCast portal, all monitors, `persist_mode=2`, `cursor_mode=4` (metadata); native PipeWire client, one stream per monitor, 1 fps max, frame copied only when requested | Works. Dialog once; every later start (also after changing the cursor mode) restored the session in 10–25 ms with no dialog. |
| Which screen has the mouse | PipeWire cursor metadata: the stream whose cursor position lies inside its own bounds, newest update wins | Works, no KWin needed. 16 screen switches in a 15-minute run, all correct. |
| Which screen has the mouse (alternative) | KWin script: `workspace.screenAt(workspace.cursorPos)` on `cursorPosChanged` | Works, but needs `--talk-name=org.kde.KWin`. Kept only as the source for the active window. |
| Active app and window title | KWin script calling back over D-Bus | Works through Flatpak's D-Bus proxy. |
| Idle time | Wayland `ext-idle-notify-v1` | Works. Idle after the timeout, "resumed" on the first input. |
| Screen lock | D-Bus `org.freedesktop.ScreenSaver.ActiveChanged` | Works. Capture pauses on lock; on unlock the helper starts a new portal session (restored, no dialog) and frames resume about 3 s later. |
| Sleep | logind `PrepareForSleep` | Wired up, not yet tested. |
| API keys | Electron `safeStorage` | Works on the host (`kwallet6`); not yet tested inside Flatpak. |

Flatpak permissions needed: `--socket=wayland`,
`--talk-name=org.freedesktop.ScreenSaver`,
`--system-talk-name=org.freedesktop.login1`. Portals need no permission.
`--talk-name=org.kde.KWin` is only needed for the active window and becomes an
opt-in (`flatpak override --user --talk-name=org.kde.KWin <app-id>`).

## Capture runs

| Run | Length | CPU | Memory (RSS) | Frames |
| --- | --- | --- | --- | --- |
| GStreamer, 10 s interval | Stopped after 30 min: on lock a stream vanished and `pipewiresrc` failed with "target not found" | `gst-launch` ~19 CPU-minutes in 20 minutes, about one core | 96 MB | 154 frames, 420–500 KB each |
| Native PipeWire, 10 s interval | 15 min including lock, 2 min locked, unlock | Helper 4 CPU-seconds in 10 min (< 1%); KWin and PipeWire CPU unchanged | Helper 145–160 MB while capturing, 42 MB while paused; KWin +85 MB while streams are open | 73 frames, 144 KB average |
| Native PipeWire, 10 s interval | 60 min unattended, normal work, no dialog and no session restart | Helper 25 CPU-seconds per hour (0.7%); KWin and PipeWire unchanged | Helper flat at 157 MB from minute 10 to 60 (no leak) | 366 frames, 145 KB average, 53 MB per hour; 56 screen switches, all followed |

What happens on lock, as seen twice: capture pauses right away; about 70 s
later Plasma switches the monitors off, the streams fail ("no more input
formats") and the helper ends the session; on unlock it opens a new session
from the restore token and captures again within about 3 s.

## Rejected capture paths

### KWin ScreenShot2 (works outside Flatpak only)

`org.kde.KWin.ScreenShot2.CaptureActiveScreen` grabs the screen under the
mouse with no dialog at all (~20 ms), but only for executables named in a
`.desktop` file with
`X-KDE-DBUS-Restricted-Interfaces=org.kde.KWin.ScreenShot2`. KWin checks the
caller's real executable path, so from inside Flatpak it answers "The process
is not authorized to take a screenshot". No Flatpak permission changes that.

### Screenshot portal

`org.freedesktop.portal.Screenshot` with `interactive=false` asks once, stores
the permission and then takes ~300 ms per grab. But KDE always grabs all
screens as one PNG (5120×1440, ~600 KB) and saves it to `~/Pictures`; the
sandbox could not delete it again. Every 10 s that is 360 files an hour in the
user's pictures folder.

### Electron `desktopCapturer`

Goes through the same ScreenCast portal on Wayland but shows the picker on
every call and has no restore token, so it cannot capture periodically.

## Gotchas

- Portal stream `position` and `size` are D-Bus structs `(ii)`; godbus returns
  them as `[]interface{}`.
- Let `videoscale` derive the width from the stream's pixel aspect ratio and it
  overflows ("integer overflow"), producing 1080-pixel-high slivers. Set width
  and height explicitly.
- Inside Flatpak the process ID is always small and the same; a KWin script
  named after the PID collides with the leftover of a killed run. Use a fixed
  name and unload it before loading.
- KWin loads scripts from the host file system. Inside Flatpak only
  `$XDG_RUNTIME_DIR/app/$FLATPAK_ID` is shared with the host.
- Outside Flatpak, `org.freedesktop.host.portal.Registry.Register` refused our
  app ID when the process ran inside VS Code's snap ("Can't manually register
  a io.snapcraft application").
- Near a screen border both streams report a cursor position, each relative to
  its own screen and possibly just outside it. Only count positions inside the
  stream's bounds, or the active screen flaps every 250 ms.
- Copy the frame out of the PipeWire buffer only when one is due (every 10 s),
  not on every buffer; that keeps the helper's CPU under 1%.
- Building cgo inside the SDK works with the host's Go toolchain mounted in
  (`flatpak run --command=... --filesystem=...`); the Go SDK extension is not
  needed (see `helper/linux/Makefile`).
- `timeout` does not stop `flatpak run`; use `flatpak kill <app-id>` or signal
  the process inside.
- Electron from a VS Code terminal: unset `ELECTRON_RUN_AS_NODE`, which VS Code
  sets, or Electron starts as plain Node.

## Electron on Wayland

- `powerMonitor.getSystemIdleTime()` always returns 0. Not usable.
- `powerMonitor` never fires `lock-screen` / `unlock-screen`, but
  `getSystemIdleState()` returns `locked` while locked.
- `safeStorage` sync calls are deprecated in Electron 45; use the async ones.

## Still open

- Frame size: ~144 KB per JPEG from the native client, about 52 MB per hour at
  10 s. Store video segments like upstream, or keep JPEGs.
- Electron itself inside Flatpak (`org.electronjs.Electron2.BaseApp`),
  `safeStorage` there, and starting the helper from Electron.
- Sleep and resume.
- GNOME and wlroots: capture should work unchanged. The screen under the mouse
  and the active window need other sources (GNOME: a Shell extension; wlroots:
  `wlr-foreign-toplevel-management`); without them capture falls back to the
  first screen.
- X11, Windows and macOS were not tested in M0.
- Lock detection listens to `org.freedesktop.ScreenSaver` (KDE). GNOME
  signals through `org.gnome.ScreenSaver`, which the helper does not watch
  yet.
