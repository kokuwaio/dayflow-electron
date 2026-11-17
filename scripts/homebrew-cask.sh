#!/bin/sh
# Writes the Homebrew cask for a release to stdout:
#   scripts/homebrew-cask.sh VERSION ARM64_DMG X64_DMG
# VERSION without the "v"; the two arguments are the release's disk images,
# whose SHA-256 sums go into the cask. POSIX sh, runs on Linux and macOS.
set -eu

version=${1:?usage: homebrew-cask.sh VERSION ARM64_DMG X64_DMG}
arm=${2:?missing the arm64 dmg}
x64=${3:?missing the x64 dmg}

sum() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

template=$(dirname "$0")/../packaging/homebrew/dayflow-electron.rb.in
sed -e "s/@VERSION@/$version/" \
  -e "s/@SHA256_ARM64@/$(sum "$arm")/" \
  -e "s/@SHA256_X64@/$(sum "$x64")/" \
  "$template"
