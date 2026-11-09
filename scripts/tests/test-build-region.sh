#!/bin/sh
# =====================================================================
#  Tests for scripts/build-region-pmtiles.command and its wrapper.
#
#  MAP-RWANDA G3 — a real build needs Geofabrik, a JDK and several GB of
#  scratch, and the environment this was written in denies Geofabrik and
#  every OSM host outright. So the script carries a dry-run mode that
#  stops before any network, and these tests drive it: the region table,
#  the clip each region gets, the argument Planetiler would actually be
#  handed, and the refusals that matter.
#
#  The refusals matter most. A province with no boundary file must STOP,
#  because the alternative — falling back to an unclipped build — would
#  ship the whole country under a province's name, and nobody would find
#  out until a rider downloaded 100 MB expecting 20.
#
#  Runs on any Linux/macOS box with sh. No Java, no network, no map data.
#
#  Run:  sh scripts/tests/test-build-region.sh
# =====================================================================

set -u

REPO_ROOT=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd -P)
BUILDER=$REPO_ROOT/scripts/build-region-pmtiles.command
WRAPPER=$REPO_ROOT/scripts/build-kigali-pmtiles.command
DERIVE=$REPO_ROOT/scripts/derive-province-polys.command

WORK=${TMPDIR:-/tmp}/bimoto-build-region-tests.$$
rm -rf "$WORK"
mkdir -p "$WORK"
OUT=$WORK/out

PASS=0
FAIL=0

fail() {
  FAIL=$((FAIL + 1))
  printf 'FAIL: %s\n' "$1"
  sed 's/^/      | /' "$OUT" 2>/dev/null | tail -20
}

pass() {
  PASS=$((PASS + 1))
  printf 'ok:   %s\n' "$1"
}

# assert_grep NAME PATTERN
#
# -e is not optional: every interesting pattern here is a Planetiler flag
# starting with --, which grep would otherwise read as its own option and
# fail on. That silently turned the assert_not_grep checks into vacuous
# passes until it was caught.
assert_grep() {
  if grep -qF -e "$2" "$OUT" 2>/dev/null; then pass "$1"; else
    fail "$1 (not found: $2)"
  fi
}

# assert_not_grep NAME PATTERN
assert_not_grep() {
  if grep -qF -e "$2" "$OUT" 2>/dev/null; then
    fail "$1 (unexpectedly found: $2)"
  else pass "$1"; fi
}

# assert_exit NAME EXPECTED ACTUAL
assert_exit() {
  if [ "$2" = "$3" ]; then pass "$1"; else
    fail "$1 (expected exit $2, got $3)"
  fi
}

# The .poly files a province build requires. Content is irrelevant to the
# dry run — the script only checks the file is there.
POLY_DIR=$WORK/poly
mkdir -p "$POLY_DIR"
for r in north south east west; do printf 'stub\n' >"$POLY_DIR/$r.poly"; done

# dryrun REGION [extra env assignments already exported by the caller]
dryrun() {
  BIMOTO_MAP_DRYRUN=1 \
  BIMOTO_MAP_WORK=$WORK/scratch \
  BIMOTO_MAP_OUT=$WORK/data/$1.pmtiles \
    sh "$BUILDER" "$1" >"$OUT" 2>&1
  STATUS=$?
}

printf 'Testing %s\n\n' "$BUILDER"

# ------------------------------------------------- the region table

dryrun rwanda
assert_exit 'rwanda: dry run succeeds' 0 "$STATUS"
assert_grep 'rwanda: is built unclipped' 'clip      none'
assert_not_grep 'rwanda: gets no --bounds' '--bounds'
assert_not_grep 'rwanda: gets no --polygon' '--polygon'

dryrun kigali
assert_exit 'kigali: dry run succeeds' 0 "$STATUS"
# The one coordinate in this dispatch that must not move: kigali's output
# is meant to be byte-for-byte what build-kigali-pmtiles.command made.
assert_grep 'kigali: keeps its original bounding box' \
  '--bounds=29.95,-2.10,30.25,-1.83'
assert_not_grep 'kigali: is not polygon-clipped' '--polygon'

# Provinces need their boundary, and the script must be told where it is.
for r in north south east west; do
  BIMOTO_MAP_DRYRUN=1 \
  BIMOTO_MAP_WORK=$WORK/scratch \
  BIMOTO_MAP_POLY=$POLY_DIR/$r.poly \
  BIMOTO_MAP_OUT=$WORK/data/$r.pmtiles \
    sh "$BUILDER" "$r" >"$OUT" 2>&1
  STATUS=$?
  assert_exit "$r: dry run succeeds" 0 "$STATUS"
  assert_grep "$r: is clipped by polygon" "--polygon=$POLY_DIR/$r.poly"
  assert_not_grep "$r: is not box-clipped" '--bounds'
done

# ------------------------------------------------- zooms and output

dryrun rwanda
assert_grep 'zoom range is z0-z14 by default' '--minzoom=0 --maxzoom=14'
assert_grep 'output is data/<region>.pmtiles' "--output=$WORK/data/rwanda.pmtiles"

BIMOTO_MAP_DRYRUN=1 BIMOTO_MAP_WORK=$WORK/scratch \
  BIMOTO_MAP_MAXZOOM=12 sh "$BUILDER" rwanda >"$OUT" 2>&1
assert_grep 'BIMOTO_MAP_MAXZOOM overrides the zoom range' '--maxzoom=12'

BIMOTO_MAP_DRYRUN=1 BIMOTO_MAP_WORK=$WORK/scratch \
  BIMOTO_MAP_BBOX='1,2,3,4' sh "$BUILDER" north >"$OUT" 2>&1
assert_grep 'BIMOTO_MAP_BBOX overrides a province clip' '--bounds=1,2,3,4'
assert_not_grep 'BIMOTO_MAP_BBOX replaces the polygon, not adds to it' '--polygon'

# ------------------------------------------------- refusals

BIMOTO_MAP_DRYRUN=1 sh "$BUILDER" atlantis >"$OUT" 2>&1
STATUS=$?
assert_exit 'an unknown region is refused' 1 "$STATUS"
assert_grep 'an unknown region names the valid ones' \
  'Use one of: rwanda kigali north south east west'

# The important one. No .poly, no province — a silent unclipped build
# would ship the whole country under a province's name.
BIMOTO_MAP_WORK=$WORK/scratch \
  BIMOTO_MAP_POLY=$WORK/does-not-exist.poly \
  sh "$BUILDER" north >"$OUT" 2>&1
STATUS=$?
assert_exit 'a province without its boundary REFUSES' 1 "$STATUS"
assert_grep 'and says how to make the boundary' \
  'sh scripts/derive-province-polys.command'
assert_not_grep 'and did not silently build the whole country' 'Building north'

# ------------------------------------------------- the wrapper

BIMOTO_MAP_DRYRUN=1 BIMOTO_MAP_WORK=$WORK/scratch sh "$WRAPPER" >"$OUT" 2>&1
STATUS=$?
assert_exit 'the old kigali script still runs' 0 "$STATUS"
assert_grep 'the old kigali script builds kigali' 'region    kigali'
assert_grep 'the old kigali script builds the same box' \
  '--bounds=29.95,-2.10,30.25,-1.83'
assert_grep 'the old kigali script says where it moved to' \
  'scripts/build-region-pmtiles.command'

# ------------------------------------------------- boundary derivation

# Without an extract there is nothing to derive from; with no osmium
# there is nothing to derive with. Either way it must stop cleanly rather
# than write half a boundary.
BIMOTO_MAP_WORK=$WORK/nothing-here BIMOTO_POLY_DIR=$WORK/poly-out \
  sh "$DERIVE" >"$OUT" 2>&1
STATUS=$?
assert_exit 'boundary derivation refuses when it cannot proceed' 1 "$STATUS"
if grep -qF 'osmium-tool is not installed' "$OUT"; then
  pass 'boundary derivation names its one operator dependency'
else
  assert_grep 'boundary derivation says no extract was found' \
    'no rwanda extract found'
fi
if [ -e "$WORK/poly-out" ] && [ -n "$(ls -A "$WORK/poly-out" 2>/dev/null)" ]; then
  fail 'boundary derivation wrote files despite refusing'
else
  pass 'boundary derivation wrote nothing when it refused'
fi

# ------------------------------------------------- no side effects

if [ -e "$WORK/data" ]; then
  fail 'a dry run created output files'
else
  pass 'a dry run touches nothing on disk'
fi

# =============================================================== summary

rm -rf "$WORK"
printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" = 0 ] || exit 1
exit 0
