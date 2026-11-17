# Releasing

## GitHub release

1. Merged pull requests collect in a draft release. Release Drafter names it
   from the PR titles: `feat:` raises the minor version, a breaking change
   (`feat!:`) the major one, everything else the patch version.
2. Check the draft on the releases page, edit the notes if needed, and
   publish it.
3. Publishing runs `.github/workflows/release.yaml`. It runs the tests, builds
   the app and the Flatpak, and attaches to the release:
   - `dayflow-electron-<tag>-x86_64.flatpak`: install with
     `flatpak install --user dayflow-electron-<tag>-x86_64.flatpak`
   - `dayflow-electron-<tag>-linux-x86_64.tar.gz`: the built app, helper,
     icon, desktop file and metainfo, which the Flathub manifest builds from
   - `SHA256SUMS`

Bump `<release>` in `flatpak/io.github.kokuwaio.DayflowElectron.metainfo.xml`
in the PR before a release; software centers show these entries.

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
2. In `flatpak/flathub/io.github.kokuwaio.DayflowElectron.yml`, set `url` to
   that release's tarball and `sha256` to its line in `SHA256SUMS`.
3. Follow Flathub's [submission guide](https://docs.flathub.org/docs/for-app-authors/submission):
   open a PR against the `new-pr` branch of `flathub/flathub` with the
   manifest. The `io.github.kokuwaio` ID is verified through the GitHub
   organization.
4. After the review, Flathub creates `flathub/io.github.kokuwaio.DayflowElectron`
   and grants the submitter write access. Later releases arrive there as update
   PRs from the checker; merging one publishes the update.
