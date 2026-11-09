# Why the map is frequently not visible — measurement, MAP-TRUTH G1

Measured against `main` at `b64f918`. This note records what was measured,
what was eliminated, and what was *not* measurable here. It is the evidence
base for the G2 decision; nothing in it is inferred from how the code reads
alone unless the note says so explicitly.

## 0. What could and could not be measured in this environment

The dispatch asks for an APK on an Android device or emulator. **That was not
possible here.** The execution container has a JDK and Gradle but no Android
SDK, no `adb`, no emulator image, and no attached device:

```
$ which java javac adb gradle emulator sdkmanager
/usr/bin/java
/usr/bin/javac
/opt/gradle/bin/gradle          # adb, emulator, sdkmanager: not found
$ echo "$ANDROID_HOME $ANDROID_SDK_ROOT"
                                 # both unset
```

Second, the container's egress proxy **denies openstreetmap.org by policy**,
so this environment cannot observe how the OSM tile server treats our client:

```
$ curl -sS "$HTTPS_PROXY/__agentproxy/status"
  "recentRelayFailures": [
    { "kind": "connect_rejected",
      "detail": "gateway answered 403 to CONNECT (policy denial or upstream failure)",
      "host": "a.tile.openstreetmap.org:443" }, ...
```

**Therefore this note makes no claim about whether OSM is refusing, throttling
or dropping our requests.** That question is open and is flagged in the report
as unmeasured. What the environment *does* permit is a faithful measurement of
the app's behaviour *when tiles cannot load* — which is the behaviour Barack
actually sees — plus full measurement of the packaged CSP and the container
geometry. Those are below, and they turn out to be sufficient: the dominant
cause is ours, and it fires on a **working** connection with **reachable**
tiles.

## 1. Browser measurement: the tile requests actually issued

Harness: `packages/e2e/tile-probe.mjs`, real Chromium (not jsdom) at a 390×844
mobile viewport with an Android WebView user-agent, driving the exact
`TileLayer` URL the app ships, centred on Kigali at z14.

```
$ node tile-probe.mjs 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
URL UNDER TEST: https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png
CONTAINER GEOMETRY: {"width":390,"height":640,"tilesInDom":6}
TILE <img> ELEMENTS IN DOM: 6
--- NETWORK ---
{"url":"https://b.tile.openstreetmap.org/14/9559/8280.png","t":302,"phase":"request"}
{"url":"https://c.tile.openstreetmap.org/14/9560/8280.png","t":302,"phase":"request"}
{"url":"https://a.tile.openstreetmap.org/14/9559/8279.png","t":302,"phase":"request"}
{"url":"https://b.tile.openstreetmap.org/14/9560/8279.png","t":302,"phase":"request"}
{"url":"https://c.tile.openstreetmap.org/14/9559/8281.png","t":303,"phase":"request"}
{"url":"https://a.tile.openstreetmap.org/14/9560/8281.png","t":303,"phase":"request"}
{"url":"...","failure":"net::ERR_TUNNEL_CONNECTION_FAILED","t":575,"phase":"failed"}
   ... (6 failures, t = 575–646 ms)
TOTAL tile network events: 12
STATUS TALLY: {"FAILED net::ERR_TUNNEL_CONNECTION_FAILED":6}
LEAFLET tileload: 0  tileerror: 6
```

Timing on a cold start: first tile request at **t+302 ms**, all six resolved by
**t+646 ms**. The failures are the sandbox proxy (`ERR_TUNNEL_CONNECTION_FAILED`),
**not** OSM — see §0.

Two facts fall out of this that matter regardless of who is refusing:

* **A single screenful at z14 is exactly 6 tiles.** `MapCanvas.tsx:36` sets
  `TILE_ERROR_THRESHOLD = 6`. So *one* screenful of failures — one bad moment,
  one tunnel blip, one dead cell handover — trips `tilesFailed` exactly.
* **`tileload` never fires, so `errorCount` never resets.** The reset at
  `MapCanvas.tsx:140-142` only runs on a successful load, which by definition
  cannot happen during the outage that is accumulating errors.

## 2. Non-network candidates, eliminated by name

### 2a. Zero-height Leaflet container — **ELIMINATED (measured)**

The probe reports `{"width":390,"height":640,"tilesInDom":6}`. Leaflet resolved
a correct box and minted six tile elements into it. A zero-height container
produces `tilesInDom: 0` and no requests at all; we observe the opposite.

By reading, every map container in the app carries an explicit non-zero height,
so this is eliminated by construction as well as by measurement:

| Surface | Container class |
| --- | --- |
| `MapCanvas.tsx:110` | `fixed inset-x-0 top-0 bottom-16` |
| `MiniMap.tsx:84` | `h-[200px]` |
| `RoutePreviewMap.tsx:206` | `h-[240px]` |
| `DriverApproachMap.tsx:140` | `h-[60vh] md:h-[40vh]` |

Note the consequence for the complaint's wording: when tiles fail, Leaflet keeps
the full-size container and leaves empty tiles in it — **a blank rectangle of
the correct size**, which is precisely what was reported.

### 2b. CSP in the packaged APK differing from dev — **ELIMINATED as a blocker (measured)**

The CSP is emitted by `webviewCsp()` (`vite.config.ts:47`), which is declared
`apply: 'build'`. So dev has **no CSP meta tag at all** and the packaged build
has one — the two genuinely differ, and that was worth checking. But the
packaged policy *permits* OSM. Built with a production API origin:

```
$ VITE_API_URL=https://api.bimoto.rw pnpm build && grep -o 'content="[^"]*"' dist/index.html | head -1
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: https://*.tile.openstreetmap.org;
connect-src 'self' https://api.bimoto.rw wss://api.bimoto.rw;
object-src 'none'; base-uri 'self'; form-action 'self'
```

`img-src` includes `https://*.tile.openstreetmap.org`. CSP does not block the
base map in either build.

One forward-looking consequence, recorded here because it constrains G2:
`img-src` does **not** include the API origin. Serving our own *raster* tiles
from `api.bimoto.rw` would be CSP-blocked today. Serving our own *vector*
extract is unaffected — the archive arrives over `connect-src` (which does
include the API origin) and is rendered to canvas from a local Blob.

### 2c. Ordering at first paint — **NOT eliminated; a real contributor**

This one survives. `useOfflineMap()` starts at store status `'unknown'` and
returns `null` until Dexie has been consulted (`useOfflineMap.ts:27-31`,
`:52`). `MapCanvas:99` computes

```ts
const unavailable = !offlineMap && (!isOnline || tilesFailed);
```

so on the very first paint `offlineMap` is `null` **even when the extract is
cached**. If `isOnline` is false at that instant — and §3 shows it very often
is, during exactly the boot round-trip — the user gets the gray placeholder,
and `onUnavailable` fires. It fires **permanently**: `notified` is a ref set to
`true` and never back to `false` (`:100-107`), so the host page expands its
sheet and stays expanded even after the map recovers a moment later.

## 3. The dominant cause: the map is hidden by our own API's health

This is the finding that explains "frequently not visible" on a working
connection, and it needs no network fault at all.

`MapCanvas:94` gates the entire map on `useUIStore.isOnline`. That flag is
written in exactly one place — `App.tsx:216`:

```ts
setOnline(connection === 'online');
```

`connection` is the three-state from `sync/connectivity.ts`, whose third state
is `'unreachable'` — *"network is up but the API does not answer"*. So
`'unreachable'` collapses to `isOnline === false`, and a flag that means **our
API did not answer** is used to decide whether **OpenStreetMap's tiles** can be
drawn. Those are unrelated services. Nothing about our API being slow implies a
tile cannot load.

And `'unreachable'` is trivially easy to reach on a healthy connection, because
`apiFetch` reports failure for *any* rejected `fetch`, including a deliberate
abort (`lib/api.ts:193-199`):

```ts
try {
  res = await fetch(url, init);
} catch {
  reportApiFailure();          // <- no AbortError guard
  throw new ApiError(...);
}
```

`reportApiFailure()` sets `'unreachable'` whenever the device network is up
(`connectivity.ts:130-133`). Two shipped code paths abort `apiFetch` calls as
normal, correct behaviour:

* **`useGeocodeSearch.ts:70-77`** — the destination search box aborts the
  in-flight request on **every keystroke** after the debounce. Each abort is a
  spurious `reportApiFailure()`.
* **`services/map-cache.ts:120,141`** — cancelling the offline-map download
  aborts its `apiFetch`, with the same effect.

So: **typing a destination turns the map off.** The user taps the search field,
types "Kimi…", the second keystroke aborts the first request, connectivity flips
to `'unreachable'`, `isOnline` goes false, and `MapCanvas` swaps the live map
for a gray rectangle. The recovery is a backoff probe on the
`SYNC_RETRY_BACKOFF_MS` ladder (1s → 3s → 10s → 30s), so the map can stay gray
for up to 30 seconds after a single keystroke.

### The same flag produces the word "offline"

`AppShell.tsx:41-42` stacks two connectivity surfaces:

* `SyncIndicator` (`:16-21`) reads the same `useUIStore.isOnline` and renders
  `sync.offline` — **"Offline - changes will sync when connected"** — in orange
  whenever the flag is false.
* `ConnectionBanner` reads the three-state directly and renders
  `connection.unreachable` — "Can't reach Bimoto — retrying…" — in blue.

On a working connection with an aborted request, **both render at once**, and
they contradict each other on the same screen: one says the phone is offline,
the other says the phone is fine but Bimoto is not. That is Barack's second
report, and it has the same single root as the first.

## 4. The latch defects

Two pieces of state in `MapCanvas` are one-way:

* **`tilesFailed`** (`:96`, set at `:138`) is never set back to `false`. Any
  six-error burst grays the map permanently for that component's lifetime, even
  after tiles start loading again. `errorCount` resets on `tileload`;
  `tilesFailed` does not.
* **`notified`** (`:100`) is never reset, so `onUnavailable` cannot be
  followed by a "map is back" signal.

## 5. Coverage: four of five surfaces cannot fall back at all

The dispatch asked for this grep to be re-run and warned that a fifth file would
change the plan. **There is a fifth file.** The reviewer's inventory of four
missed `DriverApproachMap.tsx` — the map a customer watches while their motari
is riding toward them.

```
$ grep -rn "tile.openstreetmap.org" --include=*.tsx packages/client/src
components/journey/RoutePreviewMap.tsx:214
components/journey/DriverApproachMap.tsx:152     <-- not in the dispatch's list
components/journey/MiniMap.tsx:95
components/map/MapCanvas.tsx:133
```

| Surface | OSM raster | Offline fallback |
| --- | --- | --- |
| `MapCanvas.tsx` | yes | **yes** (`OfflineMapLayer`) |
| `LocationPickerMap.tsx` | via `MapCanvas` | **yes** (inherited) |
| `MiniMap.tsx` | yes | no |
| `RoutePreviewMap.tsx` | yes | no |
| `DriverApproachMap.tsx` | yes | no |

Three surfaces — including the in-ride approach map — go blank with no fallback
in exactly the conditions this dispatch exists to fix.

## 6. Summary of causes, ranked

1. **`isOnline` conflates "our API is unreachable" with "no map is possible"**,
   and any aborted `apiFetch` (a keystroke in the search box) sets it. Causes
   both the gray map and the false "Offline" text. *Ours. Fires on a perfect
   connection.*
2. **`tilesFailed` and `notified` latch on** and never recover.
3. **First-paint ordering** hides a cached extract behind an async Dexie read.
4. **Three of five map surfaces have no offline path**, so any fix confined to
   `MapCanvas` leaves the in-ride map blank.
5. **Whether OSM itself refuses us — unmeasured here** (§0), and deliberately
   not asserted. It is also no longer load-bearing: causes 1–4 are sufficient to
   explain the report, and the G2 remedy (own the tiles) removes the dependency
   whether or not OSM is refusing.

---

## Addendum — 24 August 2026, MAP-REACH (measured at `39972bb`)

Nothing above is rewritten. This section records which of the findings
are closed at `39972bb`, by what, and what this dispatch added — because
the body of this note was measured at `b64f918` and four things have
landed since.

### The five-surface table (§5) is stale. The real inventory at `39972bb`

`MiniMap.tsx` **no longer exists**, and three surfaces the note never saw
do. Re-run at `39972bb`, every map surface in the app:

| Surface | Base layer | Offline path | Offer (MAP-REACH) |
| --- | --- | --- | --- |
| `components/map/MapCanvas.tsx` | `BaseTileLayer` | yes | chip mounted |
| `components/map/LocationPickerMap.tsx` | via `MapCanvas` | yes (inherited) | inherited |
| `components/map/DriverNavMap.tsx` | `BaseTileLayer` | yes | chip mounted |
| `components/journey/RoutePreviewMap.tsx` | `BaseTileLayer` | yes | chip mounted |
| `components/journey/DriverApproachMap.tsx` | `BaseTileLayer` | yes | chip mounted |
| `components/admin/EmergencyFollowMap.tsx` | `BaseTileLayer` | yes | **no** — staff |
| `components/intel/DensityMap.tsx` | `BaseTileLayer` | yes | **no** — staff |

The last two are admin/analyst surfaces reached only from `/admin` and
`/intel`. They get the offline extract like everything else, because
`BaseTileLayer` gives it to them; they are deliberately not given the
offer, which is addressed to a rider or motari on their own phone.

`grep -rn "tile.openstreetmap.org"` now returns `tile-source.ts` only:
the raster URL is named in exactly one file.

### Findings closed BEFORE this dispatch (by MAP-TRUTH G2 / MAP-RWANDA G4)

* **§2c / §6.3 — first-paint ordering.** Closed. `useMapCacheResolved()`
  (`useOfflineMap.ts:53-59`) distinguishes "nothing cached" from "haven't
  looked yet", and `MapCanvas:141` refuses to decide until it is true.
* **§4 / §6.2 — `tilesFailed` and `notified` latch on.** Closed.
  `BaseTileLayer:51-58,:80-83` reports recovery as well as failure, and
  `MapCanvas:145-153` rearms `notified` and fires `onAvailable`.
* **§5 / §6.4 — three of five surfaces have no offline path.** Closed by
  `BaseTileLayer`, which every surface in the table above now renders.
* **§3 / §6.1 — `isOnline` conflated API health with tile availability.**
  Closed. `MapCanvas:132` asks `useNetworkStatus` (the device) and the
  tiles themselves; it never consults API health.

### What MAP-REACH closed — the finding this note did not name

The measurement explained why the map went blank. It did not ask what a
rider could DO about it, and the answer was: nothing they could find.
`OfflineMapCard` was mounted in exactly one place (`ProfilePage.tsx:298`)
and no map surface, no Settings screen and no first-run flow pointed at
it. A recovered latch still leaves a rider on mobile data with a map that
needs a connection it has not got.

Closed by:

* `MapDownloadChip` on all five rider-facing surfaces — the offer appears
  where the map is, when there is no extract, the device is online and it
  has not been dismissed. On a tile failure the placeholder and the offer
  appear together: the fix IS the offer.
* A completed download swaps the map to the local extract and clears the
  raster failure with no navigation (`BaseTileLayer:62-67`), proven end to
  end in `map-reach-surfaces.test.tsx`.
* A second door: Settings → "Maps & offline" → `/settings/maps`, mounting
  the same `OfflineMapCard` that Profile mounts.

### Still unmeasured, still not asserted

§0's limitation stands unchanged: this environment has no Android SDK and
its proxy denies `openstreetmap.org`, so **whether OSM itself refuses our
client remains unmeasured**. It is also still not load-bearing — and one
step less so, because a rider who takes the offer stops depending on OSM
for that province entirely.
