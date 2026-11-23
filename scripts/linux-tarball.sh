#!/bin/sh
# Packs a Flatpak bundle with a launcher into the tarball that releases carry
# for `mise use -g github:kokuwaio/dayflow-electron` (or unpacking by hand):
# dayflow-electron-linux-<arch>.tar.gz with one top-level dayflow-electron/
# folder holding the bundle and bin/dayflow-electron. The launcher installs
# the bundle for the current user on its first start, so on Linux the app
# still runs as the Flatpak. POSIX sh, runs on Linux and macOS.
#
#   scripts/linux-tarball.sh <bundle.flatpak> <x64|arm64> <output dir>
set -eu

if [ $# -ne 3 ]; then
  echo "usage: $0 <bundle.flatpak> <x64|arm64> <output dir>" >&2
  exit 2
fi
bundle=$1
arch=$2
out=$3
case "$arch" in
  x64 | arm64) ;;
  *)
    echo "arch must be x64 or arm64, not $arch" >&2
    exit 2
    ;;
esac
[ -f "$bundle" ] || { echo "no Flatpak bundle at $bundle" >&2; exit 1; }

stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
root=$stage/dayflow-electron
mkdir -p "$root/bin"
cp "$bundle" "$root/dayflow-electron.flatpak"
cat > "$root/bin/dayflow-electron" <<'EOF'
#!/bin/sh
# Dayflow Electron runs as a Flatpak on Linux. This launcher (what mise puts on
# PATH) installs the bundle next to it for the current user, unless that exact
# build is already installed. Without arguments (or with a deep link) it starts
# the app; with arguments it is the `dayflow-electron` CLI, like the terminal
# command from Settings → MCP / CLI.
set -eu
app=io.github.kokuwaio.DayflowElectron
dir=$(cd "$(dirname "$0")/.." && pwd -P)
# The commit this bundle installed; mise gives every version its own folder.
stamp=$dir/.installed-commit

if ! command -v flatpak >/dev/null 2>&1; then
  echo "dayflow-electron runs as a Flatpak; install Flatpak first: https://flatpak.org/setup/" >&2
  exit 1
fi
commit=$(flatpak info --user --show-commit "$app" 2>/dev/null || true)
if [ -z "$commit" ] || [ ! -f "$stamp" ] || [ "$(cat "$stamp")" != "$commit" ]; then
  echo "Installing the Dayflow Electron Flatpak for this user..." >&2
  # The runtime comes from Flathub; with the remote, `flatpak update` updates it independently of the app.
  # Progress to stderr: stdout belongs to the CLI (JSON output, the MCP server).
  flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo >&2
  flatpak install --user --noninteractive --reinstall "$dir/dayflow-electron.flatpak" >&2
  flatpak info --user --show-commit "$app" > "$stamp" 2>/dev/null || true
fi
case "${1:-}" in
  '' | dayflow-electron:*) exec flatpak run "$app" "$@" ;;
  *) exec flatpak run --command=dayflow-electron-cli "$app" "$@" ;;
esac
EOF
chmod 755 "$root/bin/dayflow-electron"

mkdir -p "$out"
tar -C "$stage" -czf "$out/dayflow-electron-linux-$arch.tar.gz" dayflow-electron
echo "$out/dayflow-electron-linux-$arch.tar.gz"
