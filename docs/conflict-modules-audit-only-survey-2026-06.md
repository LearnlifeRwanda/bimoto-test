# Conflict Modules — Audit-Only Settlement-Gap Survey (June 2026)

**Status:** read-only diagnosis. No code changed.
**Base:** `main` @ `542e40b9` (post-PR-#89).
**Scope:** the 8 conflict modules besides `JOURNEY_RECONCILIATION` (fixed by PR #84 R3-RECONCILIATION-WIRING-FIX, gateway-completed by PR #88).

## Why this survey exists

PR #84's grounding found that `decide()` being **audit-only** (append `EscrowAuditLog` + `AdminAction`, no state/money change) was a *uniform pattern* across conflict modules — `journeyReconciliationModule.decide()` and `photoMismatchModule.decide()` were structurally identical. PR #84 fixed only `JOURNEY_RECONCILIATION` (the proven-broken customer-dispute path), deferring the question: **are the other 8 modules' audit-only patterns intentional, or the same settlement-gap defect?**

This survey answers that per module.

### Reference: what "fully settled" looks like (JOURNEY_RECONCILIATION, post-PR-#84)
- `RESOLVED_REFUND` → journey `DISPUTED → CANCELLED` (`JourneyAction.ADMIN_REFUND`) + escrow `FROZEN → REFUNDED` (`refundEscrowTx`) + Flutterwave `refundMomo` (PR #88).
- `RESOLVED_PAY` → journey `DISPUTED → COMPLETED` (`JourneyAction.ADMIN_PAY`) + escrow `FROZEN → RELEASED` (`releaseEscrowTx`).
- `RESOLVED_SPLIT` → audit-only, deferred to `R3-SPLIT-SEMANTICS` (no partial-amount schema).
- `NO_ACTION` → audit-only, no state change.

### Verdict taxonomy
- **`INTENTIONAL_INFORMATIONAL`** — admin action correctly effects its domain change (or correctly records an observation); no settlement/money responsibility lives here.
- **`SETTLEMENT_DEFECT`** — like JOURNEY_RECONCILIATION pre-PR-#84: a money-shaped decision records the decision but never moves money or flips state.
- **`SIDE_EFFECT_ONLY`** — fires external side effects (notifications/webhooks) without flipping DB state.
- **`UNCLEAR`** — can't determine from in-session reading.

All 8 modules conform to the `ConflictModule` interface (`conflict-resolver/types.ts`): `type`, `validDecisions`, `listOpen`, `countOpen`, `getDetail`, `decide`. The 9-module registry at `conflict-resolver/index.ts` is unchanged since PR #84.

---

## PHOTO_MISMATCH

**File:** `conflicts/photo-mismatch.ts`
**listOpen filter:** `journey.findMany({ where: { type: 'GOODS', status: 'COMPLETED', pickupPhotoUrl: { not: null }, deliveryPhotoUrl: { not: null }, endedAt: { gte: since } } })`, minus journeys already `RESOLVE_PHOTO_MISMATCH`'d. → every completed goods journey with both photos in the last `PHOTO_MISMATCH_QUEUE_HOURS`, for admin spot-check (no dedicated PhotoFlag table yet).
**validDecisions:** `['NO_ACTION', 'RESOLVED_REFUND', 'FORCE_COMPLETE']`
**decide() body shape:** opens a `$transaction`, loads journey+escrow. For `RESOLVED_REFUND` (if escrow present): appends one `EscrowAuditLog` entry `ADMIN_PHOTO_MISMATCH_REFUND` and cross-links it into the `AdminAction`. Always appends the `RESOLVE_PHOTO_MISMATCH` `AdminAction`. `FORCE_COMPLETE`/`NO_ACTION`: AdminAction only.
**What it does NOT do:** does not call `refundEscrow`/`refundMomo`; does not flip `escrow.status` (FROZEN/HELD → REFUNDED); does not flip `journey.status`; no gateway call. Identical to JOURNEY_RECONCILIATION's *pre-PR-#84* shape.
**Verdict:** **`SETTLEMENT_DEFECT`** (the `RESOLVED_REFUND` decision only). The decision name and module purpose (wrong/mismatched delivery → refund the customer) are money-shaped, but no money moves and escrow stays held. `FORCE_COMPLETE`/`NO_ACTION` are legitimate no-op markers. **Fix scope:** Tier A — mirror PR #84's refund branch (`refundEscrowTx` + optional journey transition + `refundMomo`); the `ADMIN_PHOTO_MISMATCH_REFUND` cross-write already exists. Note: target journey is already `COMPLETED` (not `DISPUTED`), so a journey state transition may be undesired — likely escrow-only refund. ~1 module + tests.

## GPS_PLAUSIBILITY

**File:** `conflicts/gps-plausibility.ts`
**listOpen filter:** `journey.findMany({ where: { status: 'COMPLETED', endedAt: { not: null } } })` then in-memory: last GPS point > `GPS_PLAUSIBILITY_RADIUS_KM` from destination, minus already-decided. → completed journeys whose last GPS is implausibly far from the destination (faked/away-from-destination completion).
**validDecisions:** `['FORCE_COMPLETE', 'RESOLVED_REFUND', 'NO_ACTION']`
**decide() body shape:** structurally identical to PHOTO_MISMATCH — for `RESOLVED_REFUND` appends `ADMIN_GPS_PLAUSIBILITY_REFUND` escrow-audit entry + cross-linked `AdminAction`; otherwise AdminAction only.
**What it does NOT do:** no `refundEscrow`/gateway; no `escrow.status` flip; no `journey.status` flip.
**Verdict:** **`SETTLEMENT_DEFECT`** (`RESOLVED_REFUND` only). Same shape and gap as PHOTO_MISMATCH. **Fix scope:** Tier A — identical treatment to PHOTO_MISMATCH; cross-write already present.

## STALE_DRIVER_NO_SHOW

**File:** `conflicts/stale-driver-no-show.ts`
**listOpen filter:** `bid.findMany({ where: { status: 'ACCEPTED', updatedAt: { lt: cutoff }, journey: { startedAt: null, status: { in: ['MATCHED'] } } } })` minus decided. → drivers who won a bid but never started within `STALE_DRIVER_NO_SHOW_THRESHOLD_MIN` (took the slot and ghosted). **targetType = BID.**
**validDecisions:** `['NO_ACTION', 'FORCE_COMPLETE', 'RESOLVED_REFUND']`
**decide() body shape:** loads the bid; appends the `RESOLVE_STALE_DRIVER_NO_SHOW` `AdminAction`. **Nothing else — no escrow audit cross-write at all, even for `RESOLVED_REFUND`.**
**What it does NOT do:** for `RESOLVED_REFUND`: no escrow-audit entry, no `refundEscrow`, no `journey`/`escrow` status change. The header comment says "`RESOLVED_REFUND` if the journey escrowed" but the code does nothing about it.
**Verdict:** **`SETTLEMENT_DEFECT`** (`RESOLVED_REFUND` only). A ghosting driver leaves a customer whose escrow was charged at bid-acceptance (`markEscrowChargeSucceeded`); refund is the obvious remedy and it doesn't happen. **Fix scope:** Tier B — more than Tier A: must resolve `bid → journey → escrow`, *add* the escrow-audit cross-write (absent today) **and** the settlement. Also consider whether the stuck `MATCHED` journey should transition (CANCELLED) so it leaves the active set. ~1 module + tests; needs a journey-state decision.

## BID_MANIPULATION

**File:** `conflicts/bid-manipulation.ts`
**listOpen filter:** `bid.findMany({ where: { status: 'WITHDRAWN', updatedAt: { gte: since } } })` then in-memory `updatedAt - createdAt <= BID_MANIPULATION_WITHDRAW_WINDOW_SEC`, minus decided. → accept-then-quick-withdraw bids (slot manipulation). **targetType = BID.**
**validDecisions:** `['NO_ACTION', 'FORCE_COMPLETE', 'RESOLVED_REFUND']`
**decide() body shape:** loads the bid; appends `RESOLVE_BID_MANIPULATION` `AdminAction`. **Nothing else.**
**What it does NOT do:** for `RESOLVED_REFUND`: no escrow audit, no `refundEscrow`, no state flip. **The header comment explicitly claims an `EscrowAuditLog` cross-write "if RESOLVED_REFUND on a bid that already had escrow held" — the code does NOT do this. The comment is misleading.**
**Verdict:** **`SETTLEMENT_DEFECT`** (`RESOLVED_REFUND` only), plus a **documentation defect** (header describes behavior that doesn't exist). **Fix scope:** Tier B — same as STALE_DRIVER_NO_SHOW (bid→journey→escrow resolution + add cross-write + settlement), and correct the misleading header. ~1 module + tests.

## RECIPIENT_DISPUTE

**File:** `conflicts/recipient-dispute.ts`
**listOpen filter:** `leg.findMany({ where: { recipientConfirmStatus: 'DISPUTED' } })` minus decided. → parcel legs where the recipient replied "WRONG ITEM"/"DAMAGED"/etc. to the delivery SMS. **targetType = LEG.**
**validDecisions:** `['RESOLVED_REFUND', 'RESOLVED_PAY', 'RESOLVED_SPLIT', 'NO_ACTION']` — the **same money quartet as JOURNEY_RECONCILIATION.**
**decide() body shape:** loads the leg, guards `recipientConfirmStatus === 'DISPUTED'`, appends `RESOLVE_RECIPIENT_DISPUTE` `AdminAction`. **Explicitly comments that it intentionally does NOT mutate the leg, and there is no escrow audit cross-write or settlement.**
**What it does NOT do:** for `RESOLVED_REFUND`: no customer refund; for `RESOLVED_PAY`: no driver release; for `RESOLVED_SPLIT`: nothing — despite the header literally defining these as "customer is refunded" / "driver is paid in full" / "partial refund + partial driver pay."
**Verdict:** **`SETTLEMENT_DEFECT`** — the **strongest analog to JOURNEY_RECONCILIATION pre-PR-#84.** Three of its four decisions are explicitly money-movement, none move money. The "do NOT mutate the leg" comment correctly defends keeping the *dispute record* immutable, but conflates that with the (missing) *settlement* layer. **Fix scope:** Tier C — closest to PR #84 but with a leg→journey→escrow hop, and it needs `RESOLVED_PAY` (release) + `RESOLVED_REFUND` (refund) wired; `RESOLVED_SPLIT` stays blocked on `R3-SPLIT-SEMANTICS`. Per-leg vs per-journey escrow semantics for multi-stop parcels need a product call. ~1 module + tests + a multi-stop-escrow decision.

## AML_APPEAL

**File:** `conflicts/aml-appeal.ts`
**listOpen filter:** `amlFlag.findMany({ where: { severity: 'CRITICAL', status: 'OPEN', user: { isFlagged: true } } })` minus decided. **targetType = AML_FLAG.**
**validDecisions:** `['UPHOLD_FLAG', 'OVERTURN_FLAG', 'NO_ACTION']` — **flag-shaped, not money-shaped.**
**decide() body shape:** **mutates state correctly.** `OVERTURN_FLAG` → `amlFlag.status = DISMISSED` (+ resolver fields) and, if the user has no other open CRITICAL flag, `user.isFlagged = false`. `UPHOLD_FLAG` → `amlFlag.status = RESOLVED`. Always appends the `AdminAction`.
**What it does NOT do:** no escrow movement — and the header states this is deliberate: "overturning a flag has no immediate financial impact. Releasing held funds is a separate UNFREEZE_USER step."
**Verdict:** **`INTENTIONAL_INFORMATIONAL`** (well-wired; not a no-op — it effects the flag/user state change it owns). Settlement is explicitly decoupled to `UNFREEZE_USER`. No defect.

## GRAPH_ANOMALY

**File:** `conflicts/graph-anomaly.ts`
**listOpen filter:** `amlFlag.findMany({ where: { type: { in: GRAPH_FLAG_TYPES }, status: 'OPEN' } })` minus decided. **targetType = AML_FLAG.**
**validDecisions:** `['UPHOLD_FLAG', 'OVERTURN_FLAG', 'NO_ACTION']` — flag-shaped.
**decide() body shape:** **mutates state correctly, ring-wide.** `OVERTURN_FLAG` → `amlFlag.updateMany` (DISMISS every open flag of this type for all ring members) + clears `user.isFlagged` for each member with no other open CRITICAL flag. `UPHOLD_FLAG` → `amlFlag.status = RESOLVED`. Appends `AdminAction`.
**What it does NOT do:** no escrow movement — header: "graph signals do not have a single per-flag financial impact."
**Verdict:** **`INTENTIONAL_INFORMATIONAL`** (well-wired; ring-aware flag resolution). No money semantics; no defect.

## DRIVER_NO_SHOW_DISPUTE

**File:** `conflicts/driver-no-show-dispute.ts`
**listOpen filter:** `journey.findMany({ where: { cancelReason: 'DRIVER_NO_SHOW', driverDisputedAt: { not: null } } })` minus decided. → drivers contesting a no-show attribution against *them*. **targetType = JOURNEY.**
**validDecisions:** `['OVERTURN_FLAG', 'UPHOLD_FLAG', 'NO_ACTION']` — attribution-shaped, not money-shaped.
**decide() body shape:** **mutates state + fires notifications.** `OVERTURN_FLAG` (+ driver present) → `user.noShowCount` decrement (rolls back the cancel-attribution). Appends `AdminAction` inside the tx; **after** commit, fires a fire-and-forget push (`notifyDriverDisputeUpheld/Rejected/ClosedNoAction`) chosen by decision.
**What it does NOT do:** no escrow movement — but the journey was already `CANCELLED` (customer refund, if any, is handled by the cancel flow, not here). This dispute is about driver counters/suspension, not money.
**Verdict:** **`INTENTIONAL_INFORMATIONAL`** (well-wired; effects the counter rollback it owns; correctly orders the notification *after* commit so a rolled-back tx can't emit a phantom push). Has a notification side-effect but is **not** `SIDE_EFFECT_ONLY` because it also flips DB state. No settlement responsibility; no defect.

---

## Roll-up

### Verdict counts
| Verdict | Count | Modules |
|---|---|---|
| `SETTLEMENT_DEFECT` | **5** | PHOTO_MISMATCH, GPS_PLAUSIBILITY, STALE_DRIVER_NO_SHOW, BID_MANIPULATION, RECIPIENT_DISPUTE |
| `INTENTIONAL_INFORMATIONAL` | **3** | AML_APPEAL, GRAPH_ANOMALY, DRIVER_NO_SHOW_DISPUTE |
| `SIDE_EFFECT_ONLY` | 0 | — |
| `UNCLEAR` | 0 | — |

The split is perfectly along the §6 heuristic: **every module with a money-movement decision (`RESOLVED_REFUND`/`PAY`/`SPLIT`) is a settlement defect; every module with flag/counter decisions (`UPHOLD_FLAG`/`OVERTURN_FLAG`) is correctly wired.** `JOURNEY_RECONCILIATION` was the first instance of the former class to be fixed; 5 more remain.

### Recommended follow-up fix dispatches (by ascending scope)
1. **R3-PHOTO-MISMATCH-WIRING-FIX** *(Tier A)* — wire `RESOLVED_REFUND` to actually refund (escrow + `refundMomo`); cross-write already present. Decide whether to transition the already-`COMPLETED` journey (likely escrow-only refund).
2. **R3-GPS-PLAUSIBILITY-WIRING-FIX** *(Tier A)* — identical to photo-mismatch; same treatment.
3. **R3-STALE-NO-SHOW-WIRING-FIX** *(Tier B)* — bid→journey→escrow resolution; *add* the missing escrow cross-write + refund; decide whether the stuck `MATCHED` journey should CANCEL.
4. **R3-BID-MANIPULATION-WIRING-FIX** *(Tier B)* — same as stale-no-show; **also fix the misleading header comment** that claims a cross-write that doesn't exist.
5. **R3-RECIPIENT-DISPUTE-WIRING-FIX** *(Tier C, closest to PR #84)* — leg→journey→escrow; wire `RESOLVED_REFUND` (refund) + `RESOLVED_PAY` (release); `RESOLVED_SPLIT` blocked on `R3-SPLIT-SEMANTICS`; needs a per-leg-vs-per-journey escrow product decision for multi-stop parcels.

Each is independently shippable and bounded to one module + its tests, mirroring PR #84's pattern. None requires a schema migration except possibly recipient-dispute's split path (already deferred).

### Cross-module architecture observations
- **`targetType` varies and dictates fix complexity.** JOURNEY-targeted defects (photo, gps) refund directly off `journey.escrow`. BID-targeted (stale, bid-manip) and LEG-targeted (recipient) defects need an extra hop to reach the escrow → Tier B/C.
- **The escrow cross-write is itself inconsistent.** Photo + GPS append an `ADMIN_*_REFUND` `EscrowAuditLog` entry (the "intent record"); stale, bid-manip, and recipient append **nothing** to escrow on `RESOLVED_REFUND`. So even the audit-only trail is uneven — the Tier-B/C fixes must add the cross-write, not just the settlement.
- **Decision vocabulary cleanly predicts the verdict.** `RESOLVED_REFUND/PAY/SPLIT` ⇒ money ⇒ defect (unless wired); `UPHOLD_FLAG/OVERTURN_FLAG` ⇒ flag/status ⇒ correctly handled. `FORCE_COMPLETE`/`NO_ACTION` are universally legitimate no-op markers.
- **One stale doc-comment found:** bid-manipulation's header describes an escrow cross-write that the code never performs — fix alongside R3-BID-MANIPULATION-WIRING-FIX.
- **The 3 correctly-wired modules all mutate non-escrow domain state** (`amlFlag`/`user.isFlagged`/`user.noShowCount`) and deliberately keep money out of `decide()` (AML→`UNFREEZE_USER`; graph→no per-flag finance; driver-no-show→handled at cancel time).

### Structural similarity to JOURNEY_RECONCILIATION (post-PR-#84)
| Module | Similar / Different |
|---|---|
| PHOTO_MISMATCH | Structurally identical to JR *pre-fix* (audit cross-write only). |
| GPS_PLAUSIBILITY | Structurally identical to JR pre-fix. |
| STALE_DRIVER_NO_SHOW | Similar gap, **different** target (BID) and barer (no escrow cross-write). |
| BID_MANIPULATION | Similar gap, different target (BID), barer + misleading header. |
| RECIPIENT_DISPUTE | **Closest** — same `REFUND/PAY/SPLIT/NO_ACTION` quartet; different target (LEG). |
| AML_APPEAL | **Different** — flag-shaped, fully wired, no settlement. |
| GRAPH_ANOMALY | **Different** — flag-shaped, ring-wide, fully wired. |
| DRIVER_NO_SHOW_DISPUTE | **Different** — counter rollback + notifications, fully wired. |

---

## Escrow-State Verification Addendum (2026-06-02)

### Why this addendum exists

PR #90's survey classified the 5 settlement-defect modules into tiers (A/B/C) from **`decide()`-body shape** (audit-only-ness) alone. A grounding pass during the `R3-PHOTO-MISMATCH-WIRING-FIX` dispatch surfaced the gap: the survey never verified **the escrow state at decide-time**, only that `decide()` failed to settle.

That matters because the fix primitive (`refundEscrowTx`) runs `transitionEscrow(escrow.status, REFUND)`, which is only valid from `HELD` or `FROZEN` (`escrow-sm.ts:8-16`). `RELEASED` is **terminal** (`[RELEASED]: {}`, line 17) — there is no `RELEASED → REFUNDED` exit. So if the escrow is already `RELEASED` at decide-time (money paid to the driver), a "refund" is a **driver clawback**, not an escrow flip, and the wiring fix would throw `Invalid escrow transition: RELEASED + REFUND` at runtime despite compiling and passing naive mock tests.

This addendum re-verifies all 5 settlement-defect modules against the escrow-state-at-decide question and **overrides the original Tier classifications**. The original per-module sections above are preserved as historical record of where the classification missed this check.

**Stop-condition checks (clear):** escrow-sm at HEAD `16582f12` is unchanged since PR #88 — `RELEASED` still terminal, no `RELEASED → REFUNDED` or clawback primitive exists. No defect module's `decide()` changed since PR #90.

### Per-module verification

#### PHOTO_MISMATCH — **clawback design** (not a wiring fix)
- **listOpen** (`photo-mismatch.ts:40-46`): `journey.findMany({ where: { type: 'GOODS', status: 'COMPLETED', pickupPhotoUrl: { not: null }, deliveryPhotoUrl: { not: null }, endedAt: { gte: since } } })`.
- **Escrow at decide-time: `RELEASED`.** Every journey-SM path to `COMPLETED` releases the escrow: `CONFIRM → confirmJourney → releaseEscrow` (`journey.service.ts:690`); `AUTO_CONFIRM` cron → `transitionEscrow(HELD, RELEASE)` (`auto-confirm.job.ts:103-118`); `RECONCILE_BOTH_ARRIVED → releaseEscrow` (`journey.service.ts:1384`).
- **`refundEscrowTx` would throw** (`RELEASED + REFUND` invalid). A refund here recovers money already paid to the driver.
- **Verdict:** blocked on `R3-DRIVER-CLAWBACK-DESIGN`. Original Tier A is wrong.

#### GPS_PLAUSIBILITY — **clawback design** (not a wiring fix)
- **listOpen** (`gps-plausibility.ts:50-51`): `journey.findMany({ where: { status: 'COMPLETED', endedAt: { not: null } } })`, then in-memory GPS-distance filter.
- **Escrow at decide-time: `RELEASED`** — identical reasoning to PHOTO_MISMATCH (`status: 'COMPLETED'`).
- **Verdict:** blocked on `R3-DRIVER-CLAWBACK-DESIGN`. Original Tier A is wrong (same gap as PHOTO_MISMATCH).

#### STALE_DRIVER_NO_SHOW — **genuine wiring fix** ✅
- **listOpen** (`stale-driver-no-show.ts:35-39`): `bid.findMany({ where: { status: 'ACCEPTED', updatedAt: { lt: cutoff }, journey: { startedAt: null, status: { in: ['MATCHED'] } } } })`.
- **Escrow at decide-time: `HELD`.** Bid acceptance (`bid.service.ts:304-307` REQUESTED→MATCHED) creates the escrow (`createEscrow`, :400) and charges it to `HELD` (`markEscrowChargeSucceeded`, :429/:451). The journey is still `MATCHED`/`startedAt=null` (driver ghosted), so no release/confirm has run → escrow remains `HELD`.
- **`HELD → REFUNDED` is a valid escrow-SM transition** (`escrow-sm.ts:10`) → `refundEscrowTx` works.
- **Verdict:** genuine HELD→REFUNDED wiring fix. Schedulable now. Fix should also decide whether the stuck `MATCHED` journey should `CANCEL` (so it leaves the active set) — a journey-state question, but the escrow side is clean. (Survey's Tier B "BID-targeted, cross-write missing" stands; the BID→journey→escrow hop reaches a HELD escrow.)

#### BID_MANIPULATION — **vestigial / no escrow to settle** (neither wiring fix nor clawback)
- **listOpen** (`bid-manipulation.ts:45-46`): `bid.findMany({ where: { status: 'WITHDRAWN', updatedAt: { gte: since } } })`, then in-memory `updatedAt - createdAt <= window`.
- **Escrow at decide-time: none.** The bid-SM (`bid-sm.ts:4-11`) allows `WITHDRAW` **only from `PENDING`** — `ACCEPTED` is terminal (`{}`). So a `WITHDRAWN` bid was never accepted, and escrow is created **only at acceptance** (`acceptBid`). `withdrawBid` (`bid.service.ts:518-537`) merely flips the bid status; it touches no escrow/journey. ⟹ there is no escrow row to refund.
- **Module-premise defect:** the header comment ("a driver accepts a bid, then withdraws…") describes a transition the bid-SM forbids. The heuristic actually catches `PENDING → WITHDRAWN` (quick self-withdrawals), where the customer was never charged. So `RESOLVED_REFUND` is an **inapplicable decision option** — there is nothing to settle. (This compounds the survey's already-noted doc defect that the header claims a non-existent EscrowAuditLog cross-write.)
- **Verdict:** not a wiring fix and not clawback — `RESOLVED_REFUND` is vestigial. Needs a **product review** of the module's premise/decision set, not an escrow fix.

#### RECIPIENT_DISPUTE — **bimodal, dominantly clawback** at decide-time
- **listOpen** (`recipient-dispute.ts:55-56`): `leg.findMany({ where: { recipientConfirmStatus: 'DISPUTED' } })`. The DISPUTED stamp is set by the SMS handler (`handlers/recipient-dispute.ts:59-66`) on a `GOODS_DROPOFF` leg that is already `status: 'COMPLETED'` (delivered), within 60 min of `completedAt`.
- **Escrow at decide-time: starts `HELD`, becomes `RELEASED` before decide.** At dispute-open the parent journey is typically `AWAITING_CONFIRMATION` (escrow `HELD`). **Critically, nothing gates journey completion on a DISPUTED leg** — neither `confirmJourney` nor `auto-confirm.job` checks `recipientConfirmStatus`/legs before releasing escrow. So the journey auto-confirms within 24h (or sooner on customer confirm) → escrow `RELEASED` — independent of the dispute. Admin decisions on the conflict queue lag (hours/days), by which point the escrow is `RELEASED`.
- **Verdict:** bimodal. A `HELD → REFUNDED` wiring fix only works in the narrow race where the admin decides **before** the journey completes; in the dominant case the escrow is already `RELEASED` → clawback. **Adjacent defect surfaced:** a recipient dispute arguably *should* freeze the escrow (block release pending admin review) and currently does not — that gap is itself worth a dispatch (`R3-RECIPIENT-DISPUTE-ESCROW-FREEZE`), and would also make this a clean wiring fix by guaranteeing `FROZEN` at decide-time.

### Corrected tier map

| Module | Original Tier | Escrow @ decide | Corrected verdict | Next step |
|---|---|---|---|---|
| PHOTO_MISMATCH | A | RELEASED | Clawback design | Block on `R3-DRIVER-CLAWBACK-DESIGN` |
| GPS_PLAUSIBILITY | A | RELEASED | Clawback design | Block on `R3-DRIVER-CLAWBACK-DESIGN` |
| STALE_DRIVER_NO_SHOW | B | HELD | **Genuine wiring fix** | Schedule `R3-STALE-NO-SHOW-WIRING-FIX` now |
| BID_MANIPULATION | B | none | Vestigial / N/A | Product review of premise + decision set |
| RECIPIENT_DISPUTE | C | HELD→RELEASED | Bimodal → mostly clawback | Block on clawback **or** `R3-RECIPIENT-DISPUTE-ESCROW-FREEZE` first |

### Updated recommendations

- **Schedulable now (1):** `R3-STALE-NO-SHOW-WIRING-FIX` — HELD escrow, valid SM transition; mirror PR #84's escrow-side fix (no journey transition needed beyond an optional MATCHED→CANCELLED decision).
- **Blocked on a single upstream design beat (3):** PHOTO_MISMATCH, GPS_PLAUSIBILITY, RECIPIENT_DISPUTE all need `R3-DRIVER-CLAWBACK-DESIGN` (recover-from-driver policy: debit pending `DriverBalance`, negative ledger entry, gateway reversal, or escrow-SM `RELEASED → REFUNDED` + clawback primitive — see the R3-PHOTO-MISMATCH-WIRING-FIX halt report). RECIPIENT_DISPUTE could alternatively be converted to a clean wiring fix by landing `R3-RECIPIENT-DISPUTE-ESCROW-FREEZE` first (freeze escrow on dispute so it's `FROZEN`, not `RELEASED`, at decide-time).
- **Product review (1):** BID_MANIPULATION — its `RESOLVED_REFUND` option and "accept-then-withdraw" premise contradict the bid-SM; decide whether the module/decision set should exist as-is.

Net correction to PR #90's roadmap: **of the 5 settlement-defect modules, only 1 is a genuine wiring fix; 3 are clawback-blocked; 1 is vestigial.** The original survey's "5 independently-shippable wiring fixes" framing was over-optimistic by 4.

### Lesson banked for the dispatch-grounding gate

A `SETTLEMENT_DEFECT` verdict from `decide()`-body-shape analysis is **necessary but not sufficient** to plan a wiring fix. The grounding gate must additionally require an **escrow-state-at-decide verification**:

> For any defect-shaped audit-only `decide()` classified as "needs settlement wiring," verify the target row's state at decide-time (escrow state for journey/leg-targeted; balance/charge state for bid/driver-targeted) **and** verify the relevant state machine permits the proposed transition from that runtime-actual state. A wiring fix that compiles and passes mock tests can still throw in production if the SM disallows the actual transition (here: `RELEASED + REFUND`).

This is symmetric to the state-machine transition sub-check banked from R3-E2E-FOLLOWUP-B-V2 (`INTERRUPT` from `AWAITING_CONFIRMATION` is SM-impossible). Same lesson, different code surface: **verify the runtime state, not just the code shape.**
