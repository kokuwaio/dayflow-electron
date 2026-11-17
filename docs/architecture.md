# Architecture

How dayflow-electron turns screenshots into a timeline. For what is built and
what is next, see [roadmap.md](roadmap.md). For Linux desktop details, see
[platform-notes.md](platform-notes.md).

## Overview

The app has three processes. Only the main process touches files, the
database and the network.

- **Renderer**: the React UI in a sandboxed window. It has no Node access. It
  calls the main process through the `window.dayflow` API that the preload
  script exposes, and it loads screenshots and icons through the
  `dayflow-media://` scheme.
- **Main process** (Node, Electron): records, stores, analyzes and serves the
  data.
- **Linux helper**: a Go program for what Electron cannot do on Wayland.
  The main process starts it and reads JSON lines from it.

```mermaid
flowchart LR
  subgraph Desktop["Linux desktop"]
    Portal["ScreenCast portal<br/>+ PipeWire"]
    DBus["D-Bus: ScreenSaver,<br/>logind, KWin"]
    Wayland["Wayland<br/>ext-idle-notify-v1"]
  end

  subgraph Helper["Go helper (helper/linux)"]
    Capture["capture<br/>frames of the screen<br/>under the mouse"]
    Watch["watch<br/>lock, sleep, idle"]
    Window["window<br/>focused app"]
  end

  subgraph Main["Electron main process (src/main)"]
    Platform["platform/linux.ts"]
    Recorder["capture/recorder.ts<br/>pause, backoff,<br/>blocked apps"]
    Store[("SQLite<br/>db/store.ts")]
    Files[("JPEG frames<br/>recordings/")]
    Pipeline["analysis/pipeline.ts<br/>batches, idle check,<br/>failover"]
    Providers["providers/<br/>Anthropic, Gemini,<br/>OpenAI-compatible,<br/>Claude Code, Codex"]
    Privacy["privacy/<br/>OCR, hide secrets<br/>(opt-in)"]
    Insights["insights/daily.ts<br/>standup"]
    Notify["notifications.ts"]
    Retention["retention.ts<br/>storage limit"]
    Media["media.ts<br/>dayflow-media://"]
    IPC["IPC handlers<br/>index.ts"]
  end

  subgraph Renderer["Renderer (src/renderer)"]
    UI["Timeline · Daily ·<br/>Weekly · Settings"]
  end

  AI(["AI provider<br/>(cloud or local)"])

  Portal --> Capture
  DBus --> Watch
  Wayland --> Watch
  DBus --> Window
  Capture -- "frame JSON lines" --> Platform
  Watch -- "lock / idle events" --> Platform
  Window -- "app + title" --> Platform
  Platform --> Recorder
  Recorder -- "block / unblock" --> Capture
  Recorder --> Files
  Recorder --> Store
  Store --> Pipeline
  Files --> Pipeline
  Pipeline <--> Privacy
  Pipeline <--> Providers
  Providers <--> AI
  Pipeline -- "cards" --> Store
  Store --> Insights
  Insights <--> Providers
  Store --> Notify
  Retention --> Files
  Store <--> IPC
  Files --> Media
  IPC <-- "window.dayflow (preload)" --> UI
  Media --> UI
```

## From frame to card

1. **Capture.** The helper shares all screens once through the ScreenCast
   portal and keeps the restore token, so later starts show no dialog. It
   reads frames from PipeWire and uses the cursor metadata to keep only the
   screen under the mouse. Every few seconds (10 s by default) it writes a
   JPEG and prints a `frame` line.
2. **Record.** The recorder stores each frame in `screenshots`. It pauses
   while the screen is locked or the computer sleeps, and when you pause it
   from the tray. While a blocked app (a password manager) has focus, the
   helper writes no file and the recorder stores a placeholder row instead.
3. **Batch.** Every minute the pipeline groups unbatched frames into
   `analysis_batches` like upstream: about 15 minutes each, split at gaps of
   more than 2 minutes, and at least 5 minutes long.
4. **Shortcuts.** A batch that is all blocked frames becomes a "Private" card.
   A batch where the idle check sees no activity becomes an Idle card. Neither
   needs a model call.
5. **Analyze.**
   - With **Hide secrets in screenshots** on, each sampled frame is masked
     before any provider sees it (see [Secret masking](#secret-masking)).
   - Cloud providers get one request with a sample of the frames, the
     previous cards and the categories (upstream's prompt, verbatim). The
     reply is checked; on errors the model gets up to 3 tries with a
     correction message.
   - Local models (and cloud models whose cards keep failing the checks) use
     the two-step path: describe each frame, turn the descriptions into
     observations, then write the summary and title and maybe merge with the
     previous card.
   - When the main provider fails, the fallback provider takes over.
     Failed batches get a "Processing failed" card and are retried later.
6. **Store and show.** Cards replace the batch's old cards in
   `timeline_cards`. The main process tells the window, which reloads the day.

```mermaid
sequenceDiagram
  participant H as Go helper
  participant R as Recorder
  participant DB as SQLite
  participant P as Pipeline
  participant AI as AI provider
  participant UI as Window

  loop every few seconds
    H->>R: frame (path, time, size)
    R->>DB: insert screenshot
  end
  loop every minute
    P->>DB: unbatched screenshots
    P->>DB: create batch (~15 min)
    alt all frames blocked or idle
      P->>DB: Private or Idle card
    else
      P->>AI: frames + previous cards + categories
      AI-->>P: cards (JSON)
      P->>P: validate, retry with correction
      P->>DB: replace cards for the batch
    end
    P->>UI: cards changed
    UI->>DB: day:get (through IPC)
  end
```

## Secret masking

Opt-in (`hideSecrets`), after upstream's Privacy Shield
(`Core/PrivacyShield/`). Upstream masks frames at capture with a trained
model plus rules; the model comes from upstream's paid backend, so the port
runs the rules alone, on text read by Tesseract, and masks only what goes to
a provider.

1. The pipeline samples a batch's frames (up to 15) once, before the provider
   failover, and passes each through `prepareFrame`
   (`src/main/privacy/masker.ts`). A failure fails the batch, so no frame
   leaves unmasked; it is retried later.
2. `privacy/tesseract.ts` reads the text with `tesseract.js` (WebAssembly in a
   worker thread, kept alive between batches and closed when the setting is
   off or the app quits). The English model (`@tesseract.js-data/eng`,
   `4.0.0_best_int`) is read from inside `app.asar` with caching off, so
   nothing is downloaded or written.
3. `privacy/regions.ts` orders the lines like upstream (1% bands, then left
   to right) and joins each line's words. `privacy/rules.ts` ports upstream's
   `PIIMaskRules` passes that mask without the model (setup keys, password
   manager screens, labeled passwords, key blocks, seed phrases with the
   BIP39 list, recovery codes, key prefixes) and the unmask passes their
   masks can reach, in upstream's order. Recovery codes need one addition:
   code-shaped tokens stand in for the model's one-time code labels.
4. Masked character runs become rectangles from Tesseract's character boxes
   (or the word box), padded by 3 px, and `privacy/redact.ts` blacks them out
   with `jpeg-js` (upstream pixelates). Frames without secrets pass unchanged.

## Insights

- **Daily** builds its activity grid from the day's cards in the renderer.
  The standup is written by the AI provider once a day after 4 AM, from the
  best of the last three days with enough activity (`insights/daily.ts`).
- **Weekly** needs no AI. Every chart is computed from the week's cards in
  `src/shared/weekly.ts`.
- **Chat** (`src/main/chat/`) streams answers to the window. API providers
  run a tool loop (up to 20 rounds) with upstream's `fetchTimeline` and
  `fetchObservations` tools, which read the store. CLI providers get the
  recent timeline in the prompt and run with their tools off. Each answer's
  trailing `suggestions` and `memory` blocks are taken out and kept in the
  settings; conversations live in `chat_conversations` and `chat_messages`.
- **Unlocks** follow upstream: Daily after 5 hours of analyzed data, Chat
  after 10, Weekly after 30.

## Data

- **SQLite** (`dayflow.sqlite` in the data folder) keeps upstream's table
  names: `screenshots`, `analysis_batches`, `batch_screenshots`,
  `timeline_cards`, `observations`, `llm_calls`, `timeline_review_ratings`,
  `day_goals`, `day_goal_categories`, `daily_standup_entries`. Migrations are
  counted with `PRAGMA user_version`. Times are Unix seconds.
- **Days run from 4 AM to 4 AM**, so a late night stays on the day it began
  (`src/shared/day.ts`).
- **Backups**: a daily copy of the database in `backups/` (newest three);
  `src/main/db/backup.ts` restores the newest one when the database is
  damaged at start.
- **Frames** are JPEG files in `recordings/`. The retention job deletes the
  oldest ones when the storage limit is reached; cards stay.
- **Settings** are a JSON file. API keys are encrypted with Electron's
  `safeStorage` (KWallet or Secret Service on Linux).

## Code layout

| Path | What |
| --- | --- |
| `src/main/index.ts` | Starts everything and registers the IPC handlers |
| `src/main/capture/` | Recorder: pause, restart with backoff, blocked apps |
| `src/main/platform/` | OS interface; `linux.ts` runs the Go helper |
| `src/main/analysis/` | Batching, idle check, prompts, card checks, two-step path, pipeline |
| `src/main/providers/` | One adapter per provider; `cli/` runs Claude Code and Codex on the host |
| `src/main/privacy/` | Secret masking: OCR, upstream's mask rules, black boxes |
| `src/main/insights/` | Daily standup generation |
| `src/main/chat/` | Chat: tools, tool loop, system prompts, answering service |
| `src/main/db/` | Schema migrations and all SQL |
| `src/main/media.ts` | Serves frames and site icons to the window |
| `src/main/notifications.ts` | Desktop notifications |
| `src/preload/` | The `window.dayflow` API |
| `src/renderer/src/` | React views: Timeline, Daily, Weekly, Chat, Settings, Onboarding |
| `src/shared/` | Pure logic used by both sides: days, categories, Daily and Weekly math, export, failure kinds |
| `helper/linux/` | Go helper: `portal/`, `pipewire/`, `wayland/`, `frames/`, commands in `cmd/` |
| `flatpak/` | Flatpak manifest and desktop file |

Most logic sits in `src/shared/` and `src/main/analysis/` as pure functions,
so the tests run without Electron. Run them with `npm test`; run the Go tests
with `npm run test:helper`.
