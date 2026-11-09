# The offline map archives

`data/*.pmtiles` are the artefacts the offline map needs. Everything else
— the client download manager, the Dexie cache, the vector renderer, the
server route, the copy in three languages — shipped complete and sat
inert because these files did not exist and nothing made them.
`GET /api/map/kigali.pmtiles` answered `404 MAP_NOT_AVAILABLE` on every
server in the world, and that 404 was reported as a fault when it was the
system telling the truth.

**MAP-RWANDA** makes it the whole country, a province at a time. There
are six regions, and the server has no list of them: **whatever
`.pmtiles` files are in `data/` are the regions this server offers.**
Provisioning a region is dropping one file on the server. Nothing to
configure, nothing to redeploy.

This note is the recipe and the wiring.

## The regions

| key | Kinyarwanda | English | how it is cut |
| --- | --- | --- | --- |
| `rwanda` | U Rwanda | the whole country | the Geofabrik extract, unclipped |
| `kigali` | Umujyi wa Kigali | Kigali City | bounding box `29.95,-2.10,30.25,-1.83` |
| `north` | Amajyaruguru | Northern Province | clipped to the province boundary |
| `south` | Amajyepfo | Southern Province | clipped to the province boundary |
| `east` | Iburasirazuba | Eastern Province | clipped to the province boundary |
| `west` | Iburengerazuba | Western Province | clipped to the province boundary |

Kigali keeps its bounding box rather than moving to a polygon, so its
archive stays byte-for-byte what it already was. Kigali City is also an
`admin_level=4` entity in OSM, so switching it later is a one-line change
to the region table in the builder — deliberately not made now.

## Build them

Once, to fetch the source extract and derive the province boundaries:

```sh
sh scripts/build-region-pmtiles.command rwanda     # also downloads the extract
sh scripts/derive-province-polys.command           # needs: brew install osmium-tool
```

Then one command per region:

```sh
sh scripts/build-region-pmtiles.command kigali
sh scripts/build-region-pmtiles.command north
sh scripts/build-region-pmtiles.command south
sh scripts/build-region-pmtiles.command east
sh scripts/build-region-pmtiles.command west
```

Each checks its tools before downloading anything, reuses the cached
Planetiler jar and OSM extract, writes `data/<region>.pmtiles` plus a
manifest, and prints the **measured** size and build time.

`scripts/build-kigali-pmtiles.command` still works — it is now a thin
wrapper that calls the above with `kigali`, so a runbook or a shell
history that knows the old name keeps producing the same archive.

### Why provinces are clipped by polygon, not by box

Provinces are not rectangles. A bounding box around Amajyaruguru overlaps
three of its neighbours, so four box-built provinces would ship the same
roads three times over and a rider who downloaded two provinces would pay
for the overlap twice. Planetiler clips to a shape natively
(`--polygon=<file>`, "a `.poly` file that limits output to tiles
intersecting the shape"), so each province is built against its real
boundary.

### Where the boundaries come from

They are already inside the Rwanda extract the builder downloads: OSM
relations with `boundary=administrative` and `admin_level=4`.
`scripts/derive-province-polys.command` filters them out with `osmium`,
exports the geometries, and converts each to the `.poly` format
Planetiler reads. The conversion is `scripts/geojson-to-poly.mjs` — plain
Node, covered by `scripts/tests/geojson-to-poly.test.mjs`, including the
multipolygon and hole cases a real province boundary has (an exclave; a
lake or district enclave cut out, which must be a `!` ring or the hole
gets clipped *into* the province).

Planetiler consumes a `.poly` file but does not produce one and has no
boundary-export mode, so there is **no pure-Planetiler path**. `osmium`
is operator-side tooling on the founder's Mac — installed once with
`brew install osmium-tool`, not a dependency of the app, not on any
server, and nothing the riders run has ever heard of it. The `.poly`
files are generated into `data/poly/` and gitignored, like the archives.

## What gets built

| | |
| --- | --- |
| **Source** | Geofabrik `rwanda` country extract (`geofabrik:rwanda`), rebuilt daily from the OSM planet |
| **Clip** | per region — see the table above |
| **Zoom range** | z0–z14, every region |
| **Tile format** | Mapbox Vector Tiles in a single PMTiles v3 archive |
| **Builder** | Planetiler 0.8.3 (one Java jar, JDK 17+) |
| **Vintage** | recorded per build — see below |

Every one of those is also written into `data/<region>.pmtiles.json`
beside the archive, so an archive found on a machine can always account
for itself:

```json
{
  "artifact": "north.pmtiles",
  "region": "north",
  "source": "geofabrik:rwanda",
  "sourceVintage": "2026-08-07T03:14:22Z",
  "clip": "poly",
  "bbox": "",
  "polygon": "north.poly",
  "minzoom": 0,
  "maxzoom": 14,
  "sizeBytes": 0,
  "sizeMB": 0.0,
  "buildSeconds": 0,
  "builtAt": "2026-08-08T09:00:00Z",
  "planetilerVersion": "0.8.3"
}
```

The server reads `sizeBytes` from the **file**, not from this manifest —
`stat()`, every request to `/api/map/regions`. The manifest says how an
archive was built; the filesystem says how big it is.

`sourceVintage` is the modification time of the `.osm.pbf` Planetiler
actually consumed — **not** the build date. An archive rebuilt from a
month-old cached download must not claim to be current, and this is the
field that stops it.

### Why z14, everywhere

z14 is the practical floor for street-level navigation with vector tiles:
the renderer over-zooms past it without new data, so building z15 and
beyond multiplies the download for no visible gain on a phone. Every
region uses the same range — a rider in Musanze needs the same street
detail a rider in Kigali does.

The Kigali box is wide enough that a motari riding to the edges of the
city keeps a map, and tight enough that the archive stays a reasonable
download over Kigali mobile data.

### Size (Kigali)

The tile geometry is exact and can be checked without building anything:

| z | cols | rows | tiles |
| --- | --- | --- | --- |
| 0–8 | 1 | 1 | 1 each |
| 9–10 | 2 | 1 | 2 each |
| 11 | 3 | 2 | 6 |
| 12 | 5 | 4 | 20 |
| 13 | 8 | 7 | 56 |
| 14 | 14 | 13 | 182 |
| | | **total** | **277** |

277 tiles. At 40–120 KB per tile — the usual range for a Planetiler
basemap over dense urban OSM data — that is an **estimated 11–33 MB**.

> **This is an estimate, not a measurement.** The measured size and build
> time come from the first real run and are written into the manifest and
> printed by the script. They could not be measured in the environment this
> was written in, whose egress policy denies `download.geofabrik.de` and
> the Planetiler release host, so no real OSM data could be fetched.

**No estimate is shown to a user any more.** Every size on the offline-map
screen is the real byte count of the real file, read by `stat()` and
served by `GET /api/map/regions`. The old `KIGALI_MAP_ESTIMATED_MB = 40`
sat next to an archive that turned out to be about 6 MB; a number a human
typed is a number that goes stale, so there is no longer one anywhere in
the app. A region the server has not got shows as "not available yet"
rather than a guess.

The provinces are each a fraction of the country and `rwanda` is all of
it; the founder's build run reports the real figures for all six, and
those are the numbers riders see.

### Will it fit on a phone?

The archive has to fit inside the **WebView's storage quota**, which is a
fraction of free disk rather than the card's capacity — so this is a real
constraint, not a formality. Measured with `packages/e2e/quota-probe.mjs`
on the Chromium engine available here (the same engine family as the
Android WebView):

```
navigator.storage.estimate(): {"quota":897069355,"usage":0}
quota: 856 MB
host free disk: 29.2 GB
quota / free disk: 0.029
extract estimate 11-33 MB fits: true (headroom x26 at the high estimate)
```

**856 MB granted against an estimated 11–33 MB extract — roughly 26×
headroom at the high estimate.** This is not a STOP.

The caveat is stated rather than hidden: this is a desktop-class Chromium
in a container, not a low-end Kigali handset, and the quota there will be
smaller because free disk is smaller. That is exactly why the app does
not rely on this number. `checkStorageFor()` in
`packages/client/src/services/map-cache.ts` asks the *actual device*
before any bytes are fetched, and refuses with honest copy
(`map.offline.noSpace`) rather than spending a rider's data on bytes that
cannot be stored. An engine that does not implement `storage.estimate()`
is treated as permission to try, with the download's own quota failure as
the backstop.

## How the server finds them

`GET /api/map/regions` (authenticated) scans the resolved data directory
and returns one entry per `.pmtiles` file it finds:

```json
{
  "regions": [
    { "key": "kigali", "nameKey": "map.regions.kigali",
      "sizeBytes": 6291456, "lastModified": "…", "etag": "…",
      "manifest": { "source": "geofabrik:rwanda", "maxzoom": 14, … } },
    { "key": "north", "nameKey": "map.regions.north",
      "sizeBytes": 12582912, "lastModified": "…", "etag": "…" }
  ]
}
```

The server holds **no display strings** — only `nameKey`. The names, and
their French and Kinyarwanda, live in the shared region registry the
client reads, so a region is named in exactly one place.

`GET /api/map/<region>.pmtiles` then serves any listed region with the
same contract Kigali always had: auth, honest 404, ETag, `Range` and
`If-Range` resume.

**Kigali is unchanged, not aliased.** `/api/map/kigali.pmtiles` keeps its
own registration and resolves exactly as it always did, so an app already
installed in the field keeps working:

1. **`MAP_PMTILES_PATH`** — an explicit operator override. Always wins. A
   path that is set but missing gives a clean 404 rather than falling
   through, because an operator who names a file means that file.
2. **`data/kigali.pmtiles`** — the known location, needing no
   configuration at all.

The region list takes Kigali from that same resolver, so a Kigali the
server cannot serve is never listed: everything listed can be fetched.
When `MAP_PMTILES_PATH` is set, its **directory** is the one scanned, so
an operator who pointed at their own archive can still drop provinces
beside it — again without the updater ever writing `.env`.

Resolution lives in `packages/server/src/services/map-extract.ts` and is
checked from both documented working directories (`$BIMOTO_HOME` and
`$BIMOTO_HOME/packages/server`). It is deliberately **not** cached: an
archive dropped in while the server runs starts being served, no restart
— which is the whole provisioning story.

### Region keys cannot name a path

A path segment reaches the route **URL-decoded**: a request for
`/api/map/..%2f..%2fetc%2fpasswd.pmtiles` arrives as the region
`../../etc/passwd`. That is verified behaviour, not a hypothetical. Two
gates follow, and a key must pass both:

1. it must match `^[a-z]+(-[a-z]+)*$`, at most 32 characters — no dots,
   no slashes, no percent signs, so nothing that could traverse survives;
2. it must appear in the directory listing, so even a pattern-legal key
   can only ever name an archive this server itself enumerated.

Pinned by `packages/server/src/__tests__/map-regions.test.ts`, which
sends the decoded forms with a readable `secret.txt` sitting beside the
archives.

### Why there has to be a default rung

`scripts/update-pilot.command` promises the operator, in its own header,
that it "keeps your settings (.env) exactly as they are", and its own
guard asserts it byte for byte. So the updater must never write
`MAP_PMTILES_PATH`. When that variable was the only way to point at the
file, the variable was empty everywhere and the feature was dark
everywhere. The file's *location* is the wiring.

## How they reach the pilot Mac

`scripts/update-pilot.command` treats the archives the way it treats
`BUILD_SHA` — as their own files, precisely so the byte-for-byte settings
promise stays true. It loops over **every** `data/*.pmtiles`:

* if the update folder carries an archive of that name, that one is
  installed;
* otherwise the installed one is carried forward and verified with `cmp`,
  so an operator who built a province once does not silently lose it on
  the next update;
* each manifest travels with its archive when present.

This used to name `kigali.pmtiles` literally, which meant adding a
province would have quietly dropped it on the next update.

The archives are gitignored (`/data/*.pmtiles`, `/data/poly/`). They are
built per install, not committed — a repo is not a place for tens of
megabytes of generated binary, still less hundreds.

## Checking it worked

```sh
curl -b "accessToken=<token>" http://localhost:3000/api/map/regions
# {"regions":[{"key":"kigali",…},{"key":"north",…}]}

curl -I -b "accessToken=<token>" http://localhost:3000/api/map/north.pmtiles
# HTTP/1.1 200 OK
# Accept-Ranges: bytes
# Content-Type: application/octet-stream
```

An empty `regions` list means nothing is provisioned — build an archive,
or check it landed in `data/`. A `404` with `MAP_NOT_AVAILABLE` on a
specific region means that one is not there; the rest still work.

The transition is pinned by
`packages/server/src/__tests__/map-extract-404-to-200.test.ts`, which
serves a real PMTiles v3 archive over the real route and reads it back —
header, metadata and a tile — through the same `pmtiles` package the client
ships, by HTTP byte range.
