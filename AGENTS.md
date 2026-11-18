# AGENTS.md

Dayflow Electron (`dayflow-electron` in identifiers) ports [Dayflow](https://github.com/JerryZLiu/Dayflow) (Swift,
macOS) to Electron and TypeScript, Linux first. How it fits together:
[docs/architecture.md](docs/architecture.md). What is done and next:
[docs/roadmap.md](docs/roadmap.md). Linux desktop findings and rejected
approaches: [docs/platform-notes.md](docs/platform-notes.md).

## Origin

The first version ported upstream's features (the roadmap records that work,
with upstream paths relative to `Dayflow/Dayflow/`). From here on the app
follows its own decisions; upstream's code is a source of ideas, not the spec.

- The prompts started as upstream's text and their modules cite the upstream
  file they came from; change them like any other code.
- Schema changes are new numbered migrations in `src/main/db/schema.ts`
  (`PRAGMA user_version`). Keep the existing table and column names: the CLI
  and the MCP tools read them.
- Upstream's artwork (logo, icons, illustrations, videos) stays out; it is not
  MIT-licensed. The app is "Dayflow Electron" in user texts. Bundled fonts
  ship with their OFL license files.
- The roadmap's "Later or never" table lists what stays out (account, billing,
  hosted AI, telemetry, ...).

## Privacy and security

- The app sends data only to the AI provider the user chose. Add no telemetry,
  analytics or third-party lookups; site icons come from the site itself.
  The one exception: installer builds ask GitHub Releases for updates, behind
  the "Check for updates" setting (Settings → Other).
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
- The Go helper links `libpipewire-0.3` through cgo. `make helper` and
  `make test-helper` build inside the Flatpak SDK; `make lint` and CI need
  the headers on the host (CI installs `libpipewire-0.3-dev`).
- Scripts must run on Linux and macOS: POSIX tools and flags only.

## Changes

- Conventional commits and PR titles (`feat(chat): ...`); Release Drafter
  builds the release notes from the PR titles.
- With a feature change, update its checkbox in `docs/roadmap.md`, and
  `docs/usage.md` or `docs/architecture.md` where they describe it.
- Before a PR: `make check` (typecheck, Vitest, golangci-lint and the Go
  tests); the root `Makefile` lists every task (`make help`).
