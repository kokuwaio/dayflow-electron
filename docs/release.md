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
   - `dayflow-electron-<tag>-win-<arch>.exe` for `x64` and `arm64`: NSIS
     installers, unsigned
   - `dayflow-electron-<tag>-mac-<arch>.dmg` for `arm64` and `x64`: disk
     images, ad-hoc signed, not notarized
   - for electron-updater in the installed apps: `latest.yml` (both Windows
     installers), `latest-mac.yml` (both disk images and the zips),
     `dayflow-electron-<tag>-mac-<arch>.zip` (Squirrel.Mac installs updates
     from these) and a `.blockmap` per installer, dmg and zip (differential
     downloads)
   - `SHA256SUMS` over all of them

   The feeds are uploaded last, so an installed app never sees a version
   whose files are still missing.

## Versions

`scripts/version.sh` gives every build its version: `1.2.3` for the tag
`v1.2.3`, otherwise `0.0.0-<branch>.<short sha>`. CI and `make` pass it to the
Electron app (electron-builder's `extraMetadata.version`, so `package.json`
stays as it is), to the Go helper (`dayflow-linux-helper version`) and to the
metainfo, where `scripts/metainfo-release.sh` adds the release entry that
software centers show. `make version` prints it.

## Auto-update

The Windows and macOS builds update themselves with
[electron-updater](https://www.electron.build/auto-update) from the GitHub
releases (`publish` in `electron-builder.yml`). The policy is in
`src/shared/updates.ts`, the Electron side in `src/main/updater.ts`.

- electron-builder writes the feeds and `app-update.yml` (inside the app)
  because of the `publish` config; every build in CI passes `--publish never`
  and the release workflow uploads the files instead.
- Installer names carry the tag (`artifactName` in `electron-builder.yml`),
  because the feeds point at them by name and electron-updater finds the
  previous version's blockmap by swapping the version in the URL. The
  release workflow fails when an installer's name doesn't match the tag.
- The two Windows builds (x64, arm64) each write a `latest.yml` for their
  own installer; `scripts/merge-update-feeds.ts` merges them, and
  electron-updater picks the file whose name contains its architecture. The
  macOS build writes both architectures into one `latest-mac.yml`.
- Only stable releases count: a prerelease on GitHub is ignored, and builds
  from a branch (`0.0.0-...`) and the Flatpak never check.
- Squirrel.Mac installs an update only when the app is signed with a
  Developer ID (it checks the new app's signature against the running one).
  The ad-hoc signed builds therefore only notify and link the release page;
  installing starts working with the signing below.
- The updater downloads without a token, so it needs a public repository.
  While the repository is private, the check fails and logs the error.

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
`hardenedRuntime: false` under `mac`, and add `notarize: true`. The app finds
the Developer ID signature at start (`codesign -dv`) and then installs updates
instead of only announcing them. The first signed version still has to be
installed by hand. On Windows, electron-updater checks the installer's
signature only once `win.publisherName` is set (unsigned builds skip the
check); set it together with the certificate.
electron-builder's default entitlements cover what Electron needs under the
hardened runtime; the app loads no native modules and starts `osascript` as
a separate program.
