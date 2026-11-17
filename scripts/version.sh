#!/bin/sh
# Prints the version for builds: "1.2.3" for a release tag v1.2.3, otherwise
# "0.0.0-<branch>.g<short sha>" (a semver prerelease). Uses GitHub Actions'
# variables in CI and git locally. POSIX sh, runs on Linux and macOS.
set -eu

tag=""
branch=""
sha=""
if [ "${GITHUB_REF_TYPE:-}" = "tag" ]; then
  tag=$GITHUB_REF_NAME
elif [ -n "${GITHUB_ACTIONS:-}" ]; then
  # Pull requests build a merge ref; name them after their branch.
  branch=${GITHUB_HEAD_REF:-${GITHUB_REF_NAME:-}}
  sha=${GITHUB_SHA:-}
else
  tag=$(git describe --tags --exact-match --match 'v[0-9]*' 2>/dev/null || true)
  branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)
  sha=$(git rev-parse HEAD 2>/dev/null || echo 0000000)
fi

case "$tag" in
  v[0-9]*)
    echo "${tag#v}"
    exit 0
    ;;
esac

# Prerelease identifiers allow only [0-9A-Za-z-]; "feat/x_y" becomes "feat-x-y".
slug=$(printf '%s' "$branch" | tr -c '0-9A-Za-z-' '-' | sed 's/--*/-/g; s/^-//; s/-$//')
short=$(printf '%s' "$sha" | cut -c1-7)
# A numeric identifier must not start with 0 (SemVer), so neither part may be
# all digits: the commit gets git describe's "g", a numeric branch a "b".
case "${slug:-unknown}" in
  *[!0-9]*) ;;
  *) slug="b$slug" ;;
esac
echo "0.0.0-${slug:-unknown}.g${short:-0000000}"
