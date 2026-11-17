# dayflow-electron

A cross-platform reimplementation of [Dayflow](https://github.com/JerryZLiu/Dayflow)
in Electron and TypeScript. It takes a screenshot of the screen under the mouse
every few seconds, sends 15-minute batches to the AI provider you choose, and
turns them into a timeline of what you did. Nothing leaves your computer except
what goes to that provider.

Status: milestone M1 (core loop) on Linux / Wayland, packaged as a Flatpak.
See [ROADMAP.md](ROADMAP.md) for the plan and
[docs/platform-notes.md](docs/platform-notes.md) for what was tested on which
desktop. "dayflow-electron" is a working name.

## Requirements

- Node.js 24 or later and npm
- Go 1.27 (for the Linux helper)
- `flatpak-builder`, `org.freedesktop.Sdk//25.08` and
  `org.electronjs.Electron2.BaseApp//25.08` (the helper builds inside the SDK
  because it links `libpipewire`)

## Development

```sh
npm install
npm run helper      # builds helper/linux/bin/dayflow-linux-helper in the Flatpak SDK
npm run dev         # starts Electron with hot reload
```

Set `DAYFLOW_DATA_DIR` to keep development data apart from a real install.

Checks:

```sh
npm run typecheck
npm test            # Vitest: batching, idle, cards, store, recorder, providers, retention
npm run test:helper # Go tests for helper/linux
```

## Flatpak

```sh
npm run flatpak     # pack, build the helper, then flatpak-builder --user --install
flatpak run io.github.monotek.DayflowElectron
```

On first start KDE (or GNOME) asks once which screens to share: choose all of
them and allow restoring. The app records only the screen under the mouse and
pauses while the screen is locked.

## Local models (Ollama, LM Studio)

Choose **OpenAI-compatible** in Settings, set the base URL to
`http://localhost:11434/v1` (Ollama) and a vision model such as
`qwen3-vl:8b`, and leave the API key empty. Servers on localhost always use
the two-step path: one small request per screenshot, then short text-only
requests for the card, which small models handle far better than one large
request. Set the recording resolution to 720p to keep each request small.

## Layout

| Path | What |
| --- | --- |
| `src/main/` | Electron main process: capture (`capture/`), analysis (`analysis/`), providers (`providers/`), SQLite store (`db/`), platform interface (`platform/`) |
| `src/renderer/` | React UI: timeline and settings |
| `src/shared/` | Types and the 4 AM day helpers used by both |
| `helper/linux/` | Go helper for Linux desktop access: ScreenCast portal + PipeWire, lock/sleep/idle, autostart |
| `flatpak/` | Flatpak manifest and desktop file |

## License

MIT. Prompts and the data model come from upstream Dayflow and from
dayflow-windows; see [NOTICE.md](NOTICE.md).
