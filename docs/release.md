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
   - `SHA256SUMS` over all of them

## Versions

`scripts/version.sh` gives every build its version: `1.2.3` for the tag
`v1.2.3`, otherwise `0.0.0-<branch>.g<short sha>`. CI and `make` pass it to the
Electron app (electron-builder's `extraMetadata.version`, so `package.json`
stays as it is), to the Go helper (`dayflow-linux-helper version`) and to the
metainfo, where `scripts/metainfo-release.sh` adds the release entry that
software centers show. `make version` prints it.

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
