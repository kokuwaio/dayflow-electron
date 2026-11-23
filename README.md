# Dayflow Electron

**Dayflow Electron**: a cross-platform reimplementation of [Dayflow](https://github.com/JerryZLiu/Dayflow)
in Electron and TypeScript. It takes a screenshot of the screen under the mouse
every few seconds, sends 15-minute batches to the AI provider you choose, and
turns them into a timeline of what you did. Nothing leaves your computer except
what goes to that provider.

Status: Linux / Wayland, packaged as a Flatpak, in daily use. The timeline,
Daily, Weekly, chat, review and day goals, the `dayflow-electron` CLI and MCP
server for AI tools, and releases with auto-updates work; the roadmap lists
what is open. It is not affiliated with upstream Dayflow.

Windows (NSIS installer) and macOS (dmg) builds come from CI with capture,
window detection and autostart implemented, but are not yet tested on real
machines and not signed.

## Install

On Linux with [mise](https://mise.jdx.dev); the first start installs the app
as a Flatpak for your user and adds the Flathub remote for its runtime:

```sh
mise use -g github:kokuwaio/dayflow-electron
dayflow-electron
```

The Flatpak bundle by hand, the Windows installer and the macOS disk image:
[docs/installation.md](docs/installation.md).

## Screenshots

Invented data from `make screenshots`.

| Timeline | Daily |
| --- | --- |
| ![Timeline: a day of cards with targets and a day summary](https://github.com/user-attachments/assets/28edbcad-a9f1-402f-9dc2-7a431529da72) | ![Daily: activity grid and the standup](https://github.com/user-attachments/assets/454c9d7e-e563-4fc7-a29c-f4d4dd60ec89) |
| **Weekly** | **Chat** |
| ![Weekly: distribution, context shifts and highlights](https://github.com/user-attachments/assets/dc014dbd-d0f1-407b-af91-616e74a220ac) | ![Chat: an answer with a chart](https://github.com/user-attachments/assets/ffe4670a-3e51-42df-8a2f-1614417a9a21) |

## Documentation

| Document | What |
| --- | --- |
| [docs/installation.md](docs/installation.md) | Every package (Flatpak, Windows installer, macOS disk image) and building from source |
| [docs/usage.md](docs/usage.md) | Install on Linux, Windows and macOS, providers, local models with Ollama, Claude Code and Codex, the tabs, blocked apps, troubleshooting |
| [docs/architecture.md](docs/architecture.md) | How the app works, with diagrams |
| [docs/roadmap.md](docs/roadmap.md) | Every upstream feature mapped to a milestone, with what is done |
| [docs/platform-notes.md](docs/platform-notes.md) | What was tested on which Linux desktop, and why |
| [docs/release.md](docs/release.md) | Publishing a release, versions, Windows and macOS signing |

## Requirements

- Node.js 24 or later and npm
- Go 1.27 and golangci-lint 2 (for the Linux helper)
- `flatpak-builder`, `org.freedesktop.Sdk//25.08` and
  `org.electronjs.Electron2.BaseApp//25.08` (the helper builds inside the SDK
  because it links `libpipewire`)

## Development

```sh
make install        # npm ci
make helper         # builds helper/linux/bin/dayflow-linux-helper in the Flatpak SDK
make dev            # starts Electron with hot reload
make dev-clean      # the same with empty data, to go through the first-run setup again
```

Set `DAYFLOW_DATA_DIR` to keep development data apart from a real install.

Checks:

```sh
make check          # typecheck, Vitest, golangci-lint and the Go tests
```

`make help` lists all targets.

## Windows and macOS

```sh
make dist-win       # on Windows: NSIS installers for x64 and arm64 in dist/
make dist-mac       # on macOS: dmg images for arm64 and x64 in dist/
```

Neither needs the Go helper. CI tests on Windows and macOS on every pull
request and builds both installers on main, for every release, and for pull
requests that change the packaging; see [docs/release.md](docs/release.md)
for signing.

## Flatpak

```sh
make flatpak        # pack, build the helper, then flatpak-builder --user --install
flatpak run io.github.kokuwaio.DayflowElectron
```

On first start KDE (or GNOME) asks once which screens to share: choose all of
them and allow restoring. The app records only the screen under the mouse and
pauses while the screen is locked.

## Layout

| Path | What |
| --- | --- |
| `src/main/` | Electron main process: capture, analysis, providers, SQLite store, Daily standup, chat, agent access, updates, notifications, platform interface (Linux helper, Windows and macOS through Electron) |
| `src/renderer/` | React UI: Timeline, Daily, Weekly, Chat, Settings, onboarding; Modern and Original themes |
| `src/shared/` | Pure logic used by both: 4 AM days, categories, Daily and Weekly math, review, goals, export |
| `src/cli/` | The `dayflow-electron` CLI and MCP server |
| `helper/linux/` | Go helper for Linux desktop access: ScreenCast portal + PipeWire, lock/sleep/idle, focused window, autostart |
| `packaging/` | Flatpak manifest, desktop file and metainfo (`flatpak/`) |

[docs/architecture.md](docs/architecture.md) shows how the parts work together.

## License

MIT. Prompts and the data model come from upstream Dayflow and from
dayflow-windows; see [NOTICE.md](NOTICE.md).
