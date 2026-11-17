# Installation

Every [GitHub release](https://github.com/kokuwaio/dayflow-electron/releases)
carries the packages below. `<version>` is the release tag, e.g. `v1.2.0`;
`SHA256SUMS` lists the checksum of every file. The app runs from the tray:
closing the window keeps it recording; quit from the tray.

| System | Package | File |
| --- | --- | --- |
| Linux x86_64 / ARM64 | Flatpak bundle | `dayflow-electron-<version>-x86_64.flatpak`, `-aarch64.flatpak` |
| Linux | Flathub | planned, see [below](#flathub) |
| Linux | Tarball (for packagers) | `dayflow-electron-<version>-linux-x86_64.tar.gz`, `-aarch64.tar.gz` |
| Windows x64 / ARM64 | Installer | `dayflow-electron-<version>-win-x64.exe`, `-win-arm64.exe` |
| macOS Apple silicon / Intel | Disk image | `dayflow-electron-<version>-mac-arm64.dmg`, `-mac-x64.dmg` |
| macOS | Homebrew cask | `brew install --cask kokuwaio/tap/dayflow-electron` |

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

### Flathub

Not published yet. The manifest is ready in `packaging/flatpak/flathub/`; the
submission needs a public repository and the app's own name and icon
([release.md](release.md#flathub)). Once it is on Flathub:
`flatpak install flathub io.github.kokuwaio.DayflowElectron`.

### Tarball

`dayflow-electron-<version>-linux-<arch>.tar.gz` holds the packaged app
(`linux-unpacked/`), the Go helper, the icon, the desktop file and the
AppStream metainfo. It is what the Flathub manifest builds from and a
starting point for other distribution packages. The app expects to run inside
the Flatpak sandbox (screen capture goes through the desktop portal), so use
it for packaging, not to run the app directly.

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
rights, and asks for the folder. Updates install over the old version.

The installer isn't signed yet, so SmartScreen warns about an unknown
publisher: click **More info**, then **Run anyway**.

Your data lives in `%APPDATA%\dayflow-electron` and survives uninstalling
(Settings → Apps → dayflow-electron → Uninstall); delete that folder to
remove it too.

## macOS

### Homebrew

```sh
brew install --cask kokuwaio/tap/dayflow-electron
```

`brew upgrade --cask dayflow-electron` updates it, `brew uninstall --cask
dayflow-electron` removes it, and `--zap` also removes your data. The cask
installs the disk image for your Mac's processor.

### Disk image

Download `dayflow-electron-<version>-mac-arm64.dmg` (Apple silicon) or
`-mac-x64.dmg` (Intel), open it and drag the app into **Applications**.
macOS 12 or later.

### First start

The app is not signed with an Apple Developer ID or notarized yet, so macOS
refuses the first start, whichever way you installed it. Either open it once,
then click **Open Anyway** under **System Settings → Privacy & Security**, or
run:

```sh
xattr -dr com.apple.quarantine /Applications/dayflow-electron.app
```

Then allow **Screen Recording** for dayflow-electron under **System Settings →
Privacy & Security → Screen Recording**, and quit and reopen the app. Until it
is signed, macOS may ask for this permission again after an update.

Your data lives in `~/Library/Application Support/dayflow-electron`.

## The command-line tool

Agent access (the `dayflow` CLI and its MCP server) ships inside every
package. **Settings → MCP / CLI** shows the command that adds `dayflow` to
`~/.local/bin` on Linux and macOS, and how to connect Claude Code, Codex or
other MCP clients; [usage.md](usage.md) explains the commands.

## Which version is installed

The Settings sidebar shows the version. Release builds carry the tag
(`1.2.0`); builds from a branch show `0.0.0-<branch>.<commit>`.
