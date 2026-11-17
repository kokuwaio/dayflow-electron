# dayflow-electron

A cross-platform reimplementation of [Dayflow](https://github.com/JerryZLiu/Dayflow)
in Electron and TypeScript. It takes a screenshot of the screen under the mouse
every few seconds, sends 15-minute batches to the AI provider you choose, and
turns them into a timeline of what you did. Nothing leaves your computer except
what goes to that provider.

Status: Linux / Wayland, packaged as a Flatpak. The timeline (M1, M2), the
Daily and Weekly tabs and notifications (M3) work; chat, agent access and
release packaging are next. "dayflow-electron" is a working name.

## Documentation

| Document | What |
| --- | --- |
| [docs/usage.md](docs/usage.md) | Install, providers, local models with Ollama, Claude Code and Codex, the tabs, blocked apps, troubleshooting |
| [docs/architecture.md](docs/architecture.md) | How the app works, with diagrams |
| [docs/roadmap.md](docs/roadmap.md) | Every upstream feature mapped to a milestone, with what is done |
| [docs/platform-notes.md](docs/platform-notes.md) | What was tested on which Linux desktop, and why |
| [docs/release.md](docs/release.md) | Publishing a release and the Flathub submission |

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
```

Set `DAYFLOW_DATA_DIR` to keep development data apart from a real install.

Checks:

```sh
make check          # typecheck, Vitest, golangci-lint and the Go tests
```

`make help` lists all targets.

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
| `src/main/` | Electron main process: capture, analysis, providers, SQLite store, Daily standup, notifications, platform interface |
| `src/renderer/` | React UI: Timeline, Daily, Weekly, Settings, onboarding |
| `src/shared/` | Pure logic used by both: 4 AM days, categories, Daily and Weekly math, export |
| `helper/linux/` | Go helper for Linux desktop access: ScreenCast portal + PipeWire, lock/sleep/idle, focused window, autostart |
| `flatpak/` | Flatpak manifest and desktop file |

[docs/architecture.md](docs/architecture.md) shows how the parts work together.

## License

MIT. Prompts and the data model come from upstream Dayflow and from
dayflow-windows; see [NOTICE.md](NOTICE.md).
