# Bimoto

Africa's first fixed-price bidding marketplace for bicycle taxi, moto-taxi, and e-moto transport.

## Quick Start

### Prerequisites
- Node.js 22.9+ (`packages/server`'s `engines` floor; CI runs Node 24)
- pnpm 8+
- Docker (for PostgreSQL)

### Setup
```bash
git clone https://github.com/Joschll/bimoto.git
cd bimoto
cp .env.example .env  # Edit with your values
pnpm install
docker-compose up -d  # Start PostgreSQL
pnpm --filter @bimoto/server db:migrate:deploy
pnpm --filter @bimoto/server db:seed
```

### Run
```bash
pnpm dev:server   # API on http://localhost:3000
pnpm dev:client   # PWA on http://localhost:5173
```

The server loads `.env` by itself (repo root, then `packages/server/.env`
if present, via Node's `--env-file-if-exists`) — no manual exporting.
Variables already set in the environment always win, and the files are
optional: production/CI can keep setting real env vars directly.

### Test
```bash
pnpm test         # Run all unit + integration tests
pnpm test:e2e     # Run Playwright end-to-end tests (server + client must be running)
```

On a fresh clone, build `@bimoto/shared` once before running the
server suite — see [docs/test-environment.md](docs/test-environment.md).

### CI
Each PR triggers four required checks: **Server Tests**
(`.github/workflows/server-tests.yml` — jest, the full `pnpm test:server`
suite), **Client Tests** (`.github/workflows/client-tests.yml` — vitest,
the full `pnpm test:client` suite), **E2E / cross-locale-chat**
(`.github/workflows/e2e.yml` — Playwright), and **Android Build**
(`.github/workflows/android-build.yml` — APK artifact). All four must
pass before merge.

The e2e suite lives in `packages/e2e`. Local runs assume both
`pnpm dev:server` and `pnpm dev:client` are already running (the suite
waits on `/api/health` and the client root before starting). The first
run also needs the Playwright browsers, installed via
`pnpm --filter @bimoto/e2e exec playwright install --with-deps chromium`.

## Architecture
- `packages/shared` — TypeScript types, Zod schemas, state machines, constants
- `packages/server` — Express.js API, Prisma ORM, Socket.io, background jobs
- `packages/client` — React 18 PWA, Zustand stores, Dexie.js offline DB
- `packages/e2e` — Playwright cross-browser end-to-end tests

## Environment Variables
See `.env.example` for all required variables.

## BNR Reports

Compliance officers can generate the monthly BNR-format AML/CFT report
(six sections: transactions, disputes, AML flags, user growth, driver
metrics, compliance attestations) via the admin endpoints under
`/api/admin/bnr-reports`:

- `GET /api/admin/bnr-reports` — list recent reports
- `POST /api/admin/bnr-reports/generate` — trigger generation for a `YYYY-MM` period
- `GET /api/admin/bnr-reports/:id/download.pdf` — stream the PDF
- `GET /api/admin/bnr-reports/:id/download.csv` — stream the CSV

A monthly cron auto-generates the prior month at `02:00 Africa/Kigali`
on the 1st of each month and runs a 7-year retention sweep.

Configurable via env vars: `BNR_REPORT_DIR`, `BNR_RETENTION_YEARS`,
`BNR_TIMEZONE`, `BNR_CRON_SCHEDULE`, `BNR_GENERATION_TIMEOUT_MS`,
`BNR_PDF_PAGE_SIZE`.

## Two-way SMS

Bimoto accepts inbound SMS replies on a configurable shortcode so customers
and drivers can act on outbound reminders without opening the app — the
offline-recovery channel for Dispatch F's silence-equals-consent flow.

Webhook target: `POST /api/sms/inbound` (Africa's Talking, HMAC-SHA256 over
the raw body in `X-AT-Signature`). Replies are matched by sender MSISDN and
routed by intent.

| Reply | Intent |
|---|---|
| `1` / `YES` / `CONFIRM` | Confirm completed ride |
| `2` / `NO` / `DISPUTE` | Open a dispute |
| `ACCEPT` / `DECLINE` | Driver accepts/declines a pending bid |
| `CANCEL` | Cancel the next scheduled ride |
| `STATUS` | Active or upcoming ride summary |
| `BALANCE` | Driver pending payout |
| `HELP` / `?` | Reply-options menu |
| `STOP` / `UNSUBSCRIBE` | Opt out of non-essential SMS |

Drivers replying `YES`/`NO` within `BID_REPLY_WINDOW_MINUTES` of an open
PENDING bid are routed to ACCEPT_BID/DECLINE_BID instead of journey
confirmation. `STOP` sets `User.smsOptOut = true` and silently swallows
future non-essential inbound (HELP/STOP still pass through).

Env vars: `AT_INBOUND_HMAC_SECRET` (required in prod),
`AT_INBOUND_SHORTCODE`, `REPLY_TIMEOUT_MS`,
`DISPUTE_REPLY_WINDOW_HOURS`, `SCHEDULED_REPLY_WINDOW_HOURS`,
`BID_REPLY_WINDOW_MINUTES`, `INBOUND_DEDUP_TTL_DAYS`.

Admin queue (auth + admin RBAC): `/api/admin/sms-inbound` — list, detail,
replay, dismiss, stats. Note: `bid.service.ts` does not currently send a
driver-bid SMS, so the planned ACCEPT/DECLINE hint patch on outbound
bid-acceptance is N/A; if/when that send path lands, append the hint at
the same callsite as the other reminder bodies.

## Admin moderation

A compliance officer can freeze user accounts and adjudicate operational
conflicts via two API surfaces. Both require a session with `role=ADMIN`
and append every action to the `AdminAction` table, which keeps a
SHA-256 hash chain (`prevHash` / `entryHash`) so any tampering can be
detected via `GET /api/admin/conflicts/audit/verify`. Money-moving
decisions also cross-write a row to `EscrowAuditLog`, so the financial
integrity chain still owns the money trail.

### Freeze

`POST /api/admin/freeze/:userId/freeze` with `{ reason, category, notify }`
sets `User.frozenAt`, holds every PENDING `DriverPayoutBatch` for that
driver, disconnects live sockets, and (if `notify`) sends an SMS via
Africa's Talking. Subsequent requests with the user's session are
blocked at `authMiddleware` with `403 ACCOUNT_FROZEN`. The middleware
caches the frozen state for 30 seconds; the freeze service explicitly
invalidates the entry on commit, so the next request always sees the
latest state.

`POST /api/admin/freeze/:userId/unfreeze` clears the frozen fields and,
when `releasePayouts: true`, un-holds every held PENDING batch so the
twice-daily payout cohort picks the driver up again on the next cycle.

### Conflicts (ten types)

`GET /api/admin/conflicts` returns `[{type, count}]` for each of:
`JOURNEY_RECONCILIATION`, `AML_APPEAL`, `BID_MANIPULATION`,
`GPS_PLAUSIBILITY`, `STALE_DRIVER_NO_SHOW`, `PHOTO_MISMATCH`,
`GRAPH_ANOMALY`, `DRIVER_NO_SHOW_DISPUTE`, `RECIPIENT_DISPUTE`,
`RIDE_REPORT`.

`RIDE_REPORT` is a driver's incident report about a finished ride
(TEAM-ANSWERS G3, OPEN DECISIONS item 15). It is deliberately a conflict
rather than a score: ops get the same pattern visibility a passenger
rating would give — repeated reports about one rider are plainly visible
in this dashboard — without creating a number attached to a person's
ability to move through their city. The type registry in
`services/admin/conflict-resolver/index.ts` is compiler-enforced against
the `ConflictType` enum, so a new type cannot be added without a handler.

`GET /api/admin/conflicts/:type` lists the open items; `GET
/api/admin/conflicts/:type/:id` returns full detail (statements, GPS
points, photos, escrow). `POST /api/admin/conflicts/:type/:id/decide`
records a `ConflictDecision` (`RESOLVED_REFUND`, `RESOLVED_PAY`,
`RESOLVED_SPLIT`, `UPHOLD_FLAG`, `OVERTURN_FLAG`, `FORCE_COMPLETE`,
`NO_ACTION`). The valid decisions per type are enforced — for example,
`AML_APPEAL` accepts only `UPHOLD_FLAG`, `OVERTURN_FLAG`, `NO_ACTION`.

`GET /api/admin/conflicts/audit/verify` walks the AdminAction chain and
reports `{ valid, brokenAt }` — the broken-at id surfaces tampering for
incident response.

### Env-overridable thresholds

| Variable | Default | Purpose |
|----------|---------|---------|
| `ADMIN_NOTIFY_SMS_ON_FREEZE` | `true` | Send SMS on freeze |
| `ADMIN_NOTIFY_SMS_ON_UNFREEZE` | `true` | Send SMS on unfreeze |
| `ADMIN_FREEZE_SMS_TEMPLATE` | (Bimoto template) | Body template (`${id}` interpolated) |
| `ADMIN_REASON_MIN_LENGTH` | `10` | Minimum length for `reason` field |
| `STALE_DRIVER_NO_SHOW_THRESHOLD_MIN` | `10` | No-show heuristic window |
| `GPS_PLAUSIBILITY_RADIUS_KM` | `2.0` | Off-destination tolerance |
| `PHOTO_MISMATCH_QUEUE_HOURS` | `48` | How far back goods journeys queue for review |
| `BID_MANIPULATION_WITHDRAW_WINDOW_SEC` | `60` | Accept→withdraw flag window |
| `BID_MANIPULATION_PAIR_WINDOW_DAYS` | `7` | Pair-frequency lookback |
| `FROZEN_USER_AUTH_CACHE_TTL_MS` | `30000` | Auth-middleware cache TTL |
| `FROZEN_USER_AUTH_CACHE_MAX_ENTRIES` | `1000` | LRU cap |

## Graph adversarial defenses (Dispatch I)

Six graph-traversal patterns run on a daily cron (`03:00` by default) and
detect multi-actor adversarial behaviour the per-pair AML detectors miss:

| Pattern | What it detects |
|---------|-----------------|
| `COLLUSION_RING` | Tightly-connected customer/driver bipartite cliques riding mostly with each other |
| `MONEY_FUNNEL` | A driver whose earnings concentrate from very few customers |
| `REPUTATION_RING` | A small clique of customers exclusively rating a small set of drivers high |
| `GEO_ANOMALY` | A coordinate cluster with many rides but few distinct customers |
| `SYNC_RATING_ATTACK` | Bursts of first-time raters all rating one driver inside minutes |
| `BID_CYCLE_RING` | Connected component of customer/driver pairs with repeated accept→withdraw cycles |

Findings are written as `AmlFlag` rows (no new tables — evidence lives in
`AmlFlag.metadata`). Severity=CRITICAL flips `User.isFlagged` (existing
flag-store behaviour) but does **not** auto-freeze. All findings surface
under `/api/admin/conflicts/GRAPH_ANOMALY` for admin review with
`UPHOLD_FLAG`, `OVERTURN_FLAG`, or `NO_ACTION` decisions.

Pattern individual try/catch isolation: one failing pattern does not
abort the cycle for the others. Each pattern caps emitted findings per
run (`GRAPH_PATTERN_MAX_FINDINGS`, default 100).

### Env-overridable thresholds (graph layer)

| Variable | Default | Purpose |
|----------|---------|---------|
| `GRAPH_DETECTION_CRON` | `0 3 * * *` | Daily 03:00 UTC |
| `GRAPH_DETECTION_WINDOW_DAYS` | `7` | Per-tick lookback |
| `GRAPH_DETECTION_TIMEOUT_MS` | `600000` | Per-pattern hard timeout |
| `GRAPH_PATTERN_MAX_FINDINGS` | `100` | Per-pattern emit cap |
| `GRAPH_COLLUSION_DENSITY_MIN` | `0.6` | Bipartite density floor |
| `GRAPH_COLLUSION_MIN_RIDES` | `15` | Minimum internal rides |
| `GRAPH_COLLUSION_MIN_NODES` | `4` | Minimum component size |
| `GRAPH_COLLUSION_EXTERNAL_MAX` | `0.1` | External-edge ratio ceiling |
| `GRAPH_FUNNEL_TOP_RATIO` | `0.7` | Top-N customer concentration floor |
| `GRAPH_FUNNEL_MAX_DISTINCT` | `5` | Top-N customer count |
| `GRAPH_FUNNEL_MIN_AMOUNT_RWF` | `500000` | Lookback minimum earnings |
| `GRAPH_REPUTATION_MIN_RATINGS` | `5` | Min ratings per customer to qualify |
| `GRAPH_REPUTATION_MAX_DRIVERS` | `3` | Max distinct drivers rated |
| `GRAPH_REPUTATION_MIN_STARS` | `4.5` | Average-stars floor |
| `GRAPH_REPUTATION_CLIQUE_MAX` | `6` | Max union of raters across the drivers |
| `GRAPH_GEO_MIN_RIDES` | `20` | Cluster ride count floor |
| `GRAPH_GEO_MIN_CUSTOMERS` | `30` | Distinct-customer ceiling for "concentrated" |
| `GRAPH_GEO_RADIUS_M` | `100` | Cluster radius (meters) |
| `GRAPH_SYNC_RATING_WINDOW_MIN` | `5` | Burst window |
| `GRAPH_SYNC_RATING_MIN_COUNT` | `5` | Burst rating count floor |
| `GRAPH_SYNC_RATING_FIRST_TIME_RATIO` | `0.8` | First-time-rater fraction floor |
| `GRAPH_BID_CYCLE_MIN_PAIRS` | `3` | Pairs per ring floor |
| `GRAPH_BID_CYCLE_WINDOW_HOURS` | `24` | Cycle lookback |
| `GRAPH_BID_CYCLE_MIN_PER_PAIR` | `3` | Cycles-per-pair floor |

### Named follow-up

The original Dispatch J scope (per-user behavioural ML + auto-action
policy) was rejected in product discussion (2026-05-05) on the grounds
that per-user behavioural ML systematically penalises legitimate human
variation. The graph layer above plus the hard-limit AML in C plus
admin tools in H already cover adversarial detection sufficiently for
pilot scale. **Dispatch J was reframed as the aggregate
mobility-intelligence data layer** (next section).

## Mobility intelligence aggregation (Dispatch J — rescoped)

Bimoto sits on a stream of Kigali mobility data that, in aggregate,
contains real commercial intelligence: traffic density by neighbourhood
and hour, route popularity, peak windows. That data is also genuinely
sensitive when *not* aggregated. Dispatch J builds the foundation that
makes commercial exploitation of the aggregate possible *without*
surveilling individuals.

**This is foundation infrastructure for a future commercial product
and is NOT exposed externally.** The pipeline accumulates k-anonymous
historical aggregates so that whenever the product strategy (legal
framework in Rwanda for selling derived mobility data, buyer-class
restrictions, terms-of-service updates, monetisation surface) is
finalised, months of data are already available.

### Pipeline shape

A nightly cron (default 04:00 Africa/Kigali) reads the previous N
hours of `GpsPoint` rows, classifies each into a tier
(DENSE/MEDIUM/LOW/SPARSE) by lat/lng, snaps it to a tier-appropriate
hex cell + time bucket, accumulates per-cell counts and tier-specific
attributes, applies a per-tier k-anonymity threshold (suppressed
silently if below), and writes survivors to `MobilityAggregate`. The
table has no FK back to operational data; once aggregated, individual
journey identities are architecturally unrecoverable.

### Tier table

| Tier | Geography | Cell size | Bucket | k | Attributes |
|------|-----------|-----------|--------|---|------------|
| DENSE | Kigali City Province | 250 m | 30 min | 20 | vehicleType, hour, fareDecile |
| MEDIUM | Huye, Musanze, Rubavu, Rusizi | 500 m | 60 min | 15 | vehicleType, hour |
| LOW | Other district capitals | 1 km | 2 hr | 10 | hour |
| SPARSE | Everywhere else | 5 km | 4 hr | 10 | (none) |

### Env-overridable thresholds (mobility layer)

| Variable | Default |
|----------|---------|
| `MOBILITY_AGGREGATION_CRON` | `0 4 * * *` |
| `MOBILITY_LOOKBACK_HOURS` | `24` |
| `MOBILITY_TIMEZONE` | `Africa/Kigali` |
| `MOBILITY_TIMEOUT_MS` | `900000` |
| `MOBILITY_DENSE_CELL_M` / `_BUCKET_MIN` / `_K` | `250` / `30` / `20` |
| `MOBILITY_MEDIUM_CELL_M` / `_BUCKET_MIN` / `_K` | `500` / `60` / `15` |
| `MOBILITY_LOW_CELL_M` / `_BUCKET_MIN` / `_K` | `1000` / `120` / `10` |
| `MOBILITY_SPARSE_CELL_M` / `_BUCKET_MIN` / `_K` | `5000` / `240` / `10` |
| `MOBILITY_AGGREGATION_PAGE` | `5000` |
| `MOBILITY_RUN_NOW_MAX_RANGE_DAYS` | `90` |

### Privacy guarantees

- **K-anonymity at WRITE time.** Cells with fewer than the tier's
  threshold count are NOT written — no row exists at all.
- **Opaque cellId.** `cellId = sha256(tier:cellSize:axialQ:axialR)`;
  raw lat/lng are not recoverable from the hash alone.
- **Architectural separation.** `services/mobility/store.ts` is
  write-only. Operational services (payment, journey, bid, etc.) MUST
  NOT import from `services/mobility/`. Reads happen only via
  `routes/admin-mobility.routes.ts` and `routes/intel.routes.ts`.

### OD matrix, marginals, and the analyst surface (INTEL-DECK v2)

What Dispatch J left as a named follow-up has since been built.
`services/mobility/aggregator/od-matrix.ts` is a real aggregator, not
a stub: it pages completed journeys, keys each flow by an origin →
destination cell pair, and suppresses the pair unless it clears
`max(k_origin, k_destination)` — the stricter of the two tiers' own
thresholds, so a dense-cell k never launders a sparse one. Alongside
the counts, the pipeline writes attribute marginals (vehicle types,
hour buckets, fare deciles) behind a separate suppression floor of
their own, applied again on the way out so rows written before the
gate existed are sanitised on read.

Reading is no longer admin-only. A read-only `ANALYST` role opens the
`/intel` dashboard and nothing else — every other guard in
`middleware/auth.ts` refuses a role it does not name — and reaches
the aggregates, their stats, the tier configuration, and CSV/JSONL
exports at `/api/intel`. Re-running the pipeline and moving the
thresholds stay behind `adminOnly`. The surface is still internal:
none of it is exposed externally.

## Bid discovery cascade & supply visibility (Dispatch K1)

When a customer posts a ride request, instead of broadcasting to every
online driver at once, the request is exposed in expanding concentric
rings around the pickup. Closest drivers see it first and have a brief
monopoly window to bid; if no bid lands, the ring expands. The cascade
is tier-aware (DENSE Kigali shrinks fast; SPARSE rural opens wide).

The customer's waiting screen polls `GET /api/journeys/:id/supply` to
show "N drivers nearby" with a privacy floor at N≥3 (mirrors J's
k-anonymity discipline) — in low-density areas where exposing the
exact count could de-anonymise individual drivers, the API returns
`{ count: null }` and the UI shows "drivers nearby" without a number.

### Tier cascade defaults

| Tier | Rings (radii in m) | Ring duration |
|------|--------------------|---------------|
| DENSE | 200 → 500 → 1000 → 2000 | 30 s |
| MEDIUM | 500 → 1000 → 2000 → 5000 | 45 s |
| LOW | 1000 → 2000 → 5000 → 10000 | 60 s |
| SPARSE | 2000 → 5000 → 10000 → all | 90 s |

`-1` in the SPARSE final ring means "no radius limit" — rural
requests eventually reach every online driver in the fleet rather
than starving on geometry.

### Worked example — what the customer and drivers see

1. **t=0s.** Nyabugogo customer posts a ride. Drivers within 200m of
   the pickup get a `journey:available` socket event and a notification.
   Customer's screen polls `/supply` and sees `count: 5, displayHint: "few"`.
2. **t=30s, no bid.** Ring expands to 500m. Drivers in 200-500m
   (newly included) get notified. Drivers in the 200m ring do NOT get
   a duplicate. Customer screen now shows `count: 8`.
3. **t=120s.** Ring is at 2km (DENSE last ring). `cascadeComplete: true`
   reported on next poll. If still no bid, the journey stays REQUESTED;
   the customer can wait or cancel.
4. **Sparse village variant.** Customer in a rural village with 1 online
   driver nearby polls `/supply` → `{ count: null, displayHint: "few" }`
   so the driver can't be re-identified. After ~270s the ring opens
   to "no limit" so distant drivers can still bid.

### Env-overridable thresholds (discovery cascade)

| Variable | Default |
|----------|---------|
| `K1_DENSE_RINGS_M` / `K1_DENSE_RING_SEC` | `200,500,1000,2000` / `30` |
| `K1_MEDIUM_RINGS_M` / `K1_MEDIUM_RING_SEC` | `500,1000,2000,5000` / `45` |
| `K1_LOW_RINGS_M` / `K1_LOW_RING_SEC` | `1000,2000,5000,10000` / `60` |
| `K1_SPARSE_RINGS_M` / `K1_SPARSE_RING_SEC` | `2000,5000,10000,-1` / `90` |
| `K1_SUPPLY_FLOOR_N` | `3` |
| `K1_SUPPLY_ROUND_ABOVE` / `K1_SUPPLY_ROUND_BUCKET` | `10` / `5` |
| `K1_DRIVER_LOC_FRESH_SEC` | `300` |

### Limitations (v1)

- **In-process scheduling.** Ring-expansion broadcasts use `setTimeout`,
  so a server restart loses in-flight broadcasts. The journey-feed
  cascade filter is computed on every read, so drivers polling their
  feed still get ring-correct results — they just won't get the live
  socket nudge until they next refresh.
- **Stale driver location.** Drivers whose `lastLocationAt` is older
  than `K1_DRIVER_LOC_FRESH_SEC` are excluded from both cascade
  discovery and supply count. By design — drivers must keep their
  location updated to participate in discovery.

## Driver auto-bid rules (Dispatch K2)

Drivers can pre-configure up to **5 auto-bid rules** that fire bids
automatically when a journey reaches them via the K1 cascade — no
phone interaction required. The driver can override or withdraw any
auto-bid before customer acceptance, pause all rules with one tap,
or review their auto-bid history with rule attribution.

### Rule fields

| Field | Notes |
|-------|-------|
| `priority` | 0..4; lower number wins. Each priority slot is unique per driver. |
| `enabled` | When false, the rule is skipped by the evaluator (paused rules don't count toward the 5-rule cap). |
| `maxPickupDistanceM` | Driver→pickup, in meters (1..10000). |
| `maxRideDistanceM` | Pickup→destination, in meters (1..50000). |
| `vehicleTypeFilter` | `MOTO` / `BIKE` / `E_MOTO` / `E_BIKE` / `null` (no filter). |
| `bidAmountMode` | `FLAT` (default UX) or `PERCENT_OF_FAIR_PRICE` (advanced UX). |
| `bidAmountValue` | FLAT: 100..50000 RWF. PERCENT: 50..200 (e.g. 110 = 110% of fair price = +10%). |

### FLAT vs PERCENT modes

- **FLAT** — the default. The driver types a flat RWF amount
  ("Bid 1500 RWF"). Drivers without mathematical sophistication are
  not excluded.
- **PERCENT_OF_FAIR_PRICE** — one-tap advanced toggle. The driver
  picks a percentage of the system's fair price ("fair-price + 10%").
  Both modes go through the same schema and evaluator from day 1;
  the only difference is UX disclosure.

### Limits and kill switch

- Maximum **5 enabled rules per driver**; paused rules don't count.
- Rate cap: **30 auto-bids per driver per rolling 60-minute window**
  (NOT a calendar hour). Drops one entry per minute as the window
  rolls forward.
- One-tap kill switch: `POST /api/driver/auto-bid-rules/pause-all`
  pauses every rule for the caller in one query.
- **Frozen drivers' rules are NOT evaluated** — defence-in-depth on
  top of K1's exclusion of frozen drivers from cascade.

### Integration with K1

The K2 evaluator hooks into K1's `broadcastToRingDrivers` via
`setImmediate` so the Socket.io broadcast itself is never blocked.
Auto-bid only fires for drivers in the current cascade ring,
preserving K1's geographic discipline. Per-driver evaluation runs
inside try/catch + a 5-second batch timeout: one driver's failure
must not abort the others.

### Env-overridable thresholds (auto-bid)

| Variable | Default |
|----------|---------|
| `K2_MAX_RULES` | `5` |
| `K2_MAX_BIDS_HOUR` | `30` |
| `K2_FLAT_MIN` / `K2_FLAT_MAX` | `100` / `50000` |
| `K2_PERCENT_MIN` / `K2_PERCENT_MAX` | `50` / `200` |
| `K2_DEFAULT_ETA_MIN` | `5` |
| `K2_RATE_WINDOW_MIN` | `60` |
| `K2_MIN_PICKUP_M` / `K2_MAX_PICKUP_M` | `1` / `10000` |
| `K2_MIN_RIDE_M` / `K2_MAX_RIDE_M` | `1` / `50000` |
| `K2_CASCADE_TIMEOUT_MS` | `5000` |

### Endpoints

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/driver/auto-bid-rules` | List driver's rules (priority asc). |
| POST | `/api/driver/auto-bid-rules` | Create a new rule. |
| PATCH | `/api/driver/auto-bid-rules/:id` | Update fields on a rule. |
| DELETE | `/api/driver/auto-bid-rules/:id` | Delete a rule (historical bids stay; `autoBidRuleId` becomes null). |
| POST | `/api/driver/auto-bid-rules/pause-all` | One-tap kill switch. |
| POST | `/api/driver/auto-bid-rules/resume-all` | Reactivate all paused rules. |
| GET | `/api/bids/my-history?autoOnly=true` | Driver's bid history with `autoBidRule` snapshot joined. |

## Customer modes (Dispatch K3)

Customers pick a mode each time they create a request — *not* a sticky
preference, so they never accidentally get bumped into the fast path.

- **"I'll wait"** (`WAIT_AND_COMPARE`, default) — current behaviour.
  Bids accumulate; the customer compares and manually accepts.
- **"I need to go"** (`NEED_TO_GO`) — auto-accepts the first bid whose
  price is at or below `priceCeilingRwf` (computed and *locked* at
  creation time as `round(fairPriceMidpoint × priceCeilingMultiplier)`)
  and that arrives within `K3_AUTO_ACCEPT_WINDOW_SEC` of journey
  creation. The customer commits with a known number — admin
  re-tunes of the fair-price formula don't retroactively change the
  ceiling for in-flight journeys.

Auto-accept reuses the existing `acceptBid` path so the same vehicle,
ownership, journey-status, commission, and escrow checks all run.
Two qualifying bids racing on the same journey → exactly one wins
(SQL-level `SELECT FOR UPDATE` on the Journey row); the other gets
`'race-lost'` and stays in the pool for manual accept.

### Progressive suggest-up

If no bids arrive within the cascade, the customer can raise their
wish-price by tapping a fixed-amount button:

- At **60s**: a **+50 RWF** button becomes available.
- At **120s**: a **+100 RWF** button appears alongside (both stay
  available until the cascade ends).

The server schedules in-process Socket.io emits at each tier; on
restart the in-flight timers are lost (acceptable: customer can still
POST `/api/journeys/:id/suggest-up` manually within the cascade).

### Env-overridable thresholds (customer modes)

| Variable | Default |
|----------|---------|
| `K3_CEILING_MIN` / `K3_CEILING_MAX` | `1.0` / `2.0` |
| `K3_CEILING_DEFAULT` | `1.3` |
| `K3_AUTO_ACCEPT_WINDOW_SEC` | `60` |
| `K3_SUGGEST_UP_T1_SEC` / `K3_SUGGEST_UP_T2_SEC` | `60` / `120` |
| `K3_SUGGEST_UP_T1_RWF` / `K3_SUGGEST_UP_T2_RWF` | `50` / `100` |

### Endpoints

| Method | Path | Notes |
|--------|------|-------|
| POST | `/api/journeys` | Now accepts `requestMode` + `priceCeilingMultiplier` (required when `NEED_TO_GO`, rejected when `WAIT_AND_COMPARE`). |
| POST | `/api/journeys/:id/suggest-up` | Raise wish-price by `addRwf` (must be one of the configured tier amounts; tier-availability is enforced). |
| GET | `/api/journeys/:id/customer-mode-status` | Returns `requestMode`, locked `priceCeilingRwf`, `autoAcceptWindowEndsAt`, and the suggest-up tier status. |

### Backward compatibility

Existing journeys created before K3 default to `WAIT_AND_COMPARE`
with null ceiling fields. The existing flow is untouched for
customers who don't see the new toggle.

## Cooperative Leader Dashboard (Dispatch M)

Elected leaders of cooperatives like FERWACOTAMO and COOPACTRA get a
first-class platform surface for managing their cooperative on
Bimoto. Three layers were designed together:

1. **Visibility** — driver list, aggregate metrics (today / week /
   month rides, earnings, ratings), per-driver detail, financial
   summaries.
2. **Operational management** — approve / reject driver applications,
   mark drivers active/inactive, sponsor drivers into the cooperative,
   remove drivers from the cooperative.
3. **Cooperative dispatch** — manual on-behalf bid creation. The
   leader picks a known driver and customer; we create a real
   `Journey` + `Bid` pair so the customer's existing accept-bid flow
   matches a dispatched bid the same way it matches any other bid.

**Status: server surface complete, leader screens not yet built.**
Every endpoint documented below exists and is guarded as described.
What does not exist is the leader-facing client UI — there is no
cooperative page or route in `packages/client/src`, and a
`COOPERATIVE_LEADER` who logs in today lands on the ordinary home
screen. Activation is gated on the pilot cooperative decision; until
that lands, this section documents an API, not a screen.

### Role + tenancy

A new `COOPERATIVE_LEADER` role is added to `UserRole`. Every
endpoint is gated behind `requireCooperativeLeader` middleware:

- `COOPERATIVE_LEADER`: must have a non-null `User.cooperativeId`.
  Scoped to that cooperative for every read and write.
- `ADMIN`: can access any cooperative via `?cooperativeId=…`.
- All other roles: 403.

Cross-cooperative interference is not just gated at the route layer
— every mutation also runs `assertDriverInCooperative` defence-in-
depth. Cross-cooperative driver reads/writes return **404** (privacy)
not 403.

### Endpoints (`/api/cooperative/*`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/dashboard` | Aggregate summary (driver counts, today / week / month rides, earnings, average rating, flagged count). |
| GET | `/drivers` | Paginated driver list with operational metrics (online / flagged / frozen). |
| GET | `/drivers/:driverProfileId` | Per-driver detail (recent journeys + earnings + AML flags). |
| GET | `/financials` | Cooperative-level financial summary (totals + per-driver breakdown, applies `cooperative.commissionRate`). |
| GET | `/me` | The leader's own user info + cooperative basics. |
| POST | `/drivers/:driverProfileId/approve` | Verify a driver application. |
| POST | `/drivers/:driverProfileId/reject` | Reject a driver application (requires `reason`). |
| POST | `/drivers/:driverProfileId/set-active` | Toggle driver active flag. |
| POST | `/drivers/:driverProfileId/add-to-cooperative` | Sponsor an existing driver into this cooperative. |
| POST | `/drivers/:driverProfileId/remove-from-cooperative` | Detach a driver (DriverProfile remains, `cooperativeId` cleared). |
| POST | `/dispatch` | Manually dispatch a known customer to a driver in this cooperative (creates Journey + Bid + AdminAction). |

Every leader mutation produces an `AdminAction` row using H's hash-
chain (`appendAdminActionTx`). New `AdminActionType` values:
`COOPERATIVE_LEADER_ACTION` (approve / reject / active / add /
remove) and `COOPERATIVE_DISPATCH` (on-behalf bid creation).

### `metadata: Json` extensibility hatch

`Cooperative.metadata` is a `Json` field intended for per-cooperative
customisation post-launch (commission overrides, membership criteria,
reporting cadences) without another schema dispatch. Don't put
cooperative-specific business logic in code — put it in metadata.

### Onboarding a new cooperative

Operationally (one-time per cooperative):

1. ADMIN creates the cooperative via the cooperative-store
   `createCooperative({ name, registrationNumber, metadata })`.
2. ADMIN promotes the elected leader via `setCooperativeLeader` —
   that updates `User.role` and `User.cooperativeId` and writes
   `Cooperative.leaderId` in one transaction.
3. ADMIN attaches existing drivers via `addDriverToCooperative` (or
   the leader can sponsor them via the platform endpoint after
   login).

### Env-overridable thresholds

| Variable | Default | Purpose |
|---|---|---|
| `M_DISPATCH_DEFAULT_ETA` | `5` | Fallback ETA (minutes) when the leader doesn't pass `etaMinutes`. |
| `M_COOP_DEFAULT_COMMISSION` | `0.0` | Default cooperative commission rate. |
| `M_DASHBOARD_DEFAULT_DAYS` | `7` | Default `periodDays` for `/dashboard` and `/financials`. |
| `M_DASHBOARD_MAX_DAYS` | `90` | Upper bound on `periodDays`. |
| `M_DRIVER_PAGE_SIZE` | `50` | Default driver list page size. |
| `M_DRIVER_MAX_PAGE_SIZE` | `200` | Upper bound on driver list page size. |
| `M_APPROVE_MIN_RATING` | `3.0` | Minimum rating threshold for approval (advisory; not enforced server-side in v1). |
| `M_COOP_REASON_MIN_LENGTH` | `5` | Minimum character length for reject / remove reasons. |
| `M_DISPATCH_DEFAULT_DISTANCE_KM` | `3.0` | Distance assumed when computing fallback fair-price for dispatch without `priceRwf`. |

## The ride itself

Four things the app does end-to-end that this file did not mention.

### Ride recording and the fourteen-day window

The in-ride leg leaves a trace. `useRideTraceRecorder` writes one GPS point
every eight seconds while a leg is under way (`VITE_RIDE_TRACE_MS`) to the
phone's local buffer, and the existing SyncManager drains it to
`POST /api/sync/gps` when the network allows — store-and-forward only, with
no socket leg, so nobody watches the ride live. It starts exactly where the
driver-location broadcast stops: that broadcast tears down at
MATCHED → IN_PROGRESS so the customer can no longer follow the driver after
pickup, and that privacy property is untouched.

Points are kept **fourteen days** (`GPS_TRACE_RETENTION_DAYS`), swept
nightly at 05:00 by `jobs/gps-retention.job.ts`. Points belonging to a
journey in a non-terminal or disputed status are held regardless of age
until it resolves — retention exists for dispute resolution, so the hold is
what makes the short window safe. Both facts are said out loud to driver and
passenger in the disclosure copy. See `docs/data-retention.md`.

### Emergency alerts

A rider or driver holding the SOS button raises an `EmergencyAlert`
(`POST /api/journeys/:id/emergency`). The alert fans out three ways: a
socket alert to the `admins` room, an SMS to the designated ops phone
(`EMERGENCY_OPS_PHONE`), and an SMS to the user's stored emergency contacts.
While it is ACTIVE, both participants' phones stream position to the admins
room and nowhere else — there is no client anywhere that receives another
person's emergency position outside the admin panel. The alert ends four
ways: ops resolves it at `/admin/emergency`, the server's 60-minute valve
expires it, the store entry goes away, or the screen unmounts; each phone
also runs a local cap mirroring the valve, because the phone most likely to
still be streaming an hour in is the one that lost the socket carrying the
message that would have stopped it.

### Declining one bid

A passenger can decline a single offer without ignoring it and without
cancelling the journey: `POST /api/journeys/:id/bids/:bidId/decline`. The
motari is told through exactly the same two channels an accept's losers
already used, so a decline is indistinguishable from losing to a rival —
which is right, because either way the ride is not his.

### Confirming arrival

`POST /api/journeys/:id/confirm` is the passenger's explicit "I am here",
released from `InProgressPage`. It releases escrow immediately rather than
waiting for the auto-confirm job, which remains the fallback for a
passenger who never taps anything.

### Counter-offers (built, asleep — `COUNTER_BID_ENABLED`)

A passenger may suggest a different price for exactly one motari's offer,
exactly once; he accepts or declines. Accepting matches the journey at
the agreed price through the ordinary accept path — the same transaction,
escrow, commission ladder and charge every accept has always taken.
Declining leaves his offer PENDING at the price he first named, so she
can still take it.

**All of it ships DORMANT in APK 14.** Ruling D4 (24 Aug) decided the
counter; the dormant-shipping decision (25 Aug) decided when. The
experiment starts only after several weeks of PLAIN BIDDING have produced
a baseline — how long a request waits, how many offers arrive, what
people actually pay — because a marketplace measured only after a
mechanic was added to it cannot say what the mechanic did. Turning it on
before that baseline exists would spend the one clean measurement this
pilot gets.

**Who flips it, and how.** The founder sets `COUNTER_BID_ENABLED=true` in
the pilot server's environment and restarts it. That is the whole of
Update 7: no new APK, no store round, no rebuild. Until then both
endpoints answer `403 COUNTER_DISABLED` and the app renders nothing —
no button, no dialog, no hint the feature exists. It is deliberately a
SERVER variable and not a `VITE_*` one, because a Vite variable is baked
into the bundle at build time and would need a new APK to change, which
is exactly what this design exists to avoid. The client learns the value
from `/api/health` at boot, on the same probe that already carries the
run modes, defaulting to false: an unreachable health endpoint never
enables a dormant feature. Same shape as the money tier shipping gated
behind `SMS_COMMAND_TIER` (SENDER-MATCH).

Open for the field, from Faustin (24 Aug): should a counter carry a short
reason?

## Key Features
- 4 vehicle types: Bike, Moto, E-Moto, E-Bike
- Fixed-price bidding (no surge pricing, no taxameters)
- Counter-offers: built, dormant behind `COUNTER_BID_ENABLED` (above)
- Escrow payments with cryptographic audit trail
- Offline-first with GPS tracking and sync engine
- Trilingual: Kinyarwanda, English, French
- RURA driver verification with compliance-based gating
- Tiered commission system (3%-6%)
- Full price transparency across 13 touchpoints

## Post-Programme Hardening (Dispatch Q)

Dispatch Q addressed the highest-impact findings from the post-programme
code review:

- Flutterwave webhook signature now uses `crypto.timingSafeEqual` (was
  vulnerable to timing-attack secret extraction).
- Schema cascade behaviour explicitly declared on every relation (was
  implicit; orphan-row risk on future deletions).
- Cooperative dispatch is type-safe (removed `(prisma as any)` casts)
  and protected against double-dispatch races (per-driver 5s in-flight
  lock; second caller gets 409 `DISPATCH_IN_PROGRESS`).
- Suggest-up timer cancellation routed through a single chokepoint
  (`services/journey-state-transitions.ts`) so non-bid-driven journey
  state changes (cron, admin force-cancel) also clean up timers.
- Rate-limiter (auto-bid) has periodic cleanup to prevent unbounded
  Map growth from inactive drivers' stale timestamps.
- JSDoc hazard warnings on the auto-bid evaluator, audit chain
  helpers, and auth middleware.

No new dependencies. No new endpoints. No schema migrations beyond
`onDelete` directives.

## Deployment (Dispatch R1)

The Bimoto API can run on [Render](https://render.com) (free or Starter
tier) with [Supabase](https://supabase.com) as the managed
PostgreSQL provider; on that setup every push to `main` auto-deploys.
This is the documented hosted option, and the playbooks below describe
it.

- **Render setup playbook:** [`docs/deployment/render-setup.md`](docs/deployment/render-setup.md)
- **Supabase setup playbook:** [`docs/deployment/supabase-setup.md`](docs/deployment/supabase-setup.md)
- **Env-var reference (18 required):** [`docs/deployment/render-env-vars.md`](docs/deployment/render-env-vars.md)
- **Operational runbook:** [`docs/deployment/runbook.md`](docs/deployment/runbook.md)
- **Blueprint:** `render.yaml` at the repo root — apply via Render
  dashboard → New → Blueprint.
- **Health check:** `GET /api/health` returns `{ status, dbConnected,
  version, uptime, timestamp }`. Render uses this to gate traffic.

The Dockerfile (`packages/server/Dockerfile`) is multi-stage Node 20.
It runs `prisma migrate deploy` automatically on container start, so
migrations apply on every deploy with no manual step.

The pilot does not use any of the above. The pilot server is
self-hosted on an operator-run machine and reached over a tunnel, and
updating it is a separate, deliberately non-technical procedure — see
[`docs/deployment/updating-the-pilot.md`](docs/deployment/updating-the-pilot.md).

## Mobile builds (Dispatch R1)

The client is wrapped in [Capacitor](https://capacitorjs.com) v6.
Native projects live at `packages/client/ios/` and
`packages/client/android/` and are committed to the repo (build
artefacts are gitignored). Bundle ID is **`rw.bimoto.app`** on both
platforms — **do not change once submitted to either store**.

Four core Capacitor plugins are enabled:

- `@capacitor/geolocation` — replaces `navigator.geolocation` for
  more reliable GPS in poor signal conditions. Web fallback retained.
- `@capacitor/preferences` — durable preferences that survive native
  app updates. localStorage stays as the sync read cache and is
  hydrated from Capacitor Preferences at app boot.
- `@capacitor/network` — exposes wifi vs. cellular vs. offline
  status through the `useNetworkStatus()` hook.
- `@capacitor/push-notifications` — registers FCM (Android) /
  APNS (iOS) device tokens with `/api/push/register`, surfaces
  foreground notifications as in-app toasts, and deep-links taps
  to the right journey/chat screen via `usePushNotifications`.

### Build for Android (any OS, with Android Studio)

```bash
cd packages/client
pnpm build            # build the web app into dist/
pnpm cap:sync         # copy dist into the native projects
pnpm cap:open:android # opens Android Studio
```

In Android Studio: connect a device or start an emulator, click
**Run**. For a release build: **Build → Generate Signed Bundle / APK**.

### Build for iOS (macOS with Xcode)

```bash
cd packages/client
pnpm build
pnpm cap:sync
pnpm cap:open:ios     # opens Xcode
```

A first-time clone on a Mac also needs `pod install` — `cap sync ios`
does this automatically when CocoaPods is installed. In Xcode: select
a simulator/device, click **Run**. For release: **Product → Archive**
→ **Distribute App**.

### CI native builds (Dispatch R2)

- `.github/workflows/android-build.yml` — every push to `main`
  produces an unsigned-release APK as a 30-day GitHub artifact.
- `.github/workflows/ios-build.yml` — manual `workflow_dispatch`
  produces an unsigned `.xcarchive`. Code-signing is intentionally
  deferred until the Apple Developer cert + provisioning profile
  are wired up separately (R5-OPS).

### Push notification setup

Production push delivery requires per-environment provider config —
a Firebase project (Android/FCM) and an Apple Developer APNS auth
key (iOS). See [docs/deployment/mobile-push-setup.md](docs/deployment/mobile-push-setup.md)
for the full procedure. The server-side push service degrades to a
no-op (single startup warning) when secrets are missing, so dev
environments without provider config still boot cleanly.

### Out of scope (deferred to follow-ups)

- Apple code-signing automation in CI (R5-OPS).
- Play Store keystore management (R5-OPS).
- App Store / Play Store submission paperwork.
