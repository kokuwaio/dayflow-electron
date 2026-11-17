# Releasing

## GitHub release

1. Merged pull requests collect in a draft release. Release Drafter names it
   from the PR titles: `feat:` raises the minor version, a breaking change
   (`feat!:`) the major one, everything else the patch version.
2. Check the draft on the releases page, edit the notes if needed, and
   publish it.
3. Publishing runs `.github/workflows/release.yaml`. It runs the tests, builds
   the app and the Flatpak, and attaches to the release:
   - `dayflow-electron-<tag>-<arch>.flatpak` for `x86_64` and `aarch64`:
     install with `flatpak install --user dayflow-electron-<tag>-x86_64.flatpak`
   - `dayflow-electron-<tag>-linux-<arch>.tar.gz`: the built app, helper,
     icon, desktop file and metainfo, which the Flathub manifest builds from
   - `dayflow-electron-<tag>-win-<arch>.exe` for `x64` and `arm64`: NSIS
     installers, unsigned
   - `dayflow-electron-<tag>-mac-<arch>.dmg` for `arm64` and `x64`: disk
     images, ad-hoc signed, not notarized
   - `SHA256SUMS` over all of them

Bump `<release>` in `flatpak/io.github.kokuwaio.DayflowElectron.metainfo.xml`
in the PR before a release; software centers show these entries.

## Signing Windows and macOS

The installers are built unsigned (Windows) or ad-hoc signed (macOS: Apple
silicon runs no unsigned code), so SmartScreen and Gatekeeper warn on first
start, and macOS asks for Screen Recording again after each update. Signing
needs certificates only the owner can get. electron-builder reads them from
the environment; store them as repository secrets and pass them to the
`Package` step of the `installers` job in `.github/workflows/build.yaml`.
The job runs on pull requests too; GitHub gives no secrets to pull requests
from forks, so those stay unsigned.

| Variable | For | What |
| --- | --- | --- |
| `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` | Windows | Code signing certificate (`.pfx`, base64 or a path) and its password. Azure Trusted Signing instead: `win.azureSignOptions` in `electron-builder.yml` plus `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`. |
| `CSC_LINK`, `CSC_KEY_PASSWORD` | macOS | "Developer ID Application" certificate exported as `.p12`, and its password |
| `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` | macOS notarization | App Store Connect API key (`.p8` path), its ID and issuer. Or `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`. |

For macOS also change `electron-builder.yml`: remove `identity: "-"` and
`hardenedRuntime: false` under `mac`, and add `notarize: true`.
electron-builder's default entitlements cover what Electron needs under the
hardened runtime; the app loads no native modules and starts `osascript` as
a separate program.

## Flathub

Flathub builds apps on its own servers from a manifest in a repository it
creates per app; a project cannot push builds there from its own CI. The
manifest is ready in `flatpak/flathub/`. It builds from the release tarball,
and its `x-checker-data` lets Flathub's update checker open a PR in the
Flathub repository whenever a new release appears.

Before the first submission:

- The repository must be public, so Flathub can download the release assets.
- The app needs its own name and icon: "Dayflow" and upstream's artwork are
  not covered by the MIT license (see the roadmap's ground rules). Rename it
  in the desktop file, the metainfo and `PRODUCT_NAME` in
  `src/shared/export.ts`.
- Add screenshots to the metainfo; Flathub's linter requires them.

Submission, once:

1. Publish the first GitHub release.
2. In `flatpak/flathub/io.github.kokuwaio.DayflowElectron.yml`, set both
   archive sources (x86_64 and aarch64) to that release's tarballs and their
   `sha256` lines from `SHA256SUMS`.
3. Follow Flathub's [submission guide](https://docs.flathub.org/docs/for-app-authors/submission):
   open a PR against the `new-pr` branch of `flathub/flathub` with the
   manifest. The `io.github.kokuwaio` ID is verified through the GitHub
   organization.
4. After the review, Flathub creates `flathub/io.github.kokuwaio.DayflowElectron`
   and grants the submitter write access. Later releases arrive there as update
   PRs from the checker; merging one publishes the update.
