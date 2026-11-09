#!/bin/sh
# =====================================================================
#  Bimoto offline map builder — Kigali.
#
#  MAP-RWANDA G3 — this script's job moved to
#  scripts/build-region-pmtiles.command, which builds any of six regions
#  from one region table. This is a thin wrapper that asks it for
#  `kigali`, so anything that already knows this filename — a runbook, a
#  bookmark, an operator's shell history, a Finder double-click — keeps
#  working and keeps producing exactly the archive it always did.
#
#  A wrapper rather than a symlink: it can say what happened, and a
#  symlinked .command double-clicked in Finder is less predictable than a
#  real file.
#
#  Every BIMOTO_MAP_* override still applies; they are read by the script
#  below. To build a province or the whole country:
#
#      sh scripts/build-region-pmtiles.command north
#      sh scripts/build-region-pmtiles.command rwanda
# =====================================================================

set -eu

# shellcheck disable=SC1007  # `CDPATH= cd` is an assignment PREFIX to cd, not
# an empty assignment: it stops a user's CDPATH from silently sending this
# somewhere else. Correct as written; shellcheck misreads the space.
DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

printf '%s\n' "Note: this builder is now scripts/build-region-pmtiles.command."
printf '%s\n' "Building region 'kigali' — same archive, same place."
printf '\n'

exec sh "$DIR/build-region-pmtiles.command" kigali
