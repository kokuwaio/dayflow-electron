# Installation

Every [GitHub release](https://github.com/kokuwaio/dayflow-electron/releases)
carries the packages below. `<version>` is the release tag, e.g. `v1.2.0`;
`SHA256SUMS` lists the checksum of every file. The other files of a release
(`latest.yml`, `latest-mac.yml`, the `.zip` and `.blockmap` files) are for
[updates](#updates). The app runs from the tray:
closing the window keeps it recording; quit from the tray.

| System | Package | File |
| --- | --- | --- |
| Linux x86_64 / ARM64 | Flatpak bundle | `dayflow-electron-<version>-x86_64.flatpak`, `-aarch64.flatpak` |
| Windows x64 / ARM64 | Installer | `dayflow-electron-<version>-win-x64.exe`, `-win-arm64.exe` |
| macOS Apple silicon / Intel | Disk image | `dayflow-electron-<version>-mac-arm64.dmg`, `-mac-x64.dmg` |

After installing, [usage.md](usage.md) covers the first start, choosing an AI
provider and everything else.

## Linux

### Flatpak bundle

Needs Flatpak and the Flathub remote, which provides the runtime the bundle
uses (`org.freedesktop.Platform` 25.08 with the Electron base app):

```sh
flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
flatpak install --user dayflow-electron-<version>-x86_64.flatpak
flatpak run io.github.kokuwaio.DayflowElectron
```

Use the `-aarch64.flatpak` file on ARM64 machines. A newer bundle installs
over the old one; your data stays in
`~/.var/app/io.github.kokuwaio.DayflowElectron/`.

Two permissions are opt-in, because the default sandbox doesn't grant them:

| What | Command | Needed for |
| --- | --- | --- |
| Window detection (KDE) | `flatpak override --user --talk-name=org.kde.KWin io.github.kokuwaio.DayflowElectron` | blocked apps, private windows |
| Programs on the host | `flatpak override --user --talk-name=org.freedesktop.Flatpak io.github.kokuwaio.DayflowElectron` | Claude Code and Codex as AI providers, registering the MCP server |

Remove it with
`flatpak uninstall --user io.github.kokuwaio.DayflowElectron`; add
`--delete-data` to remove the recordings and database too.

### From source

Needs Node.js 24, Go 1.27, `flatpak-builder` and the Flatpak SDK
`org.freedesktop.Sdk//25.08`:

```sh
git clone https://github.com/kokuwaio/dayflow-electron.git
cd dayflow-electron
make install
make flatpak
flatpak run io.github.kokuwaio.DayflowElectron
```

`make flatpak` builds the app and the helper and installs the Flatpak for
your user; `make dev` starts it without packaging, with hot reload.

## Windows

Download `dayflow-electron-<version>-win-x64.exe` (or `-win-arm64.exe` on ARM
devices) and run it. It installs for your user only, without administrator
rights, and asks for the folder. Later versions install themselves (see
[Updates](#updates)); an installer run by hand also installs over the old
version.

The installer isn't signed yet, so SmartScreen warns about an unknown
publisher: click **More info**, then **Run anyway**.

Your data lives in `%APPDATA%\dayflow-electron` and survives uninstalling
(Settings → Apps → dayflow-electron → Uninstall); delete that folder to
remove it too.

## macOS

### Disk image

Download `dayflow-electron-<version>-mac-arm64.dmg` (Apple silicon) or
`-mac-x64.dmg` (Intel), open it and drag the app into **Applications**.
macOS 12 or later.

### First start

The app is not signed with an Apple Developer ID or notarized yet, so macOS
refuses the first start. Either open it once,
then click **Open Anyway** under **System Settings → Privacy & Security**, or
run:

```sh
xattr -dr com.apple.quarantine /Applications/dayflow-electron.app
```

Then allow **Screen Recording** for dayflow-electron under **System Settings →
Privacy & Security → Screen Recording**, and quit and reopen the app. Until it
is signed, macOS may ask for this permission again after an update.

Your data lives in `~/Library/Application Support/dayflow-electron`.

## Updates

| Package | How it updates |
| --- | --- |
| Flatpak | Through Flatpak: install the newer bundle over the old one (later from a Flatpak repository, with `flatpak update`). The app does not update itself. |
| Windows | The app checks GitHub Releases at start and every 6 hours, downloads a newer version in the background and installs it the next time you quit. The tray menu then offers **Restart to update to …**, and a notification says the update is ready. |
| macOS | Same as Windows once the app is signed with an Apple Developer ID. Until then macOS won't let it replace itself: it only tells you that a version is out (notification and **Get version …** in the tray), and you install the new disk image by hand. |

**Settings → Other → Install updates automatically** (on by default) turns
the background download off: the app then only tells you about a new version,
and the tray menu offers **Download version …**. Builds from a branch
(`0.0.0-...`) never update.

## The command-line tool

Agent access (the `dayflow` CLI and its MCP server) ships inside every
package. **Settings → MCP / CLI** shows the command that adds `dayflow` to
`~/.local/bin` on Linux and macOS, and connects Claude Code, Codex, Claude
Desktop, Cursor, VS Code or other MCP clients; [usage.md](usage.md) explains
the commands.

## Which version is installed

The Settings sidebar shows the version. Release builds carry the tag
(`1.2.0`); builds from a branch show `0.0.0-<branch>.<commit>`.
