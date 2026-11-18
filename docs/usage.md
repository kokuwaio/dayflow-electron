# Using dayflow-electron

dayflow-electron takes a screenshot of the screen under your mouse every few
seconds, sends 15-minute batches to an AI model you choose, and turns them
into a timeline of what you did. This page covers setup and daily use on
Linux, Windows and macOS. See [platform-notes.md](platform-notes.md) for what
was tested on which Linux desktop.

## Install

[installation.md](installation.md) covers every package: the Flatpak on
Linux, the Windows installer, the macOS disk image, and
building from source. The app starts with a window and a tray icon. Closing
the window keeps it recording; quit from the tray.

## First start

A short setup runs first, in upstream's flow and the app's theme (Modern by
default): what you do for work (picks the categories), a table comparing the
ways to run the app (Claude or ChatGPT through their CLIs, the Anthropic API,
Gemini, an OpenAI-compatible endpoint or a local model), a setup wizard for
the one you pick with a connection test (**Skip for now** leaves it for
Settings), and what recording needs on your system. **Launch Dayflow
Electron** starts recording.

### Allow screen recording

The setup's last step, **Permissions**, shows one row per permission with
its state and a **Grant** button.

- **Linux:** **Screen sharing → Grant** opens your desktop's share dialog
  now. Pick **all screens** and allow **restoring the permission**, so the
  question does not come back; the row then shows **Allowed**. You can also
  go on without it: the dialog then comes up when recording starts. While
  it records, KDE shows its "screen is being shared" icon in the tray.
  **Window detection (optional)** checks whether the app sees the active
  window, which it needs to leave out blocked apps (see
  [Keep password managers out](#keep-password-managers-out)). In the
  Flatpak on KDE Plasma the row shows the `flatpak override` command to
  copy; it takes effect after a restart of the app, and **Settings →
  Privacy** then shows "Window detection works".
- **Windows:** nothing to allow.
- **macOS:** **Screen Recording → Grant** asks macOS for the permission and
  opens **System Settings → Privacy & Security → Screen Recording**. Turn on
  dayflow-electron there, then click **Quit and Reopen**: macOS applies the
  permission only to a new start, and the setup continues at this step.
  **Next** stays off until the permission is granted; **Skip for now**
  goes on without it. Until it is granted Settings shows "Screen Recording
  permission is missing" and the app retries every few minutes. Because
  the app is not signed with a Developer ID yet, macOS may ask again after
  each update.

The app keeps only the screen under the mouse and pauses while the screen is
locked or the computer sleeps.

## Choose an AI model

Open **Settings → Providers**. Your screenshots go only to the provider you
choose here. Each one needs a model, and the cloud providers need an API key,
which is stored in your keyring (KWallet or Secret Service).

| Provider | What to enter | Notes |
| --- | --- | --- |
| Anthropic | API key from console.anthropic.com; model, e.g. `claude-opus-5-5` | One request per 15 minutes with up to 15 screenshots |
| Gemini | API key from aistudio.google.com; model, e.g. `gemini-4-hydrogen` | Same request shape as Anthropic |
| OpenAI-compatible | Base URL, model, API key if the server needs one | OpenAI, OpenRouter, or a local server such as Ollama or LM Studio |

Click **Test connection** after saving. **Fallback provider** takes over a
batch when the main provider fails (offline, rate limit, bad key).
**Output language override** sets the language of titles and summaries (empty
means English). The app's own texts follow [App language](#app-language).

## The window

The icons on the left switch between **Timeline**, **Daily**, **Weekly**,
**Chat** and **Settings**. The window starts in the Modern theme and dark;
[Appearance](#appearance) below switches to light, to your
desktop's setting, or to the Original look of upstream Dayflow. Animations are switched off
when the system asks for reduced motion. Analysis and capture errors show as
notes in the bottom right corner; the × hides one until the next error.

The first cards appear about 15 minutes after recording starts. A batch that
fails shows a "Processing failed" card; it is retried after the next batch
succeeds.

## The timeline

- **Header**: the arrows step a day (or week) back and forward, the calendar
  button opens a month (Monday first; future days are greyed out, and in
  week mode the whole week is marked), **Day / Week** switches the view, and **Today** comes
  back to today. After 4 AM the timeline moves to the new day by itself.
- **Day view**: cards sit on a 4 AM to 4 AM time axis, sized by how long
  they lasted. Today the view opens at the current time, and a card marks
  the slot where the next card is being made ("Generating your next card").
  While recording is paused that card says so; click it to resume.
- **Week view**: seven 4 AM to 4 AM columns, Monday to Sunday, so late
  nights stay on the day they started. Hover a short card to read its whole
  title.
- **Pause** (top right): opens ∞, 1h, 30m and 15m; while paused it turns
  into **Resume** and shows how long the pause lasts.
- **Category chips** above the timeline: click one to dim its cards, drag it
  (or press Alt+← / Alt+→ on it) to reorder. The pencil opens **Settings → Other → Categories**, which edits
  names, colors and the description the model sees, or applies a preset for
  your role.
- **Card details** (right panel): click the title to rename the card, the
  pencil next to the category to move it to another one, the image to play
  its screenshots. The footer rates the summary (thumbs up, or thumbs down
  with an optional note), and **Reanalyze** or **Delete** act after a
  second click on **Confirm**. A "Processing failed" card has **Retry**.
- **Day summary** (right panel when no card is selected): today's targets
  for focus and distraction, time per category, total and longest focus, and
  time distracted. Idle, failed and private time is not counted. The pencil
  (or **Set goals**) opens the goal pop-up: yesterday's review first, once a
  day, when yesterday had goals, then today's focus goal and distraction
  limit. Drag categories into the two panels (or click one to cycle it
  through focus, distraction and untracked) and set the time on the wheels;
  each panel shows yesterday's time and last week's daily average for its
  categories. **Confirm** saves, **Skip today** leaves today without goals.
  From the fourth day with cards on, the pop-up opens by itself on the first
  visit after 4 AM, unless goals are set, five days in a row were skipped,
  or **Settings → Other → Show daily goal popups** is off.
- **Your review** (day summary) shows how much of the day you rated as
  distracted, neutral or focused. **Review cards** (bottom of the day view)
  or the link under "Your review" shows the day's cards rated less than 80%,
  one at a time: swipe or press ← for distracted, ↑ for neutral, → for
  focused; **Z** goes back a card, **Space** plays its screenshots, **Esc**
  closes. Ratings are stored per time range, like upstream.
- **Copy timeline** (bottom left) puts the day or week on the clipboard as
  text, next to the hours tracked this week. **Settings → Export** saves a
  date range as Markdown and analyzes a whole day again (**Reprocess day**).

## Daily, Weekly and notifications

The two insight tabs unlock as analyzed data builds up, like upstream: Daily
after 5 hours, Weekly after 30 hours. Until then each tab shows the progress.

- **Daily** shows your day as a grid of 15-minute cells per category, with a
  track that marks each distraction, the day's totals per category, and a
  standup update with highlights, tasks and blockers.
  - After 4 AM the app writes the standup from the most recent of the last
    three days with at least 3 hours of cards. It tries at most 3 times a
    day. **Regenerate** writes it now (2 hours of cards are enough).
  - Edit any line; changes save as you type. Enter adds a line, Backspace on
    an empty line removes it, and the handle left of a line drags it to
    another place. You can also fill in the standup yourself before one was
    written.
  - **Copy standup update** puts it on the clipboard as plain text.
- **Weekly** needs no AI. It opens the newest week with at least 15 hours
  tracked and shows time per category, context shifts and distractions per
  day, the week's three longest cards as top highlights, a "Time
  distribution" of each day's cards (its tabs pick out the longest focus
  stretch and the days with the least or most context shifts; below are the
  week's context switches, total focus, longest focus and primary category),
  a grid of the week's categories, a focus and distraction heat map
  (5-minute cells, Sunday first: blue for sustained focus, peach for
  distraction and quick switches), your most used apps per category with the
  change against the week before, how categories flow into apps, and which
  apps you switch between: the most used apps as circles (blue work, grey
  personal, peach distraction), your two most common work patterns and the
  app that most often leads into distractions.
- **Notifications** tell you when your first cards are ready, when the
  standup is written, when Weekly unlocks, and when the AI provider has a
  problem only you can fix (a wrong key, a usage limit, a stopped Ollama).
  Provider problems are reported at most once a day per kind, and only while
  the window is in the background. Click a notification to open the matching
  tab.

## Chat

The Chat tab unlocks after 10 hours of analyzed data. Ask about your days in
plain words ("What did I get done last week?", "When was I most focused?");
answers can include charts.

- **How it finds the answer:** Anthropic, Gemini and OpenAI-compatible models
  (Ollama included, if the model supports tools) look up your timeline cards
  and observations themselves, as often as they need. Claude Code and Codex get
  the last 7 days of cards and 2 days of observations in the prompt instead,
  with all their tools switched off, so they cannot run commands on your
  computer.
- **Provider:** with more than one provider set up, the pills under the input
  box choose which one answers; the others take over if it fails.
- **Suggestions** under an answer fill the input box; edit them or press Enter.
- **History** (clock icon) lists past conversations; the bin icon deletes one
  right away.
- **Memory** (brain icon) shows the short profile and answer style the assistant
  keeps about you. It updates this itself; you can edit or clear it.

## Run a local model with Ollama

A local model keeps everything on your computer and needs no API key. Ollama
serves an OpenAI-compatible API, so the app talks to it like any other
OpenAI-compatible server. Servers on `localhost` or your local network are
analyzed in small steps: one short request per screenshot, then a few
text-only requests for the card. Small models handle that far better than one
large request.

You need a **vision model**. **`qwen3-vl:2b-instruct`** (about 2 GB) is the
recommended start and what the first-run setup fills in: it is quick enough
for an integrated laptop GPU (about 8 s per screenshot on an AMD Radeon
840M/860M; a 15-minute batch sends 15 screenshots, so about 2-3 minutes) and
writes usable cards.
`qwen3-vl:8b-instruct` (about 6 GB) writes better cards but takes longer;
`qwen3-vl:30b-a3b-instruct` (about 20 GB, but only 3B active parameters) is
better still if your machine has the memory. `make bench-models` (below)
compares them on your own screenshots. Take the `-instruct` tags: the
plain tags are "thinking" variants that write a few hundred hidden reasoning
tokens before every answer, which makes each screenshot several times slower,
and Ollama's OpenAI-compatible API cannot switch that off per request.

### 1. Install and start Ollama

On Arch or Manjaro, pick the backend for your GPU: `ollama-vulkan` works on
most AMD and Intel GPUs, `ollama-rocm` on AMD GPUs that ROCm supports,
`ollama-cuda` on NVIDIA. Other distributions: see ollama.com.

Before starting it, set two options for the service:

- `OLLAMA_CONTEXT_LENGTH`: Ollama's OpenAI-compatible API cannot change the
  context per request, and a default context that is too small silently cuts
  off the start of the prompt.
- `OLLAMA_IGPU_ENABLE=1`: Ollama ignores integrated GPUs (AMD Radeon 7xxM and
  8xxM, Intel Arc iGPUs) unless this is set, and runs on the CPU instead,
  roughly ten times slower. The log then says "dropping integrated GPU". Not
  needed for a dedicated GPU.

```sh
sudo pacman -S ollama-vulkan
sudo mkdir -p /etc/systemd/system/ollama.service.d
printf '[Service]\nEnvironment="OLLAMA_CONTEXT_LENGTH=32768"\nEnvironment="OLLAMA_IGPU_ENABLE=1"\n' | sudo tee /etc/systemd/system/ollama.service.d/context.conf
sudo systemctl daemon-reload
sudo systemctl enable --now ollama
ollama pull qwen3-vl:2b-instruct
```

Check that the model runs on the GPU: `ollama ps` should show `GPU` under
PROCESSOR after the first request.

```sh
ollama run qwen3-vl:2b-instruct "Say OK"
ollama ps
```

### 2. Point the app at Ollama

The first-run setup does this for you: choose **Local AI** and it fills in
Ollama's address and `qwen3-vl:2b-instruct`. Later, in **Settings**:

1. AI provider: **OpenAI-compatible**.
2. Model: `qwen3-vl:2b-instruct` (or another vision model you pulled).
3. Base URL: `http://localhost:11434/v1`.
4. Leave the API key empty and click **Test connection**.
5. Keep Recording → Resolution at **720p** (the default). Smaller
   screenshots make every request faster on a local model.

Each 15-minute batch then takes the local model a few minutes. To compare
backends or models, `ollama run <model> --verbose "<prompt>" <image.jpg>`
prints the prompt and generation speed.

From a source checkout, `make bench-models MODELS="qwen3-vl:2b-instruct
qwen3-vl:8b-instruct"` runs the app's own analysis on your latest recorded
batch with each model and prints the load time, the seconds per screenshot,
the time for the card and the card it wrote. It takes the first minute of the
batch (`MINUTES=15` for all of it, `BATCHES=3` for more batches), reads the
database without changing it, and only talks to a local server. Pause
recording first, so the app does not use the model at the same time.

### LM Studio

Start LM Studio's local server (default `http://localhost:1234/v1`), load a
vision model, and enter that URL and the model name the same way. No API key
is needed.

## Claude Code or Codex on your subscription

Instead of an API key, the app can use the `claude` (Claude Code) or `codex`
command-line tool you already use, with its login and subscription. Each
15-minute batch then runs one `claude -p` or `codex exec` call with up to 15
screenshots, like upstream Dayflow. The screenshots and prompt go to Anthropic
or OpenAI under your account.

1. Install and log in on the host, in a normal terminal:
   - Claude Code: `npm install -g @anthropic-ai/claude-code`, then run
     `claude` and type `/login`.
   - Codex: `npm install -g @openai/codex`, then `codex login`.
2. Allow the Flatpak to start programs on your computer, once, then restart
   the app. This permission lets the app run any program on the host, which
   is why it is not on by default:

   ```sh
   flatpak override --user --talk-name=org.freedesktop.Flatpak io.github.kokuwaio.DayflowElectron
   ```

3. In **Settings**, choose **Claude Code** or **Codex** and click **Check**.
   The app finds the tool through your login shell (so installs through npm,
   mise or nvm work), or you enter its full path. Then **Test connection**.

Defaults follow upstream: Claude Code uses the `haiku` model, Codex
`gpt-6-luna` (falling back to `gpt-5.6-luna` when your account cannot use it
yet). Change the model in Settings. If the tool reports that you are logged
out or hit your usage limit, the batch shows "Processing failed" with that
message; the fallback provider, if set, takes over.

For the other direction, where Claude Code or Codex reads your timeline, see
the next section.

## Use your timeline from Claude, Codex, Cursor, VS Code and the terminal

The app ships upstream Dayflow's command-line tool and MCP server as `dayflow-electron`.
Both read the database directly and work while the app is closed. AI tools get
the timeline only when you ask them something in your own conversations.

### Connect your AI tools

Open **Settings → MCP / CLI**. Each tool has a row that shows **Not found**,
**Connect**, or **Connected** with **Disconnect**; restart the tool after
connecting it.

| Tool | What **Connect** does |
| --- | --- |
| Codex | Runs `codex mcp add dayflow-electron ...` on your computer. |
| Claude Code | Runs `claude mcp add --scope user dayflow-electron ...`, so the server is available in every project. |
| Claude Desktop | Adds the "dayflow-electron" entry under `mcpServers` in `claude_desktop_config.json` (`~/.config/Claude/` on Linux, `~/Library/Application Support/Claude/` on macOS, `%APPDATA%\Claude\` on Windows) and keeps everything else in it. A file that is not valid JSON is reported and left alone. |
| Cursor, VS Code | Opens their install link. Approve the dialog in the editor; the row then says "Finish in Cursor". They keep the entry in their own settings, so remove it there. |

The Flatpak can only run these commands and reach Claude Desktop's config
with the opt-in permission from
[Claude Code or Codex on your subscription](#claude-code-or-codex-on-your-subscription).
Without it, the Codex and Claude Code rows show the command to paste into a
terminal, and the Claude Desktop row the entry to paste into its config:

```sh
claude mcp add --scope user dayflow-electron -- flatpak run --command=dayflow-electron-cli io.github.kokuwaio.DayflowElectron mcp
```

Cursor and VS Code need no permission: their links open through the desktop
portal. Without it the app cannot tell whether they are installed, so their
rows always offer **Connect**.

Outside the Flatpak, the registered command is the app's own path. When the
app moves (a reinstall to another folder), it rewrites its entries for Claude
Desktop, Claude Code and Codex at the next start, like upstream; Cursor and VS
Code need **Connect** again. The Flatpak's command never changes.

**Other apps** shows a JSON snippet for any other MCP client.

The MCP server offers upstream's tools: `get_time_breakdown`, `get_timeline`,
`get_activity_detail`, `search_activities`, `get_daily`, `get_weekly`,
`list_categories` and `get_status`. Ask for example "Where did my time go
this week?" or "Write my standup from yesterday's timeline".

### Allow edits

With **Allow edits** off (the default), AI tools can only read. Turn it on and
they also get `create_category`, `update_category`, `delete_category`,
`update_activity`, `delete_activity` and `set_day_goal`. Edits go through the
running app, so it has to be open; it listens on `agent.sock` in the data
folder only while the switch is on. Every edit is appended to
`agent-writes.log` in the same folder. The tools tell the AI to confirm deletes
with you first, but the app cannot enforce that; leave edits off if you do not
want an agent to delete anything.

### The terminal command

**Settings → MCP / CLI → Terminal command** shows a command that adds a small
`dayflow-electron` script to `~/.local/bin` on Linux and macOS (Windows has no
terminal command yet; connect AI tools above). Paste it into a terminal once. Without
it, run `flatpak run --command=dayflow-electron-cli io.github.kokuwaio.DayflowElectron`
instead of `dayflow-electron`.

```sh
dayflow-electron today
dayflow-electron timeline 2026-11-17 --summary
dayflow-electron timeline --from 2026-11-10 --to 2026-11-16
dayflow-electron card 42
dayflow-electron weekly --json
dayflow-electron search "code review"
dayflow-electron categories rename Work "Deep work"
dayflow-electron goal set --focus-minutes 240 --focus-category Work
```

`dayflow-electron help` lists every command. A value that starts with a dash
goes after `=`, as in `--title=--draft`. `--json` prints stable JSON with
`schema_version: 1`; errors then go to stderr as JSON. Exit codes: 0 ok,
1 unexpected error, 2 bad arguments, 3 not found, 4 edits are off, 5 no data
yet, 6 the app is not running (for edits). `timeline delete` and
`categories remove` ask first; in scripts, pass `--yes`.

### Agent workflows (plugin)

The repository has a plugin for Codex and Claude Code in
`plugins/dayflow-electron/`, ported from upstream's `plugins/dayflow`. It
starts the MCP server and adds four skills:

| Skill | What it does |
| --- | --- |
| `dayflow-electron` | Answers "what did I work on", "how long did I spend on", "when did I last", and picks the right tool for it. |
| `standup` | Drafts a standup from the Daily, or from the day's activities: done, next, blockers. |
| `weekly-review` | Compares a week with the one before: time per category, main projects, one or two observations. |
| `onboarding` | Checks that the app records and is reachable, then summarizes your day so far. |

The plugin carries no copy of the server. Its launcher
(`bin/dayflow-electron-mcp`) uses, in this order: the command in
`DAYFLOW_ELECTRON_CLI`, the terminal command from
[above](#the-terminal-command), the Flatpak, or the macOS app in
`/Applications` or `~/Applications`. Windows is not covered yet; connect the
tools in **Settings → MCP / CLI** there. If the tools already have the
`dayflow-electron` server from **Connect**, disconnect it there first, or they
see it twice.

Claude Code:

```sh
claude plugin marketplace add kokuwaio/dayflow-electron
claude plugin install dayflow-electron@dayflow-electron
```

Codex:

```sh
codex plugin marketplace add kokuwaio/dayflow-electron
```

then open `/plugins` in Codex and install **Dayflow Electron**. Both take a
path to a local clone of the repository instead of `kokuwaio/dayflow-electron`.
Restart the tool afterwards and ask, for example, "Write my standup from
yesterday" or "How did my week go?".

## Keep password managers out

While one of the apps under **Settings → Privacy → Blocked apps** is the focused window,
nothing is saved and the time shows as "Private" in the timeline. The list
starts with KeePassXC, KeePass, 1Password, Bitwarden and the Passbolt web app.
Add more, one rule per line: an app ID, or `title:` followed by text from
the window title (for example `title:Online Banking`). The app ID depends on
the system:

| System | App ID | Example |
| --- | --- | --- |
| Linux (KDE) | Window class or Flatpak ID | `org.keepassxc.KeePassXC` |
| Windows | Process name without `.exe` (Task Manager → Details) | `KeePassXC`, `1Password` |
| macOS | Bundle ID (`osascript -e 'id of app "1Password"'`) | `com.1password.1password` |

Rules ignore upper and lower case.

This needs to know the focused window:

- **Windows:** a hidden PowerShell process asks Windows for the focused
  window twice a second. Nothing to set up.
- **macOS:** a hidden `osascript` process asks macOS for the frontmost app
  and its window title once a second. Window titles need the Screen
  Recording permission from the first start; without it, window detection
  stays off.
- **Linux (KDE Plasma):** the focused window comes from KWin. The Flatpak
  does not have that permission by default. Grant it once, then restart the
  app:

```sh
flatpak override --user --talk-name=org.kde.KWin io.github.kokuwaio.DayflowElectron
```

Settings then shows "Window detection works". Limits:

- Only the focused window is known. A password manager open in the
  background on the recorded screen is still captured.
- Popups of browser extensions do not change the window title and cannot be
  detected.
- On Linux, window detection works on KDE Plasma only so far.
- On Windows, a store app (UWP) shows up as `ApplicationFrameHost`; use a
  `title:` rule for those.

For the strongest guarantee, pause recording from the tray before opening a
vault.

**Hide private browsing windows** (Settings → Privacy, on by default)
treats Chrome and Chromium incognito windows and Firefox private windows like
blocked apps. It reads the window title, so it also needs window detection.

## Hide secrets in screenshots

**Hide secrets in screenshots** (Settings → Privacy, on by default; switch it
off there if analysis feels slow)
reads the text on each frame before it goes to the AI provider and blacks out
secrets it recognizes. The recordings on disk stay as they were taken, so the
timeline still shows them unmasked. It catches:

- API keys and tokens with a well-known prefix: `sk-`, `sk-ant-`, `ghp_`,
  `github_pat_`, `xoxb-`, `AKIA`, `glpat-`, `AIza`, `hf_`, `npm_` and more.
- Passwords handed to command-line tools (`mysql --password=…`,
  `redis-cli -a …`, `curl -u user:…`), `user:pass https://…` pairs, a
  revealed value next to a **Hide** button, and the value after "Password"
  on a short line.
- Password-like lines on a password manager screen (Bitwarden, 1Password,
  KeePass and others).
- Private key blocks (`BEGIN … PRIVATE KEY`, or base64 lines below a key file
  name such as `id_ed25519`).
- Authenticator setup keys, wallet seed phrases (12 to 24 BIP39 words) and
  recovery or backup codes under their heading.

The rules are upstream's, but upstream also runs a trained model that is only
available with its paid plan. Without it, far less is caught: card and bank
numbers, government IDs, emails and most passwords in ordinary text are not
masked. The text recognition (Tesseract) also misreads some characters, and a
misread secret no longer matches its pattern. Treat this as a second line of
defence; blocked apps and pausing are the reliable ways to keep something
private.

Reading the text takes a few seconds per frame (2 to 6 s for a 1080p frame on
a laptop CPU), for the up to 15 frames each 15-minute batch sends. It runs on
your computer; nothing is downloaded. If it fails, the batch is not sent and
is retried later.

## Appearance

The window is dark by default. **Settings → Other → Appearance** switches to
light, or to **System** to follow your desktop's light or dark setting.

**Settings → Other → Theme** picks the look:

- **Modern** (the default): flat neutral greys, the Inter font, one indigo
  accent and crisp borders; calmer and a little denser.
- **Original**: upstream Dayflow's warm look, with gradients, translucent
  panels and serif titles.

Both themes come in light and dark, so Appearance works with either. Your
category colours stay the same in both. The first-run setup follows the theme
too.

## App language

**Settings → Other → App language** sets the language of the app's menus,
buttons, messages, the tray and notifications: English (the default),
Deutsch, Français, Русский, 日本語, 한국어, 简体中文 or 繁體中文. **System
default** follows your desktop's language, and English when it is none of
these. The window, tray and notifications switch at once, no restart needed.
Dates, times and durations follow the chosen language too.

Some texts stay English: the card titles and summaries (set their language
with **Output language override** under Providers), category names, the
terminal command and MCP tools, and error messages from the AI providers.
The Weekly view is translated in a later version.

Many translations come from upstream Dayflow; the others are machine
translations waiting for a native speaker's review (listed in
`src/shared/locales/machine-translated.json`). Corrections are welcome.

## Pause, privacy and storage

- **Pause** from the tray or the Pause button in the timeline: 15, 30 or 60
  minutes, or until you resume.
- Recording also pauses while the screen is locked or the computer sleeps.
- Screenshots, the database and settings live in
  `~/.var/app/io.github.kokuwaio.DayflowElectron/config/dayflow-electron/`
  (Flatpak), `%APPDATA%\dayflow-electron\` (Windows) or
  `~/Library/Application Support/dayflow-electron/` (macOS).
  **Open recordings folder** in the tray shows the screenshots.
- **Settings → Storage** caps the space used by screenshots (default 10 GB);
  the oldest are deleted first.
- The database is backed up once a day to `backups/` in the same folder (the
  newest three are kept). If it is ever damaged, the app restores the newest
  backup on start and keeps the damaged file as `dayflow.sqlite.corrupt-…`.
- **Deep links** start and stop recording from scripts or launchers:
  `xdg-open dayflow-electron://stop-recording` pauses until you resume,
  `xdg-open dayflow-electron://start-recording` resumes. On macOS use `open`
  instead of `xdg-open`, on Windows `start ""`.
- **Launch at login** (Settings) uses the desktop's autostart on Linux, the
  Startup apps list on Windows and Login Items on macOS. The app then starts
  in the tray without a window.
- No telemetry. Nothing leaves your computer except the screenshots and text
  sent to the AI provider you chose.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| No cards after 20 minutes | Settings → Providers: a key or a reachable local server; **Test connection**. The note in the bottom right corner of the window shows the last analysis error. |
| "Ollama/LM Studio at … unreachable" | The local server is not running. Start it (`sudo systemctl start ollama`, see above); the waiting batches are analyzed once it answers. |
| Daily says "Not enough captured activity" | None of the last three days has enough cards (3 hours for the automatic standup, 2 for Regenerate). |
| "Processing failed" cards or very slow batches with a local model | Run `ollama ps` while a batch runs: `100% CPU` on a machine with an integrated GPU means `OLLAMA_IGPU_ENABLE=1` is missing. Check the context length setting above, try 720p. |
| The share dialog comes back on every start | Allow restoring the permission in the dialog. |
| "Window detection needs KWin access" | Run the `flatpak override` command above, then restart the app. |
| `dayflow-electron` edits fail with "Dayflow Electron isn't running" | Start the app and check that **Settings → MCP / CLI → Allow edits** is on. |
| macOS: "Screen Recording permission is missing" | Allow dayflow-electron in System Settings → Privacy & Security → Screen Recording, then quit and reopen the app. After an update, remove it from the list with **−** and allow it again. |
| Windows: "Window detection is off" | The PowerShell window watcher could not start; the message shows why. Company policies that block PowerShell also block it. |
| Capture failed, retrying | The screen-sharing session ended (for example after a monitor change); the app retries after 1, 2, 5 and then every 10 minutes. |

### Report a problem

**Settings → Other → Support** helps with bug reports:

- **Copy debug logs** puts a text report on the clipboard: the app version,
  platform, desktop, chosen providers and capture settings, the latest 5
  cards (title, category and summary), the latest 20 AI calls (provider,
  model, time taken, success or error, HTTP status), the latest 10 analysis
  batches with their status and reason, and the errors from the log file.
  It leaves out screenshots, what was sent to the AI and what it answered,
  and API keys; your home folder shows as `~`. Read it before you share it:
  the card titles and summaries describe your screen.
- **Open log folder** opens `logs/` in the data folder. The app writes
  `dayflow-electron.log` there; at 1 MB it becomes `dayflow-electron.1.log`
  and replaces the one before, so the log never takes more than about 2 MB.
- **Open GitHub issues** opens the issue tracker in your browser. Paste the
  debug logs into a new issue.
