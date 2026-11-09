# AML review runbook (Kigali pilot)

Written for the reviewing human — in weeks 1–2 of the pilot that is the
founders. This is the operating manual for the flag queue: what each
detector actually proves, what it merely suggests, what an innocent
account tripping it looks like, and the discipline that keeps verdicts
useful as tuning data.

Detector facts below are derived from the code as of the AML-FP arc
(`services/aml/**`); when the code and this document disagree, the code
wins — fix the document.

## 1. Detection → flag → verdict → (separately) freeze

**Detection.** Two layers write flags:

- **Transaction-time checks** (`services/aml/limits.ts` +
  `services/aml/patterns/*`): hard/soft amount caps, velocity, pair
  frequency, new-account value, burst-after-silence, failure
  clustering, payout concentration.
- **The nightly graph job** (`GRAPH_DETECTION_CRON`, default 03:00):
  collusion ring, money funnel, reputation ring, geo anomaly,
  sync-rating attack, bid-cycle ring. Each pattern is capped at
  `GRAPH_PATTERN_MAX_FINDINGS` (100) findings per run.

**Flag.** Detectors call `recordFlag()`, which writes an `AmlFlag` row
with status `OPEN` (duplicates within 24 h merge instead of stacking).
A CRITICAL flag also sets `User.isFlagged` — a **visibility marker**
for the admin dashboards, not an action.

**Verdict.** Every flag gets a human verdict:

- `DISMISSED` — false positive, overturned. Dismissing a CRITICAL flag
  requires an explicit confirmation step.
- `RESOLVED` — upheld: the pattern was real and has been dealt with
  (e.g. the GRAPH_ANOMALY conflict decision `UPHOLD_FLAG`).
- `MARKED_FOR_FREEZE` — upheld and severe enough that the reviewer
  wants the freeze flow to pick it up; sets `User.isFlagged`.

**Freeze is a separate act.** Only an admin calling
`POST /api/admin/freeze/:userId/freeze` (its own audited service)
freezes an account. **Nothing in the detection layer freezes an
account, holds a payout, or blocks a ride by itself** — the only
automated refusal in the whole stack is the tier-1 hard cap on a single
transaction (`AML_HARD_SINGLE_TX_RWF` / `AML_HARD_DAILY_RWF`), which is
a limits check, not a pattern inference. This is the no-auto-freeze
principle; every severity below that is a request for human attention.

A frozen driver's app shows their balance untouched plus a calm "your
payouts are paused while we review your account" notice — no detector
vocabulary ever reaches a user-facing string.

## 2. Per-pattern one-pagers

### Collusion ring (`COLLUSION_RING`)

- **What it proves:** a set of ≥ 4 users (`GRAPH_COLLUSION_MIN_NODES`)
  whose completed rides in the 7-day window form a dense, closed
  customer↔driver component: ≥ 15 internal rides
  (`GRAPH_COLLUSION_MIN_RIDES`), bipartite density ≥ 0.6
  (`GRAPH_COLLUSION_DENSITY_MIN`), external-edge ratio ≤ 0.1
  (`GRAPH_COLLUSION_EXTERNAL_MAX`). CRITICAL when density ≥ 0.85 and
  external ratio < 0.05 — but only for members whose internal degree
  sits **strictly above the component median**; the periphery of a
  CRITICAL ring is capped at HIGH (`internalDegree` and
  `componentMedianDegree` are in each finding's metadata).
- **What it merely suggests:** that these people ride almost
  exclusively with each other. It says nothing about money laundering
  by itself — density is a social fact before it is a financial one.
- **What innocent looks like:** a freshly onboarded cooperative cohort.
  A moto cooperative joins the pilot together; for their first weeks
  its drivers and the members' regular customers form exactly this
  closed dense component. Check account ages and whether the component
  dissolves as they meet the wider market. See §5 for threshold
  weather during onboarding waves.

### Money funnel (`MONEY_FUNNEL`)

- **What it proves:** over a 30-day settlement window a driver earned
  ≥ 500,000 RWF (`GRAPH_FUNNEL_MIN_AMOUNT_RWF`) from ≥ 8 distinct
  customers (`GRAPH_FUNNEL_MIN_TOTAL_CUSTOMERS`), yet the top 5
  (`GRAPH_FUNNEL_MAX_DISTINCT`) supplied ≥ 70 % of it
  (`GRAPH_FUNNEL_TOP_RATIO`; CRITICAL at ≥ 85 %). Funding customers
  get MEDIUM flags.
- **What it merely suggests:** concentrated inflow. Concentration is
  consistent with structuring value transfer through ride payments —
  and with a driver who simply has anchor clients.
- **What innocent looks like:** contract and parcel drivers, school
  runs. A driver retained by two shops for deliveries, or doing a
  daily school run for three families, is *supposed* to look
  concentrated. The `totalDistinctCustomers` metadata plus journey
  types tell you which story you are in. (Drivers with fewer than 8
  payers are no longer flagged at all — concentration among few payers
  is arithmetic, not evidence.)

### Reputation ring (`REPUTATION_RING`)

- **What it proves:** in a 30-day window, a customer gave ≥ 5 ratings
  (`GRAPH_REPUTATION_MIN_RATINGS`) averaging ≥ 4.5 stars
  (`GRAPH_REPUTATION_MIN_STARS`) to ≤ 3 drivers
  (`GRAPH_REPUTATION_MAX_DRIVERS`), and those drivers' raters form a
  clique of ≤ 6 customers (`GRAPH_REPUTATION_CLIQUE_MAX`) supplying
  > 50 % of each driver's ratings. HIGH only when the average is a
  flat 5.0 from a clique of ≥ 5; otherwise MEDIUM.
- **What it merely suggests:** mutual admiration inside a small circle.
- **What innocent looks like:** the same freshly onboarded cohort as
  above — new drivers whose only raters so far are the handful of
  customers who joined with them will satisfy every clause for a few
  weeks. Ratings diversity grows on its own; re-check before upholding.

### Sync-rating attack (`SYNC_RATING_ATTACK`)

- **What it proves:** one driver received ≥ 5 ratings
  (`GRAPH_SYNC_RATING_MIN_COUNT`) within 5 minutes
  (`GRAPH_SYNC_RATING_WINDOW_MIN`), ≥ 80 % of them from raters with no
  other rating in the window (`GRAPH_SYNC_RATING_FIRST_TIME_RATIO`).
  CRITICAL when the burst is all-5-star and all-first-time.
- **What it merely suggests:** coordination — or coincidence of timing.
- **What innocent looks like:** an onboarding event. A cooperative
  signup drive where twenty new customers install the app and rate
  their first rides the same afternoon produces a textbook burst of
  first-time raters. Check whether the raters' accounts were created
  the same day at the same place before treating it as an attack.

### Geo anomaly (`GEO_ANOMALY`)

- **What it proves:** a destination cluster within 100 m
  (`GRAPH_GEO_RADIUS_M`) collected ≥ 20 completed rides in the window
  (`GRAPH_GEO_MIN_RIDES`) from **fewer than** 30 distinct customers
  (`GRAPH_GEO_MIN_CUSTOMERS`) — many rides, few people, one spot. HIGH
  when the ride-to-customer ratio exceeds 5, else MEDIUM.
- **What it merely suggests:** repetitive traffic to one point.
- **What innocent looks like:** factory shifts and one office's staff.
  A garment factory gate at shift change, or a company whose employees
  expense the same commute daily, is exactly this shape. The cluster
  centroid in the metadata usually settles it in seconds on a map.

### Bid cycle ring (`BID_CYCLE_RING`)

- **What it proves:** ≥ 3 driver↔customer pairs
  (`GRAPH_BID_CYCLE_MIN_PAIRS`) in one connected component, each pair
  showing ≥ 3 accepted-then-withdrawn bids
  (`GRAPH_BID_CYCLE_MIN_PER_PAIR`) inside 24 h
  (`GRAPH_BID_CYCLE_WINDOW_HOURS`). CRITICAL at an average of ≥ 5
  cycles per pair. **Withdrawals stamped `withdrawnSource: SYSTEM`
  (server machinery) are excluded from the counts**; the per-finding
  `systemWithdrawnExcluded` metadata says how many were ignored.
  Legacy rows with a null source still count.
- **What it merely suggests:** bid churn between the same people.
- **What innocent looks like:** dead-zone sync churn. A driver working
  an area with poor connectivity whose app replays queued bid actions
  on reconnect can produce accept/withdraw stutters. Human-typed
  withdrawals (`USER`) minutes apart across several pairs are the
  signature to uphold; anything that smells like one connectivity
  incident is not.

### Pair frequency (`PAIR_FREQUENCY`)

- **What it proves:** one customer-driver pair exceeded 5 rides in 24 h
  (`AML_PAIR_FREQ_24H`) or 15 in 7 days (`AML_PAIR_FREQ_7D`). Flags the
  **customer** at HIGH with the driver and counts in metadata.
- **What it merely suggests:** an unusually busy pair.
- **What innocent looks like:** market-vendor couriers. A vendor who
  sends the same trusted driver to the market four times a day is the
  pilot's core power user, not a launderer. Frequency plus *round-trip
  value* is what matters; frequency alone is a customer-loyalty metric.

DRIVER-ID v3 note: the append-only `VehicleChangeLog` ledger (see
[`driver-identity-lifecycle.md`](./driver-identity-lifecycle.md)) is
deliberately shaped as a future pattern input (rapid serial vehicle
changes); no detector consumes it yet, and adding one is out of scope
until a dedicated dispatch.

## 3. Triage order and verdict discipline

Work the queue in this order:

1. **CRITICAL** — these flipped `User.isFlagged` and sit on the ops
   tile; clear them first.
2. **HIGH with money movement** — money funnel, payout concentration,
   hard/soft limit and velocity flags: anything where value actually
   moved.
3. **Everything else**, oldest first.

Verdict discipline: every flag gets a verdict — dismiss, uphold, or
mark-for-freeze. `NO_ACTION` (in the conflict modules) is reserved for
the genuinely undecidable, not for "probably fine"; "probably fine"
with a reason is a dismissal, and **an overturned flag is a donation to
the tuning fund** — your dismissal note plus the precision ledger (§6)
is how thresholds get better. A skipped verdict teaches the system
nothing.

## 4. The calibration rule (remediation plan, Part I.1 — verbatim)

> Pilot weeks 1–6: no freeze, payout hold, or other adverse action may
> rest solely on graph-pattern evidence; graph flags are
> observe-and-review only; adverse action requires a hard-limit/velocity
> flag, independent operational evidence, or failed verification. Every
> graph flag still receives a verdict.

## 5. Threshold weather: declared onboarding waves

Cohort onboarding makes rings out of innocents (§2). When a wave is
declared — a cooperative joining, a signup drive — pre-emptively
tighten the ring gates for its duration:

- raise `GRAPH_COLLUSION_MIN_RIDES` toward **25–30** (from 15), and
- raise `GRAPH_COLLUSION_DENSITY_MIN` toward **0.7** (from 0.6),

note the change and its end date in the ops calendar, and revert once
the cohort's ride graph has opened up to the wider market. Both are
plain env overrides — no deploy needed beyond a restart.

## 6. Reading `/precision`, and the week-6 trigger

`GET /api/admin/aml-flags/precision?since=<ISO date>` (default window:
the last 42 days) returns, per flag type:

- `open` — still awaiting a verdict (a large number here is a triage
  problem, not a detector problem);
- `markedForFreeze` — upheld into the freeze flow;
- `upheld` — RESOLVED verdicts;
- `overturned` — DISMISSED verdicts;
- `overturnRate` — `overturned / (upheld + overturned)`, `null` until a
  pattern has any verdicts at all. Ignore rates built on fewer than a
  handful of verdicts.

**Week-6 trigger:** at the end of the calibration window, any pattern
whose overturn rate across that window is **above one-third** gets
retuned (raise its thresholds, following §5's spirit) or escalated to
the panel if retuning would blind it. That decision is the point of the
ledger — the verdicts you file in weeks 1–6 are its only input.
