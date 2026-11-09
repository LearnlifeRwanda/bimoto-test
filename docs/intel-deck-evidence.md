# INTEL-DECK v2 — G1 evidence

Verification and spike record for the dispatch that finishes the mobility
vault: the OD matrix, marginal-level suppression, the ANALYST role and the
`/intel` reading room. Everything below was re-read at `5cc6707` (`main`),
the tip this branch is cut from. Nothing here is remembered; every claim
names the file and line it came from.

## 1. Anchor re-verification

| Anchor (as dispatched) | Verified at HEAD | Verdict |
| --- | --- | --- |
| `grid.ts` 139 lines, hex axial, sha256 cellId | 139 lines; `snapToCell` `:54-71`, `cellId = sha256(tier:cellSize:q:r)` `:67-69` | ✅ |
| `k-anonymity.ts` 47 lines, cell-total gate only | 47 lines; `applyKAnonymity` `:22-28` filters on `row.count >= k` — no marginal inspection anywhere | ✅ |
| `config.ts` 68 lines, four tiers, env-tunable | 68 lines; DENSE 250 m/30 min/k=20, MEDIUM 500/60/15, LOW 1000/120/10, SPARSE 5000/240/10 `:10-39` | ✅ |
| `point-density.ts` 151 lines, 5000/page, three marginals | 151 lines; `PAGE_SIZE` `:23`, marginals accumulated `:119-124`, emitted per tier attribute list `:56-65` | ✅ |
| `od-matrix.ts` 20 lines, stub returning empty | 20 lines; `return { aggregated: [], scannedPoints: 0, durationMs: 0 }` `:19` | ✅ |
| `store.ts` 52 lines, write-only, conflict counting | 52 lines; `bulkInsertAggregates` `:20-42` with `skipDuplicates: true` | ✅ |
| `admin-mobility.routes.ts` 189 lines, `adminOnly` at `:18` | 189 lines; `router.use(adminOnly)` at `:18`; five endpoints as described | ✅ |
| `auth.ts` guards at `:136-152` | `driverOnly :136`, `adminOnly :144`, `customerOnly :152` — ten-line role guards | ✅ |
| `role-home.ts` 13 lines | 13 lines; ADMIN→`/admin`, DRIVER→`/driver`, default `/` | ✅ |
| `UserRole` five members | CUSTOMER, DRIVER, BOTH, ADMIN, COOPERATIVE_LEADER (`schema.prisma:16-22`) | ✅ |
| Wiring: 164 endpoints, 60 allowlisted orphans, 0 warnings | `pnpm wiring:map` → `164 endpoints, 143 calls, 46 routes, 116 nav edges — 60 orphan candidates, 0 unreachable candidates, 5 unresolved`; `pnpm wiring:check` → `OK (60 allowlisted findings, 0 warnings)`; regeneration is byte-identical (clean `git status`) | ✅ |
| Five mobility endpoints in the allowlist | `allowlist.json:59,63,67,163,167` | ✅ |

No anchor failed to reproduce. No §4 STOP on this ground.

## 2. `attributesJson` key shapes (real samples)

`bulkInsertAggregates` (`store.ts:34`) is the **only** writer of the column,
and `aggregatePointDensity` is the only producer of the value it writes.
`attributesFor` (`point-density.ts:56-65`) can emit exactly three keys and no
others:

```jsonc
// DENSE cell (attributes: VEHICLE_TYPE, HOUR_OF_DAY, FARE_DECILE)
{
  "vehicleTypes":     { "MOTO": 18, "BIKE": 6, "E_BIKE": 1 },  // VehicleType → count
  "hourBuckets":      { "7": 14, "8": 11 },                    // UTC hour 0-23 → count
  "fareDecileCounts": { "0": 9, "1": 12, "2": 4 }              // log-decile 0-9 → count
}
// MEDIUM cell: vehicleTypes + hourBuckets only
// LOW cell:    hourBuckets only
// SPARSE cell: attributesJson is undefined → stored as NULL
```

Corroborated by the aggregator's own tests
(`aggregator/__tests__/point-density.test.ts:82-86,113-115`) and the pipeline
integration test (`__tests__/mobility-integration.test.ts:153-179`), which
assert per-tier presence *and* absence of each of the three keys, and that a
SPARSE row's `attributesJson` is `null`.

**No fourth key exists in any sample, test fixture or code path.** The §4
STOP condition ("samples contain anything beyond the three marginal maps")
does not fire. The `E_BIKE: 1` above is not hypothetical — it is exactly the
shape the cell-total gate admits today, and it is what G3 closes.

## 3. ANALYST denylist — enumerated from the live route table

Read from `packages/server/src/index.ts:176-231` (the 40 `app.use('/api…')`
mounts) and the `router.use(...)` / per-route guard of each router file.

**Router-level `adminOnly` (403 for ANALYST, no code change needed) — 13 routers:**

| Mount | Guard site |
| --- | --- |
| `/api/admin` | `admin.routes.ts:27-28` |
| `/api/admin/aml-flags` | `admin-aml.routes.ts:20-21` |
| `/api/admin/bnr-reports` | `admin-bnr.routes.ts:16-17` |
| `/api/admin/conflicts` | `admin-conflicts.routes.ts:19-20` |
| `/api/admin/error-reports` | `admin-error-reports.routes.ts:37-38` |
| `/api/admin/fee-waivers` | `admin-fee-waiver.routes.ts:19-20` |
| `/api/admin/freeze` | `admin-freeze.routes.ts:15-16` |
| `/api/admin/funnel` | `admin-funnel.routes.ts:25-26` |
| `/api/admin/payouts` | `admin-payouts.routes.ts:17-18` |
| `/api/admin/pickup-verifications` | `admin-pickup-verification.routes.ts:21-22` |
| `/api/admin/sms-inbound` | `admin-sms-inbound.routes.ts:13-14` |
| `/api/admin/mobility` (mutations only, after G4) | `admin-mobility.routes.ts` |
| `/api/admin/push` | per-route `adminOnly` (`admin-push.routes.ts:39`) |

**Role-guarded operational families (403 for ANALYST by construction):**

| Family | Guard |
| --- | --- |
| `POST /api/journeys`, confirm, dispute, interrupt, cancel-scheduled, customer-complete | `customerOnly` |
| `POST /api/journeys/:id/start|end`, `/api/driver/*`, `/api/payout/*`, `/api/bids/my-history`, `/api/drivers/me/*` | `driverOnly` |
| `POST /api/journeys/:id/bids`, `DELETE …/bids/:bidId` | `driverOnly` |
| `POST /api/journeys/:id/accept-bid` | `customerOnly` |
| `/api/payments/*` (charge paths) | `customerOnly` |
| `/api/cooperative/*` | `requireCooperativeLeader` (`auth.ts`) — explicitly 403s every role that is neither ADMIN nor COOPERATIVE_LEADER |
| `PUT /api/users/me/location`, `/online-status`, driver-verification uploads | `driverOnly` |

**Self-scoped reads (`authMiddleware` only) — honest exception, stated rather than papered over:**
`GET /api/journeys` (`journey.routes.ts:274`), `GET /api/journeys/:id` (`:609`),
`GET /api/users/me`, `/api/diagnostics`, `/api/sync`. These do not 403; they
filter by `req.user.userId`. An ANALYST account is the customer of no journey
and the driver of none, so they return **the analyst's own empty set** — no
other person's row is reachable through them. The negative matrix therefore
asserts *403* on the guarded families and *empty payload* on these, which is
the truthful contract. Making them 403 would mean editing operational route
files, which §4 names as a cascade to stop on.

**Documents:** `/api/documents/:key` (`document.routes.ts:49`) is a signed-key
reader with no session role at all; it is unreachable without a key issued by
an operational flow an ANALYST cannot enter.

## 4. Hex-render spike

`grid.ts` uses **pointy-top** axial hexes: `axialToPoint` (`:48-52`) is the
standard pointy-top axial→pixel pair `x = size·(√3·q + √3/2·r)`,
`y = size·(3/2·r)`, with `size` as the circumradius (`snapToCell` passes
`cellSizeMeters` straight in, `:63`). Corner *i* of a pointy-top hex is at
`60·i − 30` degrees, radius `size`.

The vertex function must invert grid.ts's projection, not approximate it.
The forward map is `x = lng · 111320·cos(lat)`, `y = lat · 111320` — the
longitude scale depends on the point's *own* latitude, so a hex is very
slightly warped in lat/lng space. Two candidate inversions were measured by
sampling 40 000 random points across Kigali, snapping each with grid.ts's own
`snapToCell`, and asking whether the point falls inside the polygon drawn for
the cell it was assigned:

| Vertex projection | Points outside their own hex |
| --- | --- |
| Naive — all six vertices divided by `cos(centerLat)` | **269 / 40 000** (0.67 %, up to ~4 m off at edges) |
| Exact — each vertex's longitude divided by `cos(latOfThatVertex)` | **0 / 40 000** |

The exact inversion ships (`packages/client/src/lib/hex-geometry.ts`). Its
cost is that the six radii are 248–252 m rather than a flat 250 m — which is
correct, because the cell genuinely is that shape in lat/lng space.

**Rendering path:** `MapContainer` + `BaseTileLayer` + react-leaflet
`Polygon` (exported by react-leaflet 4.2.1 — `lib/index.js`), composed the
same way `RoutePreviewMap.tsx:27-40` composes a sized, non-fullscreen map.
`Polygon` is plain Leaflet SVG vector rendering; ~200 polygons is well inside
what one SVG pane carries. **No tile-internal change is required** —
`BaseTileLayer`, `tile-source.ts`, `OfflineMapLayer` and their five consumers
are untouched by this dispatch. The §4 hexagon STOP does not fire.

Browser-level fluidity is CI's judgement (Chromium shim, `e2e.yml`), not a
claim made from this container, which has no browser.

---

# INTEL-DECK v2 — G6 completion report

## Per-group commits

| Group | SHA | What landed |
| --- | --- | --- |
| G1 — verify and spike | `77b4781` | Evidence only. Anchors re-verified, marginal shapes pinned, denylist enumerated, hex inverse measured. |
| G2 — the OD matrix | `7edfa7f` | `aggregateOdMatrix` implemented; pair-keyed rows; stricter-k gate; 19 tests. |
| G3 — harden the grain | `1e73433` | `attribute-suppression.ts`; write side in both aggregators, read side on the aggregates GET; 20 tests. |
| G4 — the ANALYST role | `5c9ff5a` | Enum migration, `intelRead`, router split by verb, client fence, seed, negative matrix; 48 tests. |
| G5 — the reading room | `e298db5` | `/intel`, hex geometry, density + flows + ops panel, streaming export, import-graph proof, i18n; 49 tests. |

42 files changed against `origin/main` (`5cc6707`): +4577 / −120.

## The §2 statements

### OD row shape (G2.3) — pick-and-say-why

The dispatch's sketch was `cellId` = origin cell with the destination in
`attributesJson`. **That shape cannot work against the model as it stands**, and
the reason is the unique index:

```prisma
@@unique([tier, aggregateType, cellId, bucketStart])   // schema.prisma:1425
```

With `cellId` = origin, every destination leaving one cell in one bucket
collides on the same key, and `bulkInsertAggregates` (`skipDuplicates: true`,
`store.ts:36-39`) keeps the first and drops the rest silently. Nyabugogo at
08:00 would ship one flow and lose the other forty.

**Shipped shape — the pair is the identity:**

| Column | Value |
| --- | --- |
| `cellId` | `sha256("OD:" + originCellId + ":" + destCellId)` |
| `tier` | the **origin's** tier |
| `cellCenterLat/Lng` | the **origin's** centre, so an OD row still plots |
| `bucketStart/End` | the **origin tier's** bucket length |
| `count` | journeys on that pair in that bucket |
| `attributesJson` | `originCellId`, `destCellId`, `originCenterLat/Lng`, `destCenterLat/Lng`, `destTier`, plus `vehicleTypes` / `hourBuckets` per the origin tier's attribute list |

No migration. Still one opaque hash in a `String` column, so grid.ts's
"coordinates are not recoverable from the id" discipline holds for the pair as
it does for the cell. The collision case is pinned by an integration test
through the real cron (`two destinations from one origin survive the unique
index as two rows`).

**K-gate:** a pair passes only at `max(k(originTier), k(destTier))`. A SPARSE
origin (k=10) into a DENSE destination (k=20) needs 20, tested at 15 (refused)
and 20 (admitted). `k-anonymity.ts` is byte-unchanged: this reuses its exported
`thresholdForTier` and then runs `applyKAnonymity` as a second net.

### Suppression parameters (G3)

| Parameter | Value | Where |
| --- | --- | --- |
| `MOBILITY_ATTR_MIN` | 5 (env-tunable; non-numeric or <1 falls back to 5) | `attribute-suppression.ts` |
| Fold target | a single `other` key | — |
| Complementary guard | a lone fold takes the next-smallest survivor with it | — |
| Drop rule | an `other` below the minimum is removed entirely | — |
| Scope | `vehicleTypes`, `hourBuckets`, `fareDecileCounts`; all other keys pass through | — |

### Before / after (fixtures, not production data)

A DENSE cell of 24 movements — clears k=20, and names a rider by their vehicle:

```jsonc
// BEFORE (what the cell gate alone admits today)
{ "vehicleTypes":     { "MOTO": 18, "BIKE": 5, "E_BIKE": 1 },
  "hourBuckets":      { "3": 1, "7": 11, "8": 12 },
  "fareDecileCounts": { "0": 9, "1": 12, "9": 3 } }

// AFTER (write side and read side alike)
{ "vehicleTypes":     { "MOTO": 18, "other": 6 },
  "hourBuckets":      { "8": 12, "other": 12 },
  "fareDecileCounts": { "1": 12, "other": 12 } }
```

Note the complementary guard doing its job three times: `E_BIKE: 1` alone would
have become `other: 1`, which names the count exactly, so `BIKE: 5` goes with
it. Same for the 03:00 hour and the top fare decile. And an OD pair of 20 that
was `{ MOTO: 19, E_BIKE: 1 }` becomes `{ other: 20 }` — with only two
categories there is no partial answer that is not a full one.

## The denylist matrix, as shipped

`__tests__/analyst-access-matrix.test.ts`, 33 assertions:

- **25 denied families**, each asserted 403 against the real guard: twelve
  `/api/admin/*` mounts (`adminOnly`), plus journey creation, bid acceptance,
  ride start/end, bidding, bid history, driver documents, payouts, payments,
  auto-bid rules, driver stats, driver screener, driver location and driver
  scheduled rides (`customerOnly` / `driverOnly`).
- **A count check** so a new `/api/admin/*` router cannot quietly shrink the
  matrix.
- **5 `intelRead` assertions**: ANALYST admitted, ADMIN admitted, CUSTOMER and
  DRIVER refused, anonymous 401.
- **Existing roles unchanged**: `adminOnly` still admits only ADMIN;
  `driverOnly` / `customerOnly` untouched by ANALYST existing.
- **The honest exception, tested rather than footnoted**: `GET /api/journeys`
  and its four siblings carry `authMiddleware` only and filter by
  `req.user.userId`. An analyst gets `{ journeys: [] }`; the same endpoint still
  returns a customer their own row. Making these 403 would mean editing
  operational route files — the cascade §4 says to stop at.

Plus, on the real mobility router: an ANALYST reads aggregates / stats /
tier-config (200) and is refused run-now and tier-config/reload (403, with
`runMobilityAggregationOnce` asserted not called).

## Hex-render spike outcome

Shipped as `packages/client/src/lib/hex-geometry.ts`. grid.ts is **pointy-top**;
corner *i* is at `60·i − 30°` at the circumradius. The projection inverse is
**per vertex, at that vertex's own latitude** — inverting all six at the centre's
latitude leaves 269 of 40 000 sampled Kigali points outside the hexagon
`snapToCell` actually assigned them (~4 m of error, because at lng ≈ 30° the
projected x is ~3.3 million metres and a 1.3e-6 relative shift in cos(lat) is
metres, not micrometres). The per-vertex inverse leaves **0 of 40 000**, at the
cost of corner radii of 248–252 m rather than a flat 250 — which is correct,
since the cell genuinely is that shape in lat/lng space.

A permanent test ports `snapToCell` verbatim and re-runs that check for all four
tiers (5000 points each, deterministic PRNG), plus a no-overlap check on
neighbouring cells. Rendering is `MapContainer` + the shared `BaseTileLayer` +
`Polygon`, the same composition `RoutePreviewMap` uses. **No tile-internal
change was needed**; `components/map/*` is untouched. Browser-level fluidity at
~200 polygons is CI's judgement (Chromium shim) — this container has no browser
and the report does not claim otherwise.

## Export samples (counts only, no data)

- **CSV**: one header line (`tier,aggregateType,cellId,cellCenterLat,cellCenterLng,bucketStart,bucketEnd,count,attributes`) + one line per row. An empty view is the header and nothing else — asserted. RFC 4180 quoting asserted on comma / quote / newline / `Date`, and a line is asserted to carry exactly as many top-level columns as the header.
- **JSONL**: one object per line, 501 lines across a 2-page fetch in the paging test (`PAGE_SIZE` 500, cursor `row-499`, `skip: 1`).
- A legacy `{ MOTO: 23, E_BIKE: 1 }` row exports as `{"vehicleTypes":{"other":24}}`; the string `E_BIKE` is asserted absent from both formats.

## Invariant checks

| Invariant | Check | Result |
| --- | --- | --- |
| `k-anonymity.ts` byte-unchanged, its tests unmodified | `git diff origin/main -- k-anonymity.ts k-anonymity.test.ts` | empty ✅ |
| No serving path returns an unsanitized marginal | route test (GET) + export tests (CSV, JSONL) + import-graph test asserting both files import the same module | ✅ |
| OD pairs suppressed at the stricter endpoint's k | cross-tier fixtures, both directions | ✅ |
| ANALYST reads nothing identified | 33-assertion matrix + import-graph closure walk | ✅ |
| ADMIN behaviour unchanged; mutations admin-only | route tests both ways | ✅ |
| GpsPoint retention job untouched | `git diff origin/main -- jobs/gps-retention.job.ts` | empty ✅ |
| Map tile internals untouched | `git diff origin/main -- components/map/` | empty ✅ |
| Schema/endpoint changes additive | enum `ADD VALUE`; one new endpoint; no column added, altered or dropped | ✅ |
| Deployed APKs unaffected | no change to any existing endpoint's path, method or response shape | ✅ |
| Wiring 60 → 55, 0 unreachable, 0 warnings | `pnpm wiring:check` | ✅ |
| i18n parity + used-keys + freshness | vitest gates + `pnpm i18n:review:check` | ✅ |

## CI-equivalent tallies

| Job | Command | Result |
| --- | --- | --- |
| server tests | `pnpm test:server` | **2466 passed**, 275 suites (baseline 2368 → **+98**) |
| client tests | `pnpm test:client` | **1351 passed**, 187 files (baseline 1313 → **+38**) |
| wiring audit | `pnpm wiring:test` / `wiring:check` | 20 passed; `OK (55 allowlisted findings, 0 warnings)` |
| i18n review | `pnpm i18n:review:test` / `:check` | 27 passed; docs match locales (1299 / 1299 / 1299) |
| landmarks | `landmarks:test` / `:verify` / evidence-rebuild diff | 17 passed; 163 of 163 inside Kigali; artifacts byte-identical |
| pilot updater | `sh scripts/tests/test-update-pilot.sh`, `pnpm map:test` | 62 passed; 37 passed. **`shellcheck` is not installed in this container**, so the two lint steps of that job could not run here — they are unchanged files and CI judges them. |
| android / ios build | — | not run locally; `pnpm --filter @bimoto/client build` and `--filter @bimoto/server build` both succeed |
| e2e | — | needs Postgres; not available here (§5). `prisma validate` passes; the migration follows the same `ALTER TYPE … ADD VALUE AFTER` pattern as ten prior migrations in this repo. |

Wiring map: **165 endpoints**, 149 calls, 47 routes, 119 nav edges — **55 orphan
candidates, 0 unreachable candidates, 5 unresolved** (unresolved unchanged from
the §0 baseline).

## Findings the founders should see

**1. A silent-dormancy hole in the tool that guards against silent dormancy.**
`scripts/wiring-audit/extract.ts`'s tokenizer loses its place on a regex literal
containing a double quote when that regex sits inside a template literal's
`${…}` expression, and blanks the remainder of the file. Every endpoint below
that point disappears from the map — with no UNRESOLVED entry and no warning.
This was found the hard way: the first version of `intel.routes.ts` used the
idiomatic `` /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s `` and the
entire router vanished from a green audit. Minimal reproduction:

```ts
tokenize('const q = `"${s.replace(/"/g, \'""\')}"`;\nrouter.get(\'/x\', h);')
// → the router.get(...) region comes back fully blanked
```

`csvCell` avoids the shape and carries the reason in a comment. **The tokenizer
itself is not fixed here** — it is a CI gate outside this dispatch's scope, and
changing it could move the baseline. It is worth its own small dispatch.

**2. A §0 anchor nuance, not a failure.**
`MOBILITY_RUN_NOW_MAX_RANGE_DAYS` (90) is enforced by `parseRange` on the
**read** ranges (`/aggregates`, `/aggregates/stats`, and now the export), not on
`POST /aggregates/run-now`, which takes no range at all and always runs the
configured lookback. The ops panel therefore offers a button and a sentence
saying so, rather than a date picker whose value the server would ignore. If a
ranged manual run is wanted, that is a real change to the endpoint and belongs
in its own dispatch.

**3. Analyst-account governance remains a leadership question.** The role, the
seed fixture and the guards exist. Who gets an ANALYST account, under what
agreement, and with what review of the tier bounding boxes before any external
sale (`tier-classification.json`'s own comment asks for this) is not decided by
code and is not decided here.

## STOPs

**None.** All four §4 conditions were checked and none fired:

- `attributesJson` samples contain exactly the three documented marginal maps —
  no unknown keys (§2 above).
- The OD shape rides `MobilityAggregate` with **no migration** (the pair-keyed
  `cellId` is the reason it can).
- Hexagon rendering needed **no** tile-internal change.
- Role plumbing stayed inside guards, `role-home.ts`, the seed and the route
  gates. `req.user.role` is typed `string` (`utils/jwt.ts:6`) with no union to
  widen, so nothing cascaded.
- Every §0 anchor reproduced (§1 above).
