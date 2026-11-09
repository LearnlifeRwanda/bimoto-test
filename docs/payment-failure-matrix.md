# The payment-failure matrix (PAY-TRUTH)

What actually happens to a Bimoto customer whose payment fails.

Every row below was **driven through the real customer UI against a live
local stack** — Postgres, the real server (`PAYMENTS_MODE=live`), the real
Vite client — before a single line was changed. The only thing faked is the
vendor Flutterwave SDK, replaced in `require.cache` at the exact seam where
real network I/O happens (`flutterwave-client.ts` lazily
`require('flutterwave-node-v3')` inside `getClient()`). Everything above that
seam — `charge.ts`, `mapFlwError`, the routes, `escrow.service`, the audit
chain — is the real live-mode code.

This matters because the pilot runs `PAYMENTS_MODE=simulated`, and the
simulated client (`services/payment/simulated-client.ts`) **always succeeds**.
Nobody in Kigali can see any of the rows below. There is no failure the team
could have reported.

## Before

Baseline: `b7dd493` (post-#152). MoMo, `POST /api/journeys/:id/accept-bid`
driven from `BidListPage` → Confirm & Pay.

| # | What went wrong | HTTP the client got | `Escrow.status` / `txRef` | `Journey.status` | Audit chain | Exact words on the screen | Accept a bid again on this journey |
|---|---|---|---|---|---|---|---|
| R1 | Charge declined — insufficient funds (gateway 400, `INSUFFICIENT_FUNDS`, non-retryable) | **200 OK**, body says `"status":"MATCHED"` | `FAILED` / original txRef kept | **`REQUESTED`**, `driverId: null` | `0:CREATED_PENDING`, `1:CHARGE_FAILED` | The **MatchedPage**: *"Your driver is on the way"*, LIVE DRIVER TRACKING, the driver card, chat quick-replies, Cancel ride, Emergency. **No error of any kind.** | Same driver re-bidding → `409 ALREADY_BID`. Re-accepting the same bid → `400 BID_NOT_PENDING`. A **second** driver's bid → **`500 INTERNAL_ERROR`** |
| R2 | Charge times out, no gateway answer (`ECONNABORTED` → `TIMEOUT`, retryable) | 200 OK | `PENDING` / txRef set | `MATCHED`, driver set | `0:CREATED_PENDING` | MatchedPage with the driver named. Nothing says the money was never taken. | `400 JOURNEY_NOT_ACCEPTING_BIDS` — nothing to retry, and no money is held |
| R3 | Gateway returns 5xx (503 → `GATEWAY_DOWN`, retryable) | 200 OK | `PENDING` / txRef set | `MATCHED`, driver set | `0:CREATED_PENDING` | MatchedPage with the driver named. Same silence as R2. | `400 JOURNEY_NOT_ACCEPTING_BIDS` |
| R4 | Customer force-quits mid-charge (charge in flight, app killed) | no response ever reaches the client | `HELD` | `MATCHED` | `0:CREATED_PENDING`, `1:CHARGE_CONFIRMED` | App killed — nothing on screen. The customer does not know they paid. | `400 JOURNEY_NOT_ACCEPTING_BIDS`; state is actually correct, the customer just cannot see it |
| R5 | Customer taps accept twice (two concurrent accepts), charge then declines | first `200 OK`, second `400 BID_NOT_PENDING` | `FAILED` | `REQUESTED`, `driverId: null` | `0:CREATED_PENDING`, `1:CHARGE_FAILED` | Same as R1 | Same stranding as R1. #143's single-winner claim held: exactly one escrow row, one audit chain, no fork. |
| R6 | `POST /api/payments/initiate` called directly on the R1 escrow | **`200 {"status":"HELD","txRef":"<fresh>"}`** | `HELD` / **new** txRef | **`REQUESTED`**, `driverId: null` | `0:CREATED_PENDING`, `1:CHARGE_FAILED`, `2:CHARGE_CONFIRMED` | n/a — no client code calls this endpoint | The money is now **held on a journey that has no driver** |
| R7 | `POST /api/payments/initiate-card` on that now-`HELD` escrow | `409 ESCROW_NOT_RETRIABLE` | `HELD`, unchanged | unchanged | unchanged | n/a | Guard intact |
| R8 | `POST /api/payments/initiate` on a healthy `HELD` escrow | `409 ESCROW_NOT_RETRIABLE` | `HELD`, unchanged | `MATCHED` | unchanged | n/a | Guard intact — a settled escrow is never rechargeable |
| R9 | Charge declined, then the **webhook** reports the failure minutes later — nobody at the screen, so `markEscrowChargeFailed` takes its DEFAULT `release-match` | webhook `200 {"status":"ok"}`; the customer sees nothing | `FAILED` / original txRef kept | **`REQUESTED`**, `driverId: null` | `0:CREATED_PENDING`, `1:CHARGE_FAILED` (`disposition: release-match`) | The customer re-opens the app to an ordinary open request, with no sign anything failed | **No.** A new driver bids, the customer accepts → **`500 INTERNAL_ERROR`**. `P2002` on `Escrow.journeyId`, thrown by `tx.escrow.create` (`escrow.service.ts:43`) inside `acceptBidCore`'s claim transaction |
| R10 | Charge declined interactively (`keep-match`), the customer walks away, the **unpaid-match reaper** releases after the 10-minute grace | none — the release is a background job | `FAILED` / original txRef kept | **`REQUESTED`**, `driverId: null` | `0:CREATED_PENDING`, `1:CHARGE_FAILED` (`disposition: keep-match`) | Same: an ordinary open request | **No.** Identical `500` / `P2002` to R9 — the releasing party differs, the dead end does not |

### What R1 proves

The hypothesis this dispatch was written to test is confirmed, with the
stack trace:

```
Invalid `tx.escrow.create()` invocation in
  packages/server/src/services/escrow.service.ts:43
Unique constraint failed on the fields: (`journeyId`)
  code: 'P2002', meta: { modelName: 'Escrow', target: [ 'journeyId' ] }
  at Object.createEscrowTx (services/escrow.service.ts:43)
  at   (services/bid.service.ts:482)
  at acceptBidCore (services/bid.service.ts:427)
```

A customer whose charge fails is returned to a `REQUESTED` journey that
still owns a `FAILED` escrow. Accepting a bid again violates the
`Escrow.journeyId` unique constraint and answers `500`.

It is worse than the hypothesis in two ways the reproduction turned up:

1. **The screen never says anything went wrong.** `markEscrowChargeFailed`
   reverts the journey *after* `acceptBidCore` has already built its
   response, so `/accept-bid` answers `200` with a journey object that
   reads `MATCHED`. `BidListPage.handleAcceptBid` (`:284`) ignores
   `escrowStatus` entirely and navigates to `/journey/:id/matched`. The
   customer watches a live-tracking map for a ride that does not exist.
2. **The journey usually cannot even produce a bid to re-accept.**
   `markEscrowChargeFailed` re-opens `DECLINED` bids but leaves the
   *winning* bid `ACCEPTED`. On a single-bidder journey — the common case
   in a thin pilot market — the only driver gets `409 ALREADY_BID` and the
   customer gets `400 BID_NOT_PENDING`. The `500` needs a second driver to
   reach. Either way the customer cannot pay.

### What R6 proves

The MoMo retry rail is **already built and already correct**. `/initiate`
takes a `FAILED` escrow, mints a fresh `txRef`, recharges, and appends
`CHARGE_CONFIRMED` to the same unforked audit chain. It has no client
caller anywhere (`docs/wiring-map.md:267`, allowlisted as "pending founder
wire-or-delete decision"), and it cannot rescue anything on its own,
because by the time it could be called the journey has already been torn
down. It takes the money and leaves the customer driverless.

### Not exercised by any row, but found while reading

`escrow.service.ts:287 handlePaymentFailure` **deletes the escrow row**
(`prisma.escrow.delete`). It has **no callers** anywhere in
`packages/server/src`. It is dead code that violates the
"no money row is ever deleted" invariant if it is ever wired.

## Reproducing this

The harness is not in the repository — it fakes a vendor SDK and has no
business in production code. It is three files:

* a fake `flutterwave-node-v3` class whose fault mode (`ok`,
  `insufficient`, `timeout`, `gateway5xx`, `slow`) is re-read from a file
  on every call, so modes can be flipped between UI actions without a
  restart;
* a boot shim that installs it into `require.cache` before requiring
  `packages/server/src/index.ts`;
* a Playwright driver that runs one journey per row through the real
  BidListPage and snapshots `Journey`, `Escrow`, `EscrowAuditLog` and `Bid`
  after each.

`PAYMENTS_MODE` stays `live` and dummy `FLW_*` keys are set, so
`getClient()` takes the live branch and constructs the fake.

The permanent, in-repo equivalent is the simulated failure mode added by
PAY-TRUTH G4 (`SIMULATED_FAILURE_MODE`), which drives the same code paths
through `buildSimulatedClient` without a harness.

## After

Same stack, same harness, same rows, re-run once G2 and G3 landed.

| # | What went wrong | HTTP the client got | `Escrow.status` / `txRef` | `Journey.status` | Audit chain | Exact words on the screen | Can the customer act? |
|---|---|---|---|---|---|---|---|
| R1 | Charge declined — insufficient funds | 200 OK (the accept did succeed), body now carries `escrowStatus: FAILED`, `escrowId`, `escrowTxRef`, `paymentFailureCode` | `FAILED` / txRef kept | **`MATCHED`**, driver still attached | `0:CREATED_PENDING`, `1:CHARGE_FAILED` (`disposition: keep-match`) | Stays on the bid screen. *"Payment didn't go through / Not enough money on your Mobile Money account. Top up, then try again. / Your motari is still holding this ride. Pay again and you keep them."* with **Try Mobile Money again**, **Pay by card instead**, **See my ride** | **Yes.** One tap → `POST /api/payments/initiate` → `200 {"status":"HELD"}`, same escrow row, fresh txRef, journey still `MATCHED` to the same driver. Chain: `CREATED_PENDING, CHARGE_FAILED, CHARGE_CONFIRMED` — 3 entries, linked, unforked |
| R2 | Charge times out | 200 OK, `escrowStatus: PENDING` | `PENDING` | `MATCHED` | `0:CREATED_PENDING` | MatchedPage (unchanged — the money may still be moving, and nothing has failed) | Reconciler resolves it; if it resolves to failure the customer gets R1's surface |
| R3 | Gateway 5xx | 200 OK, `escrowStatus: PENDING` | `PENDING` | `MATCHED` | `0:CREATED_PENDING` | MatchedPage (unchanged) | as R2 |
| R4 | Force-quit mid-charge | no response reaches the client | `HELD` | `MATCHED` | `CREATED_PENDING, CHARGE_CONFIRMED` | app killed | Re-opening is safe: a settled escrow answers `409 ESCROW_NOT_RETRIABLE` on both rails and is never charged twice |
| R5 | Accept twice, then declined | first 200, second `400 BID_NOT_PENDING` | `FAILED` | `MATCHED` | `CREATED_PENDING, CHARGE_FAILED` | as R1 | as R1. #143's single-winner claim untouched: one escrow, one chain |
| R6 | `POST /api/payments/initiate` on the FAILED escrow | `200 {"status":"HELD","txRef":"<fresh>"}` | `HELD` / new txRef | **`MATCHED`**, driver attached | `CREATED_PENDING, CHARGE_FAILED, CHARGE_CONFIRMED` | this is now the **Try again** button, not a curl | **Yes** — and the money is held on a journey that has a driver, which was the whole defect in the before-table |
| R7 | `initiate-card` on a `HELD` escrow | `409 ESCROW_NOT_RETRIABLE` | unchanged | unchanged | unchanged | n/a | Guard intact |
| R8 | `initiate` on a `HELD` escrow | `409 ESCROW_NOT_RETRIABLE` | unchanged | unchanged | unchanged | n/a | Guard intact |
| R9 | Webhook-released journey, customer accepts a new bid | **`200 OK`**, `escrowStatus: PENDING`, `escrowAmount` = the NEW bid's price | `PENDING` / **fresh** txRef, `amount` and `driverId` superseded to the new bid's | **`MATCHED`**, new driver attached | `0:CREATED_PENDING`, `1:CHARGE_FAILED(release-match)`, `2:ADOPTED_ON_REACCEPT` — 3 entries, linked, unforked, **one escrow row** | The ordinary matched screen; the customer never learns there was a dead escrow to step over | **Yes.** The surviving escrow is adopted, not duplicated: revived `FAILED → PENDING` through `RETRY_CHARGE`, carrying the new bid's amounts |
| R10 | Reaper-released journey, customer accepts a new bid | **`200 OK`**, same shape as R9 | same as R9, chain shows `CHARGE_FAILED(keep-match)` | **`MATCHED`**, new driver attached | `0:CREATED_PENDING`, `1:CHARGE_FAILED(keep-match)`, `2:ADOPTED_ON_REACCEPT` | Same | **Yes.** Same adoption; the releasing party never mattered to the fix |
| R11 | Any of the above while the **motari** is riding to the pickup | n/a — driver side | `PENDING` or `FAILED` | `MATCHED` | unchanged | **ApproachPage** now carries one line: *"Fare not confirmed yet. Keep going — if it is not paid within 10 minutes, we release you and tell you here."* (and *"Fare paid — this ride is covered."* once `HELD`) | n/a — it informs, it never blocks. Before this row the driver's screen had no payment words at all |

Additionally reproduced after the fix, in `PAYMENTS_MODE=simulated` with
`SIMULATED_FAILURE_MODE=insufficient_funds` (no harness — the in-repo
simulated gateway):

* the same R1 row, end to end, with the same panel and the same chain;
* the card rail end to end with `SIMULATED_FAILURE_MODE=none`: the card
  option appears in simulated mode, the in-app simulated checkout opens
  saying "SIMULATION — no real money", approving it lands escrow `HELD`,
  and the browser makes **zero external requests** — no pilot phone
  reaches `checkout.flutterwave.com` for a payment that is not real.

### What is still true after the fix

**The reload now names the failure, and the non-interactive dead end is
closed** — both by SETTLE-UP (#155). What this section said before is
kept below, struck, because the record of a limit and the record of its
closing belong together.

> ~~**A journey RELEASED by the non-interactive path still cannot be
> re-accepted.**~~ Closed by SETTLE-UP G2. `acceptBidCore` now adopts a
> surviving escrow instead of creating a second one: the revival goes
> through the state machine's only edge out of `FAILED` (`RETRY_CHARGE`),
> the row takes the new bid's amounts, and the supersession is appended
> as `ADOPTED_ON_REACCEPT`. Rows R9/R10 above are the before and after.
> The single-winner property was re-proven, not assumed — two accepts
> racing on a journey with a surviving `FAILED` escrow still end with one
> winner, one escrow row and a linear chain, both in
> `escrow-adoption.test.ts` and against live Postgres row locks.

> ~~**The reload path cannot name the failure.**~~ Closed by SETTLE-UP
> G3. `GET /api/payments/:escrowId/status` answers `failureReason`, read
> off the escrow's latest `CHARGE_FAILED` audit entry, and the retry
> panel fills in the named reason after a reload. The reason stays on the
> chain rather than moving to a column on the escrow row: it is already
> stored there, two homes for one money fact eventually disagree, and
> escrows that failed before this dispatch get named copy with no
> backfill.

**A settled escrow is still never adopted.** A journey whose escrow is
`HELD`, `RELEASED`, `REFUNDED` or `FROZEN` refuses a fresh accept with
`409 ESCROW_NOT_ADOPTABLE` rather than reviving money that is in flight
or already spent. That is the guard, not a limit — but it is the shape
anyone extending adoption needs to know about.

**The driver's line names a window the client holds separately.** The ten
minutes on `ApproachPage` mirror `UNPAID_MATCH_GRACE_MS` in
`jobs/unpaid-match-reaper.job.ts`; nothing enforces that the two agree
beyond a comment on each side. If the reaper's window ever moves, the
motari's screen has to move with it.

**The pilot still cannot see any of this.** `PAYMENTS_MODE=simulated`
always succeeds unless `SIMULATED_FAILURE_MODE` is set, and the simulated
client deliberately omits `data.id`/`amount` (`simulated-client.ts:117`–
`:122`) so it can never trip the card anti-tamper guards for a
transaction that never crossed a gateway. Those guards are proven in
`payment-card-tamper-guards.test.ts` instead, where a forged transaction
is the point — with the escrow outcome asserted alongside each refusal.
