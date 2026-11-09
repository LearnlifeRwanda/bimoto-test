#!/bin/sh
# =====================================================================
#  Bimoto — derive the four province boundaries from OSM.
#
#  How to run it (macOS):
#    * run:  sh scripts/derive-province-polys.command
#    * once, before the first province build. The boundaries only change
#      when Rwanda redraws a province, which is not often.
#
#  WHAT IT MAKES
#    data/poly/north.poly   Amajyaruguru  / Northern Province
#    data/poly/south.poly   Amajyepfo     / Southern Province
#    data/poly/east.poly    Iburasirazuba / Eastern Province
#    data/poly/west.poly    Iburengerazuba/ Western Province
#
#  Those are the files scripts/build-region-pmtiles.command hands to
#  Planetiler as --polygon. They are generated, never committed — see
#  .gitignore.
#
#  WHY NOT BOUNDING BOXES
#  Provinces are not rectangles. A box around Amajyaruguru overlaps three
#  neighbours, so four box-built provinces would ship the same roads
#  three times over and a rider downloading two provinces would pay twice
#  for the overlap. Planetiler clips to a shape natively, so each
#  province is built against its real boundary.
#
#  WHY OSMIUM, AND WHY IT IS NOT BUNDLED
#  The boundaries are already inside the Rwanda extract the builder
#  downloads: OSM relations with boundary=administrative and
#  admin_level=4. Planetiler CONSUMES a .poly file but does not produce
#  one and has no boundary-export mode, so there is no pure-Planetiler
#  path. osmium-tool reads the extract and writes GeoJSON; the conversion
#  to .poly is scripts/geojson-to-poly.mjs, which is plain Node and is
#  covered by scripts/tests/geojson-to-poly.test.mjs.
#
#  osmium is OPERATOR-SIDE TOOLING on the founder's Mac. It is not a
#  dependency of the app, is not installed on any server, and nothing the
#  riders run has ever heard of it. Install it once:
#
#      brew install osmium-tool
#
#  Kigali is not derived here: it keeps the bounding box it has always
#  been built with, so its archive stays byte-for-byte what it was.
#  Kigali City is also an admin_level=4 entity in OSM, so switching it to
#  a polygon later is a one-line change to the region table — deliberately
#  not made now, because changing Kigali's output is not this dispatch's
#  job.
#
#  Environment overrides (developers and tests only):
#    BIMOTO_MAP_AREA   Geofabrik area name (rwanda)
#    BIMOTO_MAP_WORK   scratch dir holding the source extract
#    BIMOTO_POLY_DIR   output dir (<repo>/data/poly)
#    BIMOTO_MAP_PBF    use this .osm.pbf instead of looking for one
# =====================================================================

set -eu

# shellcheck disable=SC1007  # `CDPATH= cd` is an assignment PREFIX to cd, not
# an empty assignment: it stops a user's CDPATH from silently sending this
# somewhere else. Correct as written; shellcheck misreads the space.
REPO_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
AREA="${BIMOTO_MAP_AREA:-rwanda}"
WORK="${BIMOTO_MAP_WORK:-$REPO_ROOT/.map-build}"
POLY_DIR="${BIMOTO_POLY_DIR:-$REPO_ROOT/data/poly}"

say() { printf '%s\n' "$*"; }
die() { printf '\nStopped: %s\n' "$*" >&2; exit 1; }

# The OSM name of each province, as tagged on the admin_level=4 relation.
# Kinyarwanda names are what OSM carries in `name`; the English ones are
# in `name:en`. Matching on both means a retagging in either language
# does not silently produce an empty boundary.
provinces() {
  cat <<'TABLE'
north|Amajyaruguru|Northern Province
south|Amajyepfo|Southern Province
east|Iburasirazuba|Eastern Province
west|Iburengerazuba|Western Province
TABLE
}

say "Bimoto province boundary derivation"
say "  area      $AREA"
say "  output    $POLY_DIR"
say ""

# --- 1. tools --------------------------------------------------------
command -v osmium >/dev/null 2>&1 \
  || die "osmium-tool is not installed. On macOS:  brew install osmium-tool
  It is operator-side tooling for this one step; nothing the app runs
  needs it."
command -v node >/dev/null 2>&1 || die "node is not installed."

# --- 2. the source extract ------------------------------------------
# Reuse whatever the builder already downloaded rather than fetching
# again — a country extract is not small, and Planetiler's copy is
# exactly the data the archives will be built from.
if [ -n "${BIMOTO_MAP_PBF:-}" ]; then
  PBF="$BIMOTO_MAP_PBF"
else
  # shellcheck disable=SC2012    # the source extracts are Geofabrik-named
  # (rwanda-latest.osm.pbf); `ls -t` is picking the newest of a known,
  # well-named set, and find(1) has no portable -newest.
  PBF=$(ls -t "$WORK/data/sources/${AREA}"*.osm.pbf 2>/dev/null | head -1 || true)
fi

if [ -z "$PBF" ] || [ ! -f "$PBF" ]; then
  die "no $AREA extract found under $WORK/data/sources.
  Run a build first so Planetiler downloads it:

      sh scripts/build-region-pmtiles.command rwanda

  then run this again. (Or point BIMOTO_MAP_PBF at an .osm.pbf.)"
fi

say "Source: $PBF"
mkdir -p "$POLY_DIR" || die "cannot create $POLY_DIR"

# --- 3. the admin_level=4 boundaries --------------------------------
# One pass over the extract, kept for every province rather than paying
# for the whole country five times.
BOUNDARIES="$POLY_DIR/.admin4.osm.pbf"
GEOJSON="$POLY_DIR/.admin4.geojson"

# These three are scratch. Before the trap they were removed by a `rm`
# at the end of step 5, which a `die` anywhere in between skipped — so
# the Update 5 build left .admin4.osm.pbf, .admin4.geojson and
# .north.geojsonl sitting in data/poly/, from where they were picked up
# into the server bundle. Megabytes of dead weight the updater shipped
# and nobody asked for. An EXIT trap does not care how the script ends.
trap 'rm -f "$BOUNDARIES" "$GEOJSON" "$POLY_DIR"/.*.geojsonl' EXIT

say "Filtering admin_level=4 boundary relations…"
osmium tags-filter "$PBF" \
  r/boundary=administrative \
  -o "$BOUNDARIES" --overwrite \
  || die "osmium tags-filter failed."

say "Exporting boundary geometries…"
# --geometry-types=polygon keeps the areas and drops the stray ways;
# osmium export assembles the multipolygon relations for us.
osmium export "$BOUNDARIES" \
  --geometry-types=polygon \
  --add-unique-id=type_id \
  -o "$GEOJSON" --overwrite \
  || die "osmium export failed."

# --- 4. one .poly per province --------------------------------------
WROTE=0
# Fed by here-doc rather than `provinces | while`: a pipeline runs the
# loop in a SUBSHELL, so WROTE was incremented in a child and the parent
# always read 0 back after the loop.
while IFS='|' read -r key rw en; do
  say ""
  say "  $key — $rw / $en"

  # Pick this province's features out of the export by name, in either
  # language, and only at admin_level 4. node does the selection because
  # matching JSON in the shell would be guesswork about quoting — and
  # because the export's SHAPE is a property of the filename osmium was
  # given (.geojson is one FeatureCollection; .geojsonseq is one object
  # per line). select-admin4.mjs reads either, which the inline block it
  # replaces did not: it assumed the sequence, got the collection, and
  # reported every province missing.
  FEATURES="$POLY_DIR/.$key.geojsonl"
  node "$REPO_ROOT/scripts/select-admin4.mjs" "$rw" "$en" < "$GEOJSON" > "$FEATURES" \
    || die "could not find the boundary for $key ($rw / $en).
  The extract has admin_level=4 relations but none with that name. OSM
  may have retagged it. Inspect with:
      osmium export $BOUNDARIES --geometry-types=polygon | \\
        node -e 'require(\"readline\").createInterface({input:process.stdin}).on(\"line\",l=>{const p=JSON.parse(l).properties||{};if(String(p.admin_level)===\"4\")console.log(p.name,\"|\",p[\"name:en\"])})'"

  node "$REPO_ROOT/scripts/geojson-to-poly.mjs" "$key" < "$FEATURES" > "$POLY_DIR/$key.poly" \
    || die "converting $key to .poly failed."

  rm -f "$FEATURES"
  say "    wrote $POLY_DIR/$key.poly ($(wc -l < "$POLY_DIR/$key.poly" | tr -d ' ') lines)"
  WROTE=$((WROTE + 1))
done <<TABLE
$(provinces)
TABLE

# --- 5. tidy up ------------------------------------------------------
# The intermediates are the EXIT trap's business now (see step 3), so
# they go whether this line is reached or a die jumps over it.

say ""
say "Done — wrote $WROTE .poly files. Now build the provinces:"
say ""
say "  sh scripts/build-region-pmtiles.command north"
say "  sh scripts/build-region-pmtiles.command south"
say "  sh scripts/build-region-pmtiles.command east"
say "  sh scripts/build-region-pmtiles.command west"
say ""
