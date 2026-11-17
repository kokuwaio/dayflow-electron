#!/bin/sh
# Writes the Homebrew cask for a release to stdout:
#   scripts/homebrew-cask.sh VERSION ARM64_DMG X64_DMG
# VERSION without the "v"; the two arguments are the release's disk images,
# whose SHA-256 sums go into the cask. POSIX sh, runs on Linux and macOS.
set -eu

version=${1:?usage: homebrew-cask.sh VERSION ARM64_DMG X64_DMG}
arm=${2:?missing the arm64 dmg}
x64=${3:?missing the x64 dmg}

# Fails on a missing or unreadable file instead of printing an empty sum.
sum() {
  [ -r "$1" ] || { echo "homebrew-cask.sh: cannot read $1" >&2; exit 1; }
  if command -v sha256sum >/dev/null 2>&1; then
    out=$(sha256sum "$1")
  else
    out=$(shasum -a 256 "$1")
  fi
  hash=${out%% *}
  case "$hash" in
    [0-9a-f]*) ;;
    *) echo "homebrew-cask.sh: no checksum for $1" >&2; exit 1 ;;
  esac
  [ ${#hash} -eq 64 ] || { echo "homebrew-cask.sh: no checksum for $1" >&2; exit 1; }
  echo "$hash"
}

arm_sum=$(sum "$arm")
x64_sum=$(sum "$x64")
template=$(dirname "$0")/../packaging/homebrew/dayflow-electron.rb.in
sed -e "s/@VERSION@/$version/" \
  -e "s/@SHA256_ARM64@/$arm_sum/" \
  -e "s/@SHA256_X64@/$x64_sum/" \
  "$template"
