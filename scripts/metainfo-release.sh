#!/bin/sh
# Adds a <release> for VERSION to the AppStream metainfo, first in <releases>,
# so software centers show the version being built. CI and the release
# workflow run this on their throwaway checkout. Prereleases
# (0.0.0-branch.sha) are marked type="development". POSIX sh.
set -eu

version=${1:?usage: metainfo-release.sh VERSION [FILE]}
file=${2:-packaging/flatpak/io.github.kokuwaio.DayflowElectron.metainfo.xml}
if grep -q "<release version=\"$version\"" "$file"; then
  exit 0
fi
case "$version" in
  *-*) type=development ;;
  *) type=stable ;;
esac
entry="    <release version=\"$version\" date=\"$(date +%Y-%m-%d)\" type=\"$type\" />"
tmp="$file.tmp.$$"
awk -v entry="$entry" '{ print } /<releases>/ && !done { print entry; done = 1 }' "$file" > "$tmp"
mv "$tmp" "$file"
