# AGENTS.md

dayflow-electron ports [Dayflow](https://github.com/JerryZLiu/Dayflow) (Swift,
macOS) to Electron and TypeScript, Linux first. How it fits together:
[docs/architecture.md](docs/architecture.md). What is done and next:
[docs/roadmap.md](docs/roadmap.md). Linux desktop findings and rejected
approaches: [docs/platform-notes.md](docs/platform-notes.md).

## Upstream parity

Upstream is the spec. Before building or changing a feature, read the matching
upstream Swift code (paths in the roadmap are relative to `Dayflow/Dayflow/` in
the upstream repo) and port its behaviour, thresholds and texts.

- Copy prompts verbatim (`prompt-template.ts`, `two-step-prompts.ts`,
  `daily-prompts.ts` hold upstream's text) and cite the upstream file in a
  comment at the top of each module.
- Keep upstream's table and column names; schema changes are new numbered
  migrations in `src/main/db/schema.ts` (`PRAGMA user_version`).
- Port the look too, but not upstream's artwork: the name "Dayflow", its logo,
  icons, illustrations and videos are not MIT-licensed. Upstream's fonts are
  OFL and may be bundled with their license files.
- The roadmap's "Later or never" table lists what stays out (account, billing,
  hosted AI, telemetry, ...).

## Privacy and security

- The app sends data only to the AI provider the user chose. Add no telemetry,
  analytics or third-party lookups; site icons come from the site itself.
- CLI providers (Claude Code, Codex) run with all their tools off. Upstream
  starts them with `--dangerously-skip-permissions`; keep that out, and give
  them the data they need in the prompt instead.
- The renderer is sandboxed: file, network and database access go through the
  main process (`window.dayflow` in `src/preload/`, the `dayflow-media://`
  scheme for images).

## Code

- Days run from 4 AM to 4 AM (`src/shared/day.ts`); use its helpers for any
  day, clock or slot math.
- Put logic in pure functions in `src/shared/` or `src/main/analysis/` and test
  it there with Vitest; Electron-bound code stays thin. Tests run with
  `TZ=Europe/Berlin` (set in `vitest.config.ts`), so write times as local
  wall-clock dates.
- No native Node modules: SQLite is Node's built-in `node:sqlite`.
- The Go helper links `libpipewire-0.3` through cgo. `npm run helper` and
  `npm run test:helper` build inside the Flatpak SDK; CI installs
  `libpipewire-0.3-dev` instead.
- Scripts must run on Linux and macOS: POSIX tools and flags only.

## Changes

- Conventional commits and PR titles (`feat(chat): ...`); Release Drafter
  builds the release notes from the PR titles.
- With a feature change, update its checkbox in `docs/roadmap.md`, and
  `docs/usage.md` or `docs/architecture.md` where they describe it.
- Before a PR: `npm run typecheck`, `npm test`, and `npm run test:helper` when
  `helper/linux` changed.
