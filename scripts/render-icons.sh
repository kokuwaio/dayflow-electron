#!/bin/sh
# Renders the PNG icons in resources/ from their SVG sources (`make icons`).
# Run it after changing an SVG and commit the PNGs with it.
#   icon.svg         -> icon.png (512 px: window, Windows, macOS, Flatpak)
#   tray.svg         -> tray.png (32 px), tray@2x.png (64 px): Linux and Windows tray
#   trayTemplate.svg -> trayTemplate.png (16 px), trayTemplate@2x.png (32 px): macOS menu bar
# Needs rsvg-convert (librsvg: `brew install librsvg`, `apt install librsvg2-bin`).
# POSIX sh, runs on Linux and macOS.
set -eu

cd "$(dirname "$0")/../resources"

if ! command -v rsvg-convert >/dev/null 2>&1; then
  echo "render-icons: rsvg-convert not found; install librsvg" >&2
  exit 1
fi

render() { # <svg> <size> <png>
  rsvg-convert -w "$2" -h "$2" "$1" >"$3"
  echo "$3 (${2}x$2)"
}

render icon.svg 512 icon.png
render tray.svg 32 tray.png
render tray.svg 64 tray@2x.png
render trayTemplate.svg 16 trayTemplate.png
render trayTemplate.svg 32 trayTemplate@2x.png
