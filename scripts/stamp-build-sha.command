#!/bin/sh
# MATCH-CLOSE G4 — stamp this source tree with the commit it was cut from.
#
# Run this ONCE, from a git checkout, just before you make the update
# folder you send to Kigali:
#
#     sh scripts/stamp-build-sha.command
#
# It writes a single file, BUILD_SHA, at the root of the tree. The
# update bundle is a plain copy of the tree with .git excluded, so that
# file travels with it; update-pilot.command then places it into the
# install, and the server's build-identity ladder reads it. Without this
# step the Kigali install has no .git, no RENDER_GIT_COMMIT and no
# BUILD_SHA env var, so /api/health answers "unknown" — which is exactly
# the blind spot this closes.
#
# BUILD_SHA is git-ignored on purpose: a stamp that lived in git would
# be a commit id from whenever it was last committed, which is worse
# than none at all because it looks right.

set -eu

cd "$(dirname "$0")/.."

if ! git rev-parse --short=7 HEAD >/dev/null 2>&1; then
  echo "stamp-build-sha: not a git checkout — nothing to stamp." >&2
  echo "Run this from the repository, not from an unzipped bundle." >&2
  exit 1
fi

SHA=$(git rev-parse --short=7 HEAD)

if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
  echo "stamp-build-sha: WARNING — the tree has uncommitted changes, so"
  echo "the bundle will not be exactly $SHA. Commit first if that matters."
fi

printf '%s\n' "$SHA" >BUILD_SHA

echo "stamp-build-sha: wrote BUILD_SHA = $SHA"
echo "The bundle you make from this folder will now report its own build"
echo "at /api/health and in the app's Diagnostics screen."
