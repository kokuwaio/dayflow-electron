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
- **Named "Dayflow Electron", with artwork of its own.** The upstream code is
  MIT; its logo, icons, videos and illustrations stay out. The app credits
  upstream Dayflow and does not present itself as it. Identifiers use
  `dayflow-electron` (CLI, MCP server, data folder, file names).
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
| Secret masking (on by default) | `tesseract.js` (Tesseract in WebAssembly, Apache-2.0), `jpeg-js` (BSD-3-Clause) | No native module; the English model ships with the app |
| Secrets | Electron `safeStorage` | KWallet or Secret Service on Linux, Keychain on macOS, DPAPI on Windows |
| Packaging | Flatpak on Linux (`org.electronjs.Electron2.BaseApp`); `electron-builder` for NSIS and dmg | Flatpak is the only Linux package; capture is built for its sandbox |
| Tests | Vitest, Playwright for Electron | |

## Platform matrix

The parts that differ per OS. Everything else is plain Electron.

On Linux all of this lives in one Go helper that talks D-Bus and Wayland and
prints JSON lines (see [docs/platform-notes.md](platform-notes.md)). Windows
and macOS use Electron's APIs (`src/main/platform/win32.ts`, `darwin.ts`,
sharing `electron-capture.ts` and `power-session.ts`) plus one small script
each for the focused window; no native modules. Both are built and unit
tested in CI but not yet tried on real machines.

| Piece | Linux Wayland | Linux X11 | Windows | macOS |
| --- | --- | --- | --- | --- |
| Screenshot of the screen under the mouse | ScreenCast portal: all monitors shared once, restore token skips the dialog afterwards, native PipeWire client grabs frames, cursor metadata picks the screen under the mouse (tested in Flatpak on KDE) | `desktopCapturer` | `desktopCapturer` of the display under `screen.getCursorScreenPoint()` (done, after dayflow-windows) | Same as Windows (done); needs the Screen Recording permission, missing permission shows as a capture error |
| Active app and window title | KDE: KWin script over D-Bus (tested in Flatpak, opt-in permission). GNOME needs a Shell extension; wlroots has `wlr-foreign-toplevel-management`; otherwise the first screen | `_NET_ACTIVE_WINDOW` | user32 `GetForegroundWindow` from a long-running PowerShell process, process name as app ID (done, after dayflow-windows) | `NSWorkspace` frontmost app and `CGWindowListCopyWindowInfo` title from a long-running `osascript -l JavaScript` loop, bundle ID as app ID (done); titles need Screen Recording |
| Idle time | `ext-idle-notify-v1` (tested on KDE). Electron's `powerMonitor` always reports 0 on Wayland | `powerMonitor` | `powerMonitor.getSystemIdleTime()`, polled every 5 s (done) | same as Windows (done) |
| Lock and sleep | `org.freedesktop.ScreenSaver.ActiveChanged` (tested, including restart after unlock), logind `PrepareForSleep`. Capture must pause while locked | same | `powerMonitor` lock, unlock, suspend and resume events (done) | same as Windows (done) |
| Autostart | XDG autostart `.desktop` file | same | `setLoginItemSettings` with `--hidden` (done) | `setLoginItemSettings`; `wasOpenedAtLogin` starts it hidden (done) |
| Deep links `scheme://` | `.desktop` `MimeType=x-scheme-handler/...` | same | `setAsDefaultProtocolClient` | `CFBundleURLTypes` from electron-builder's `protocols`, `open-url` event |
| Packages | Flatpak | | NSIS installer per architecture (x64, arm64), unsigned | dmg per architecture (arm64, x64), ad-hoc signed |
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
      (default 10 s), 720p (default, upstream: 1080p) or 1080p, display under the cursor
      (upstream `Core/Recording/ScreenRecorder.swift`, `ActiveDisplayTracker.swift`).
      Linux: `helper/linux` (portal + PipeWire); Windows and macOS:
      `desktopCapturer` (`src/main/platform/electron-capture.ts`).
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
      with title, summary, detailed summary and category. The day view is
      upstream's 4 AM to 4 AM canvas at 168 px per hour, with a status card
      at the current slot; it moves to the new day after 4 AM.
- [x] Settings: provider and key, test connection, capture interval and
      resolution, storage limit, launch at login (Background portal in the
      Flatpak).
- [x] Retention: storage cap for frames (default 10 GB), hourly purge of the
      oldest frames.
- [x] Flatpak `io.github.kokuwaio.DayflowElectron` (`packaging/flatpak/`).

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
- [x] Onboarding permission rows with live state and Grant (upstream
      `ScreenRecordingPermissionView`, `SystemPermissionRow`): macOS Screen
      Recording with Quit and Reopen, Next off until granted; Linux opens the
      share dialog ahead of recording (helper `grant`) and checks window
      detection, with the Flatpak KWin command. Upstream's Accessibility row
      is left out: window titles come through Screen Recording.

### M3 Insights

- [x] Daily standup tab: activity grid, yesterday's highlights, today's
  priorities, blockers (upstream `Views/UI/DailyView*.swift`).
- [x] Weekly dashboard: donut, treemap, Sankey, focus and distraction heat
  map, context switches, workflow heat map. No AI needed; built from
  `timeline_cards` (upstream `Core/Weekly/`). Upstream's overview card, app
  interaction graph and highlights are not built yet.
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

- [x] CLI: `status`, `timeline`, `today`, `yesterday`, `card`, `daily`, `weekly`,
  `categories`, `goal set`, `search`, `link`/`unlink`, all with `--json`,
  reading SQLite read-only. Electron runs it in Node mode (`out/main/cli.js`);
  the Flatpak has `flatpak run --command=dayflow-electron-cli`. Exit code 6 for "app
  not running" (upstream reused 5).
- [x] `mcp` subcommand: stdio MCP server with the same tool names as upstream
  (`get_timeline`, `get_time_breakdown`, `search_activities`, ...).
- [x] Write tools go to the running app over a local socket that only listens
  while "Allow edits" is on; every write is logged to `agent-writes.log`.
- [x] Settings → MCP / CLI: connect Claude Code and Codex with their own
  `mcp add` command (or show it to copy without host access), a config
  snippet for other clients, the edits switch, and a `~/.local/bin` install
  command for the terminal.
- [x] One-click setup for Claude Desktop (config merge, through the host in
  the Flatpak), Cursor and VS Code (install links), and repairing stale
  registrations at launch (outside the Flatpak; not in development builds).
  The CLI's `ELECTRON_RUN_AS_NODE` travels in the entry's `env`, so the
  registrations work on Windows too.

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
- [x] Secret masking: rules from upstream `PIIMaskRules` on Tesseract OCR output,
  on by default and switchable in Settings → Privacy ("Hide secrets in
  screenshots"). Applied to the frames sent to the
  provider; files on disk stay as recorded. Ports the 7 passes that mask
  without the model (setup keys, password manager screens, labeled passwords,
  private key blocks, seed phrases, recovery codes, key prefixes); recovery
  codes need a rules-only stand-in for the model's one-time code guesses.
  Upstream's ML model is served from its paid backend and is out of reach, so
  recall is much lower (no cards, bank details, IDs or unlabeled passwords),
  and Tesseract misreads cost more. OCR takes 2-6 s per 1080p frame.
- [ ] Dark mode, app language, show/hide icons, pause presets (all but the
  app language done; dark mode follows the system, with upstream's dark
  palette; Settings → Other → Appearance picks dark (the default), light or
  the system setting).
- [x] Upstream's look: design tokens for light and dark, gradient window and
  translucent panel, icon sidebar, Figtree and Instrument Serif (bundled with
  their OFL texts), the 4 AM to 4 AM day canvas with hour axis and status
  card, the pause pill, the inspector card, Daily, Weekly and Chat surfaces,
  and Settings with a tab sidebar (upstream `Utilities/DayflowTheme.swift`,
  `Views/UI/**`). Upstream's artwork is replaced by Lucide icons and CSS.
- [x] Look, the rest: onboarding in upstream's flow (role chips, provider
  comparison table, setup wizard with a required test, permissions per
  platform, progress ring), the focus and distraction heat map in Weekly,
  the timeline review with its "Review cards" badge and the "Your review"
  card (upstream `TimelineReviewOverlay`, ratings in
  `timeline_review_ratings`), the daily goal pop-up with yesterday's review
  and its once-a-day prompt (upstream `DayGoalFlowView`), and the calendar
  popover. Left out: upstream's intro video, referral survey and personal
  goal step (analytics), particles and confetti on the ring, and per-chart
  PNG export.
- [x] Modern theme (not upstream): Settings → Other → Theme switches between
  upstream's look (Original) and Modern (the default), flat neutral greys with
  Inter (bundled with its OFL text), one indigo accent and 1px borders, in
  light and dark. `data-ui-style` on the root element switches the CSS
  tokens, the onboarding included; category colours stay as they are.
- [ ] Goal pop-up trigger: upstream checks at app level and switches to the
  timeline itself; here the check runs when today's day summary is shown
  (the app opens there, so it differs only when another tab is open at 4 AM).
- [x] Deep links: `dayflow-electron://start-recording` and `stop-recording`
  (aliases `start`, `resume`, `stop`, `pause`).
- [x] Database backups: a daily copy, the newest three kept, a damaged
  database restored from the newest copy on start, WAL checkpoints every 5
  minutes (upstream `StorageManager+Maintenance`).
- [ ] Packages: Flatpak on Linux (own repository first, Flathub once the
  permissions are settled; updates come through Flatpak), NSIS and dmg with
  `electron-updater` from GitHub Releases; signing for Windows and macOS.
  Done: Flatpak for x86_64 and aarch64, NSIS installers (x64, arm64) and dmg
  images (arm64, x64), all built in CI and attached to releases;
  `electron-updater` (check at start and every 6 hours, background download,
  "Install updates automatically" in Settings → Other, restart from the tray
  or a notification; unsigned macOS only notifies). Open: Windows and macOS
  signing and notarization (certificates needed, see
  [release.md](release.md#signing-windows-and-macos); macOS installs updates
  only once signed), a public repository (the updater downloads without a
  token), Homebrew and Flathub (prepared in a separate pull request), a macOS
  icon (needs 512 px artwork).
- [ ] Windows and macOS on real machines: capture, window detection, lock,
  idle, autostart and deep links are implemented and unit tested, not yet
  tried by hand.
- [x] Name: "Dayflow Electron"; CLI and MCP server `dayflow-electron`.
- [ ] Own icon and artwork. Bundled fonts only with their OFL license files.

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
