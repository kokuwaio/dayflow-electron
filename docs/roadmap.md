# Roadmap

A cross-platform (Linux, Windows, macOS) reimplementation of
[Dayflow](https://github.com/JerryZLiu/Dayflow) in Electron and TypeScript.
Linux on Wayland (KDE Plasma 6) is the first test platform.

The app takes a screenshot every few seconds, sends 15-minute batches to an AI
provider of the user's choice, and turns them into a timeline of activity
cards. Everything stays on the machine except what goes to the chosen provider.

This file maps every upstream feature to a milestone. Upstream paths are
relative to `Dayflow/Dayflow/` in the upstream repo. "dayflow-windows" means
[shawkatdidar/dayflow-windows](https://github.com/shawkatdidar/dayflow-windows),
a small MIT-licensed Electron port whose analysis loop and providers we reuse
(see [NOTICE.md](../NOTICE.md)).

## Ground rules

- **Feature parity with upstream's local features**, not with its hosted
  business. No account, billing, hosted AI, Flow, surveys or PostHog.
- **No telemetry by default.** Crash reporting, if added, is opt-in.
- **Own name and artwork before the first public release.** The upstream code
  is MIT, but the name "Dayflow", its logo, icons, videos and illustrations are
  not covered by that license. "dayflow-electron" is a working name only.
- **Keep upstream's data model.** Use the same table and column names
  (`timeline_cards`, `analysis_batches`, `screenshots`, ...) so prompts, the
  CLI and the MCP tools port with few changes.
- **Every OS-specific piece sits behind one interface** with an implementation
  per platform (`capture`, `activeWindow`, `idle`, `session`, `autostart`).

## Stack

| Concern | Choice | Notes |
| --- | --- | --- |
| Shell | Electron + TypeScript, `electron-vite` | |
| UI | React | Largest ecosystem for the dashboards and chat UI |
| Charts | Apache ECharts | Covers donut, treemap, Sankey and heatmap from upstream's Weekly view |
| Database | SQLite via Node's built-in `node:sqlite` (Electron 45 ships Node 24), WAL mode | No native module to rebuild per Electron version; real migrations (upstream has none) |
| Frame storage | JPEG files first, `ffmpeg` video segments later | Upstream stores HEVC segments at 1 fps |
| Timelapses, Gemini video | `ffmpeg` | Bundled or system binary |
| Secrets | Electron `safeStorage` | KWallet or Secret Service on Linux, Keychain on macOS, DPAPI on Windows |
| Packaging | Flatpak on Linux (`org.electronjs.Electron2.BaseApp`); `electron-builder` for NSIS and dmg | Flatpak is the only Linux package; capture is built for its sandbox |
| Tests | Vitest, Playwright for Electron | |

## Platform matrix

The parts that differ per OS. Everything else is plain Electron.

On Linux all of this lives in one Go helper that talks D-Bus and Wayland and
prints JSON lines (see [docs/platform-notes.md](platform-notes.md)).

| Piece | Linux Wayland | Linux X11 | Windows | macOS |
| --- | --- | --- | --- | --- |
| Screenshot of the screen under the mouse | ScreenCast portal: all monitors shared once, restore token skips the dialog afterwards, native PipeWire client grabs frames, cursor metadata picks the screen under the mouse (tested in Flatpak on KDE) | `desktopCapturer` | `desktopCapturer` (dayflow-windows) | `desktopCapturer` + Screen Recording permission |
| Active app and window title | KDE: KWin script over D-Bus (tested in Flatpak, opt-in permission). GNOME needs a Shell extension; wlroots has `wlr-foreign-toplevel-management`; otherwise the first screen | `_NET_ACTIVE_WINDOW` | user32 (dayflow-windows), later a native module instead of PowerShell | `NSWorkspace` via a small helper |
| Idle time | `ext-idle-notify-v1` (tested on KDE). Electron's `powerMonitor` always reports 0 on Wayland | `powerMonitor` | `powerMonitor` | `powerMonitor` |
| Lock and sleep | `org.freedesktop.ScreenSaver.ActiveChanged` (tested, including restart after unlock), logind `PrepareForSleep`. Capture must pause while locked | same | `powerMonitor` events | `powerMonitor` events |
| Autostart | XDG autostart `.desktop` file | same | `setLoginItemSettings` | `setLoginItemSettings` |
| Deep links `scheme://` | `.desktop` `MimeType=x-scheme-handler/...` | same | `setAsDefaultProtocolClient` | same |
| Tray | AppIndicator / StatusNotifierItem, plain menu items only | same | `Tray` | `Tray` |
| Agent socket | Unix socket in `$XDG_RUNTIME_DIR` | same | Named pipe | Unix socket |

Upstream stores no app or window metadata per frame; it relies on the model
reading the screenshots. The active window is therefore an extra: it improves
prompts and is required for "blocked apps", but the timeline works without it.

## Milestones

### M0 Capture spike (Linux first)

Prove the risky parts before building on them. Throwaway code is fine.

- [x] Capture the screen under the mouse from inside a Flatpak: ScreenCast
      portal, dialog once, restore token on every later start.
- [x] Find the screen under the mouse from PipeWire cursor metadata, so the
      Flatpak needs no KWin permission for capture.
- [x] Read the active window through a KWin script (also from Flatpak).
- [x] Native PipeWire client instead of GStreamer (one CPU core down to
      under 1%).
- [x] Lock: capture pauses, the session restarts by itself after unlock with
      no dialog.
- [x] Idle time: Electron reports 0 on Wayland; `ext-idle-notify-v1` works.
- [x] Lock detection through `org.freedesktop.ScreenSaver`.
- [x] `safeStorage` uses KWallet (host).
- [x] Rejected: KWin `ScreenShot2` (refused inside Flatpak), Screenshot portal
      (writes every grab to `~/Pictures`), `desktopCapturer` (picker on every
      call).
- [x] 1 hour of unattended capture in the Flatpak: 0.7% CPU, memory flat at
      157 MB, 53 MB of frames per hour.
- [ ] Sleep and resume.

**Done when:** 1 hour of unattended capture in the Flatpak on KDE Wayland
without any dialog, and the findings are in
[docs/platform-notes.md](platform-notes.md) (written).

### M1 Core loop (usable MVP)

Start from dayflow-windows' analysis loop, port to TypeScript, swap its
JSON-per-day store for SQLite.

- [x] Tray icon with pause/resume (presets 15/30/60 min and "until I resume"),
      open window, open recordings folder, quit. Closing the window keeps the
      app running.
- [x] Capture through the platform interface; interval 1/5/10/20/30/60 s
      (default 10 s), 720p or 1080p, display under the cursor
      (upstream `Core/Recording/ScreenRecorder.swift`, `ActiveDisplayTracker.swift`).
      Linux: `helper/linux` (portal + PipeWire); Windows and macOS report
      "not implemented yet".
- [x] Pause on lock and sleep; resume 5 s after wake or unlock; back off on
      capture errors (60/120/300/600 s). While idle, capture keeps running
      and tags each frame with the idle seconds, like upstream, so idle
      batches become Idle cards without a model call.
- [x] SQLite schema: `screenshots`, `analysis_batches`, `batch_screenshots`,
      `timeline_cards`, `llm_calls` (upstream `StorageManager.swift`).
- [x] Batching: 15-minute batches, split on gaps over 2 min, hold back the
      newest batch until it is full, skip batches under 5 min, 45-minute card
      lookback (upstream `BatchingConfig` in `Core/AI/LLMTypes.swift`). The
      newest batch is also released once 2 min pass without a frame, instead
      of waiting for the next frame.
- [x] Idle shortcut: write an "Idle" card without a model call when most of a
      batch was idle (upstream `Core/Analysis/IdleBatchClassifier.swift`).
- [x] Provider interface and three API providers, the defaults. They need only
      network access, so they work in the Flatpak sandbox as is:
  - Anthropic API through the official SDK, default `claude-opus-5-5` with
    server-side refusal fallbacks
  - Gemini API with up to 15 inline frames, default `gemini-4-hydrogen`
  - OpenAI-compatible, which also covers Ollama, LM Studio and OpenRouter
- [x] One-step card generation with upstream's prompt
      (`ClaudeTimelinePrompt.swift`), output validation (coverage, gaps,
      overlaps, 10-60 min cards) and up to two correction turns; failed
      batches get a "Processing failed" card and are retried after the next
      success (up to 3 times).
- [x] Timeline day view with date navigation (4 AM day boundary), card detail
      with title, summary, detailed summary and category.
- [x] Settings: provider and key, test connection, capture interval and
      resolution, storage limit, launch at login (Background portal in the
      Flatpak).
- [x] Retention: storage cap for frames (default 10 GB), hourly purge of the
      oldest frames.
- [x] Flatpak `io.github.kokuwaio.DayflowElectron` (`flatpak/`).

**Done when:** a full working day on Linux produces a sensible timeline with
each of the three providers.

### M2 Timeline parity

- [x] Week view (7-column grid), category filter bar (mute, reorder).
- [x] Categories: editor with name, color and description sent to the model;
      defaults Work, Personal, Distraction, Idle; role presets
      (upstream `Models/TimelineCategory.swift`).
- [x] Card actions: edit title and category, delete, thumbs up/down with
      feedback, retry a failed card, reprocess a day or batch.
- [x] Screenshot slideshow and timelapse player at 20x/40x/60x (plays the
      saved JPEGs; no `ffmpeg` needed).
- [x] App and site icons from the model's `appSites` (upstream
      `Core/Net/FaviconService.swift`, fetched at runtime, nothing bundled).
      Off by default and fetched from the sites themselves, not through
      Google's favicon service like upstream.
- [x] Day summary panel: focus vs. distraction, category donut, daily goal.
- [x] Copy timeline as text; export a date range as Markdown.
- [x] Two-step fallback (transcribe to `observations`, then cards) like
      upstream's local-model path: one small request per frame, segments,
      then summary, title and an optional merge into the previous card.
      Local servers (OpenAI-compatible on localhost) always use it; API
      providers fall back to it when their one-step cards keep failing
      validation. Primary and secondary provider with automatic failover;
      failed batches are retried after the next success (up to 3 times).
- [x] Optional CLI providers: Claude CLI (`claude -p`) and Codex CLI
      (`codex exec --json`), which use the user's subscription instead of an API
      key. In the Flatpak they run on the host through `flatpak-spawn --host`.
      The manifest does not request the needed `org.freedesktop.Flatpak`
      permission; the settings page detects whether it is granted and otherwise
      shows the one-time opt-in command
      (`flatpak override --user --talk-name=org.freedesktop.Flatpak <app-id>`).
- [ ] Gemini video upload via the Files API. Deferred: needs `ffmpeg` in the
      Flatpak to encode the video; inline frames work meanwhile.
- [x] Prompt overrides (title, summary, detailed blocks; one set for all
      providers).
- [x] Output-language setting for card text.
- [ ] Frames stored as video segments to cut disk use. Deferred with the
      Gemini video upload (needs `ffmpeg`); 720p JPEGs use about 25 MB per hour.
- [x] Onboarding: provider choice and setup with test, capture consent
      (portal on Linux, Screen Recording on macOS), categories preset.

### M3 Insights

- [x] Daily standup tab: activity grid, yesterday's highlights, today's
  priorities, blockers (upstream `Views/UI/DailyView*.swift`).
- [x] Weekly dashboard (focus heatmap still open): overview, donut, treemap, Sankey, focus heatmap,
  context switches, app interaction graph, highlights. No AI needed; built
  from `timeline_cards` (upstream `Core/Weekly/`).
- [x] Chat with your journal: streamed answers, tool calls for timeline and
  observations, inline charts from fenced `chart` blocks, history panel,
  memory (upstream `Core/AI/Chat*`, `ChatPromptBuilder.swift`). API providers
  get upstream's `fetchTimeline` and `fetchObservations` tools. CLI providers
  get the relevant timeline data in the prompt with all tools switched off;
  upstream instead lets the CLI query the database with
  `--dangerously-skip-permissions`, which we do not copy.
- [x] Desktop notifications: first cards ready, standup ready, weekly
  unlocked, and provider problems the user has to fix (once a day per kind,
  classified like upstream's `TimelineFailureClassifier`). Clicks open the
  matching tab.
- [x] Unlock thresholds like upstream: Daily after 5 h, Chat after 10 h, Weekly
  after 30 h of recorded data (upstream `Core/Access/`).
- [x] Day goals (`day_goals`, `day_goal_categories`; built in M2 with the day summary).

### M4 Agent access (CLI and MCP)

Port of upstream `tools/dayflow-cli` and `Core/AgentAccess/`.

- [ ] CLI: `status`, `timeline`, `today`, `yesterday`, `card`, `daily`, `weekly`,
  `categories`, `goal set`, `search`, all with `--json`, reading SQLite
  read-only.
- [ ] `mcp` subcommand: stdio MCP server with the same tool names as upstream
  (`get_timeline`, `get_time_breakdown`, `search_activities`, ...).
- [ ] Write tools go to the running app over a local socket that only listens
  while "Allow edits" is on.
- [ ] Settings page to register the MCP server with Claude Code, Claude Desktop,
  Codex, Cursor and VS Code.

### M5 Privacy, polish and release

- [x] Blocked apps (KDE): while a listed app is the focused window, the
      helper saves no frame and records a placeholder; fully blocked batches
      become a "Private" card without a model call, and models never see
      blocked frames. Defaults cover KeePassXC, KeePass, 1Password, Bitwarden
      and the Passbolt web app. Needs the opt-in KWin permission in the
      Flatpak; GNOME needs a Shell extension.
- [x] Private browser windows: Chrome incognito and Firefox private windows,
  detected from the window title with upstream's localized markers; on by
  default. Upstream's toolbar and URL checks need accessibility APIs (AT-SPI on
  Linux) and stay open, as do its site categories.
- [ ] Secret masking: rules from upstream `PIIMaskRules` on Tesseract OCR output,
  opt-in. Upstream's ML model is served from its paid backend and is out of
  reach.
- [ ] Dark mode, app language, show/hide icons, pause presets (all but the
  app language done; dark mode follows the system).
- [x] Deep links: `dayflow-electron://start-recording` and `stop-recording`
  (aliases `start`, `resume`, `stop`, `pause`).
- [x] Database backups: a daily copy, the newest three kept, a damaged
  database restored from the newest copy on start, WAL checkpoints every 5
  minutes (upstream `StorageManager+Maintenance`).
- [ ] Packages (Flatpak for x86_64 and aarch64 built in CI and attached to releases): Flatpak on Linux (own repository first, Flathub once the
  permissions are settled; updates come through Flatpak), NSIS and dmg with
  `electron-updater` from GitHub Releases; signing for Windows and macOS.
- [ ] Own name, icon and artwork. Bundled fonts only with their OFL license files.

### Later or never

| Upstream feature | Decision | Why |
| --- | --- | --- |
| Daily Brief (`Core/DailyBrief/`) | Later, optional | Experimental, Claude Code only, behind an allowlist upstream |
| Agents tab (`Views/UI/Agents/`) | Later, optional | Experimental; embeds an npm package |
| Flow focus sessions (`Core/Flow/`) | Never | A web app on upstream's paid backend |
| Privacy Shield ML model | Never | Model download needs a paid upstream plan; M5 covers a rules-only version |
| Account, billing, referrals | Never | Business layer of the hosted product |
| Surveys, PostHog analytics | Never | Telemetry |
| Sparkle updates, launch video | Never | Replaced by `electron-updater`; branded asset |
| Accessibility recorder (keystrokes, clicks) | Never by default | Off upstream too; high privacy risk |

## Open questions

1. Does the ScreenCast restore token survive app restarts on GNOME too, and
   where does GNOME tell us which screen has the mouse?
2. Is the active window worth the per-desktop effort on Wayland, given
   upstream works without it?
3. Project name, before the repo goes public.
4. Can our database stay readable by the upstream CLI (same schema), or do we
   diverge where upstream's ad-hoc migrations get in the way?
5. Settled: PipeWire cursor metadata finds the screen under the mouse, so
   `--talk-name=org.kde.KWin` is only an opt-in for the active window. API
   providers are the default; CLI providers are an opt-in through
   `flatpak override`.
