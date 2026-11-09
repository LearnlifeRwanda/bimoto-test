#!/bin/sh
# =====================================================================
#  Bimoto offline map builder — makes data/<region>.pmtiles.
#
#  How to run it (macOS):
#    * run:  sh scripts/build-region-pmtiles.command <region>
#    * or double-click it (it opens in Terminal) to build kigali.
#
#  Regions:
#    rwanda   the whole country, unclipped
#    kigali   Umujyi wa Kigali            (bounding box, as it always was)
#    north    Amajyaruguru / Northern     (clipped to the province)
#    south    Amajyepfo / Southern        (clipped to the province)
#    east     Iburasirazuba / Eastern     (clipped to the province)
#    west     Iburengerazuba / Western    (clipped to the province)
#
#  WHY THIS EXISTS
#  The offline map — client download manager, Dexie cache, vector
#  renderer, server route, three languages of copy — shipped complete and
#  stayed dark, because the one artefact it needs did not exist and no
#  script made it. This script is that missing artefact's recipe.
#
#  MAP-RWANDA G3 — and it is no longer one artefact. The country is
#  downloadable a province at a time, so this builds any of six regions
#  with one region table and no duplicated logic. It replaces
#  build-kigali-pmtiles.command, which is kept as a thin wrapper that
#  calls this with `kigali` — a wrapper rather than a symlink, because it
#  can say what happened, and because a symlinked .command double-clicked
#  in Finder is less predictable than a real file.
#
#  WHY PROVINCES ARE CLIPPED BY POLYGON, NOT BY BOX
#  Provinces are not rectangles. A bounding box around Amajyaruguru
#  overlaps three neighbours, so four box-built provinces would ship the
#  same roads three times over and a rider downloading two provinces
#  would pay twice for the overlap. Planetiler clips to a shape natively
#  (--polygon=<file>, "a .poly file that limits output to tiles
#  intersecting the shape"), so each province is built against its own
#  boundary.
#
#  WHERE THE BOUNDARIES COME FROM
#  The province boundaries are already inside the Rwanda extract this
#  script downloads: OSM admin_level=4 relations. They are NOT committed
#  to this repo — they are derived, like the archives themselves, by:
#
#      sh scripts/derive-province-polys.command
#
#  which writes data/poly/<region>.poly. That helper needs osmium-tool
#  (`brew install osmium-tool`) on the operator Mac. Planetiler CONSUMES
#  a .poly file but does not produce one, and it has no boundary-export
#  mode, so there is no pure-Planetiler path — osmium is operator-side
#  tooling, documented here and never bundled into the app.
#
#  WHAT IT DOES
#    1. Checks its tools BEFORE downloading anything.
#    2. Fetches Planetiler (a single Java jar) if not already cached.
#    3. Fetches the named OSM source extract via Planetiler's own
#       Geofabrik download, unless one is already cached.
#    4. Builds a PMTiles archive for the region, clipped by bounding box
#       (kigali), by boundary polygon (the four provinces), or not at all
#       (rwanda), over the zoom range below.
#    5. Writes data/<region>.pmtiles plus data/<region>.pmtiles.json, a
#       manifest recording the source, clip, zoom range, source vintage,
#       measured size in MB and measured build time.
#    6. Prints the measured size and build time.
#
#  It never touches .env. The server serves whatever archives it finds in
#  data/ with no configuration at all — see
#  packages/server/src/services/map-extract.ts. MAP_PMTILES_PATH remains
#  an operator override and this script must never write it, because
#  scripts/update-pilot.command promises the operator their settings are
#  kept exactly as they are.
#
#  Environment overrides (developers and tests only):
#    BIMOTO_MAP_AREA        Geofabrik area name (rwanda)
#    BIMOTO_MAP_MINZOOM     lowest zoom built (0)
#    BIMOTO_MAP_MAXZOOM     highest zoom built (14)
#    BIMOTO_MAP_BBOX        W,S,E,N in degrees — overrides the region's
#    BIMOTO_MAP_POLY        .poly path — overrides the region's
#    BIMOTO_MAP_OUT         output path (<repo>/data/<region>.pmtiles)
#    BIMOTO_MAP_WORK        scratch dir for downloads (<repo>/.map-build)
#    BIMOTO_MAP_DRYRUN      1 = print the plan and stop before any
#                           network or build (used to verify this script
#                           where a real build cannot run)
#    PLANETILER_JAR         use an already-downloaded jar
# =====================================================================

set -eu

REGION="${1:-kigali}"

# --- what we build -------------------------------------------------
# Source: Geofabrik's Rwanda country extract, rebuilt daily from the OSM
# planet. Named, not scraped: bulk-pulling tiles from OSM's own servers
# would violate their tile usage policy, which is the whole reason this
# archive is self-hosted.
AREA="${BIMOTO_MAP_AREA:-rwanda}"

# z0-z14. z14 is the practical floor for street-level navigation with
# vector tiles: the renderer over-zooms past it without new data, so
# building z15+ multiplies size for no visible gain on a phone. Every
# region uses the same range — a rider in Musanze needs the same street
# detail a rider in Kigali does.
MINZOOM="${BIMOTO_MAP_MINZOOM:-0}"
MAXZOOM="${BIMOTO_MAP_MAXZOOM:-14}"

PLANETILER_VERSION="0.8.3"
PLANETILER_URL="https://github.com/onthegomap/planetiler/releases/download/v${PLANETILER_VERSION}/planetiler.jar"

# --- where things go -----------------------------------------------
# shellcheck disable=SC1007  # `CDPATH= cd` is an assignment PREFIX to cd, not
# an empty assignment: it stops a user's CDPATH from silently sending this
# somewhere else. Correct as written; shellcheck misreads the space.
REPO_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
WORK="${BIMOTO_MAP_WORK:-$REPO_ROOT/.map-build}"
JAR="${PLANETILER_JAR:-$WORK/planetiler.jar}"
POLY_DIR="$REPO_ROOT/data/poly"

say() { printf '%s\n' "$*"; }
die() { printf '\nStopped: %s\n' "$*" >&2; exit 1; }

# --- the region table ----------------------------------------------
# ONE place decides what each region is. Everything else in this script
# reads CLIP_KIND and CLIP_VALUE.
#
#   bbox  W,S,E,N degrees, passed to Planetiler as --bounds
#   poly  a .poly boundary file, passed as --polygon
#   none  the whole source extract
BBOX=""
POLY=""
case "$REGION" in
  kigali)
    # Kigali and its approaches — unchanged from build-kigali-pmtiles
    # .command, so this region's output is byte-for-byte what it was.
    # Wide enough that a motari riding out to the edges of the city keeps
    # a map; tight enough that the archive stays a reasonable download
    # over Kigali mobile data.
    CLIP_KIND="bbox"
    BBOX="29.95,-2.10,30.25,-1.83"
    ;;
  north|south|east|west)
    CLIP_KIND="poly"
    POLY="$POLY_DIR/$REGION.poly"
    ;;
  rwanda)
    # The whole country, exactly as Geofabrik cut it. No clip: the source
    # extract already IS the national boundary.
    CLIP_KIND="none"
    ;;
  *)
    die "unknown region '$REGION'. Use one of: rwanda kigali north south east west"
    ;;
esac

# Explicit overrides win, and switch the clip kind with them.
if [ -n "${BIMOTO_MAP_BBOX:-}" ]; then
  CLIP_KIND="bbox"; BBOX="$BIMOTO_MAP_BBOX"; POLY=""
elif [ -n "${BIMOTO_MAP_POLY:-}" ]; then
  CLIP_KIND="poly"; POLY="$BIMOTO_MAP_POLY"; BBOX=""
fi

OUT="${BIMOTO_MAP_OUT:-$REPO_ROOT/data/$REGION.pmtiles}"
MANIFEST="$OUT.json"

case "$CLIP_KIND" in
  bbox) CLIP_DESC="bbox $BBOX" ;;
  poly) CLIP_DESC="polygon $POLY" ;;
  *)    CLIP_DESC="none (whole $AREA extract)" ;;
esac

say "Bimoto offline map builder"
say "  region    $REGION"
say "  area      $AREA"
say "  clip      $CLIP_DESC"
say "  zooms     z$MINZOOM-z$MAXZOOM"
say "  output    $OUT"
say ""

# --- 0. dry run ------------------------------------------------------
# A real build needs Geofabrik, several GB of scratch and a long while.
# This mode proves the region table, the clip selection and the argument
# assembly without any of that.
if [ "${BIMOTO_MAP_DRYRUN:-}" = "1" ]; then
  say "DRY RUN — stopping before any download or build."
  say "Planetiler would be called as:"
  say "  java -Xmx4g -jar $JAR --download --area=$AREA \\"
  case "$CLIP_KIND" in
    bbox) say "    --bounds=$BBOX \\" ;;
    poly) say "    --polygon=$POLY \\" ;;
  esac
  say "    --minzoom=$MINZOOM --maxzoom=$MAXZOOM \\"
  say "    --data=$WORK/data --tmpdir=$WORK/tmp \\"
  say "    --output=$OUT --force"
  exit 0
fi

# --- 1. check tools before touching anything -----------------------
command -v java >/dev/null 2>&1 || die "Java is not installed. Install a JDK 17 or newer, then run this again."

JAVA_MAJOR=$(java -version 2>&1 | head -1 | sed -n 's/.*version "\([0-9]*\).*/\1/p')
if [ -n "$JAVA_MAJOR" ] && [ "$JAVA_MAJOR" -lt 17 ] 2>/dev/null; then
  die "Java $JAVA_MAJOR found, but Planetiler needs 17 or newer."
fi

if [ -z "${PLANETILER_JAR:-}" ]; then
  command -v curl >/dev/null 2>&1 || die "curl is not installed."
fi

# A province cannot be built without its boundary, and a silent fall back
# to an unclipped build would ship the whole country under a province's
# name — much worse than stopping.
if [ "$CLIP_KIND" = "poly" ] && [ ! -f "$POLY" ]; then
  die "no boundary file at $POLY.
  Province builds clip to the real provincial boundary, which is derived
  from the OSM admin_level=4 data in the Rwanda extract. Make them once
  with:

      sh scripts/derive-province-polys.command

  then run this again."
fi

mkdir -p "$WORK" "$(dirname -- "$OUT")" || die "cannot create $WORK"

# --- 2. Planetiler ---------------------------------------------------
if [ ! -f "$JAR" ]; then
  say "Downloading Planetiler $PLANETILER_VERSION (about 80 MB, once)…"
  curl -fL --retry 3 -o "$JAR.part" "$PLANETILER_URL" </dev/null \
    || die "could not download Planetiler from $PLANETILER_URL"
  mv "$JAR.part" "$JAR"
fi
say "Planetiler: $JAR"

# --- 3+4. build ------------------------------------------------------
# --download fetches the Geofabrik area extract into --data if absent.
# --bounds clips to a box, --polygon to a shape, neither builds it all.
# --force overwrites a previous archive. The .pmtiles extension is what
# selects the PMTiles writer.
say ""
say "Building $REGION. First run downloads the $AREA extract; expect this"
say "to take a while and to use a few GB of scratch space in $WORK."
say ""

BUILD_START=$(date +%s)

# The clip flag is assembled into a variable so there is exactly one
# java invocation to keep correct, whatever the region.
case "$CLIP_KIND" in
  bbox) set -- --bounds="$BBOX" ;;
  poly) set -- --polygon="$POLY" ;;
  *)    set -- ;;
esac

java -Xmx4g -jar "$JAR" \
  --download \
  --area="$AREA" \
  "$@" \
  --minzoom="$MINZOOM" \
  --maxzoom="$MAXZOOM" \
  --data="$WORK/data" \
  --tmpdir="$WORK/tmp" \
  --output="$OUT" \
  --force \
  </dev/null || die "Planetiler failed. The log above says why; nothing was installed."

BUILD_END=$(date +%s)
BUILD_SECONDS=$((BUILD_END - BUILD_START))

[ -f "$OUT" ] || die "Planetiler reported success but $OUT is not there."

# --- 5. manifest -----------------------------------------------------
# Vintage = the mtime of the source .osm.pbf Planetiler actually used,
# not "today": an archive rebuilt from a month-old cached download must
# not claim to be current.
# shellcheck disable=SC2012  # the source extracts are Geofabrik-named
# (rwanda-latest.osm.pbf); `ls -t` is picking the newest of a known,
# well-named set, and find(1) has no portable -newest.
SOURCE_PBF=$(ls -t "$WORK/data/sources/${AREA}"*.osm.pbf 2>/dev/null | head -1 || true)
if [ -n "$SOURCE_PBF" ]; then
  VINTAGE=$(date -u -r "$SOURCE_PBF" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo unknown)
else
  VINTAGE=unknown
fi

SIZE_BYTES=$(wc -c < "$OUT" | tr -d ' ')
SIZE_MB=$(awk -v b="$SIZE_BYTES" 'BEGIN{printf "%.1f", b/1048576}')
BUILT_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)

cat > "$MANIFEST" <<JSON
{
  "artifact": "$REGION.pmtiles",
  "region": "$REGION",
  "source": "geofabrik:$AREA",
  "sourceVintage": "$VINTAGE",
  "clip": "$CLIP_KIND",
  "bbox": "$BBOX",
  "polygon": "$(basename -- "${POLY:-}")",
  "minzoom": $MINZOOM,
  "maxzoom": $MAXZOOM,
  "sizeBytes": $SIZE_BYTES,
  "sizeMB": $SIZE_MB,
  "buildSeconds": $BUILD_SECONDS,
  "builtAt": "$BUILT_AT",
  "planetilerVersion": "$PLANETILER_VERSION"
}
JSON

# --- 6. report -------------------------------------------------------
say ""
say "Done."
say "  region          $REGION"
say "  archive         $OUT"
say "  size            $SIZE_MB MB ($SIZE_BYTES bytes)"
say "  build time      ${BUILD_SECONDS}s"
say "  source vintage  $VINTAGE"
say "  manifest        $MANIFEST"
say ""
say "The server serves this with no configuration: it lists whatever"
say "archives are in data/. Restart is not required."
say "Check it with:  curl -b <auth> http://localhost:3000/api/map/regions"
