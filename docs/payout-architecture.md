# Driver Payout Architecture

How drivers get paid, in one page. The payout system is a **two-step
model**: earning money and receiving money are separate events, tied
together by a per-driver ledger.

## The two-step model

1. **Per-ride ledger credit.** When a ride's escrow is released
   (`releaseEscrowTx` in `packages/server/src/services/escrow.service.ts`),
   the driver's net payout is credited to `DriverBalance.pendingAmount`
   via `creditDriverBalance`. No money moves — this is bookkeeping.
2. **Scheduled wallet transfer.** A payout job (or the end-shift route)
   later drains that balance: it writes a `DriverPayoutBatch` row
   (`status: PENDING`), calls Flutterwave `transferToWallet`, and on
   settlement marks the batch `SUCCESS` and deducts the amount from
   `pendingAmount` atomically (`markBatchPaidOut` in
   `services/payout.service.ts`).

So "the driver completed a ride" and "the driver's phone wallet
received money" can be hours apart — which schedule applies is the
driver's payout preference.

## The settlement invariant (ESCROW-CREDIT)

**One release, one credit, one place in code.** Every escrow release —
manual confirm, silence-is-consent auto-confirm, reconciliation,
admin dispute resolution, conflict resolvers — goes through
`releaseEscrowTx` (`services/escrow.service.ts`), which does the five
settlement steps atomically in the caller's transaction: escrow →
`RELEASED`, `RELEASED` audit entry, `totalRides` increment,
`completedShifts` increment, and the `creditDriverBalance` ledger
credit. Do **not** reimplement any subset of these inline; the
auto-confirm job and the admin dispute route once did, and every
journey they settled recorded zero driver earnings.

The transition is **single-winner under concurrency**: the update is
predicated on the status the caller loaded, and the affected-row count
decides who won. Two callers racing on the same escrow (double-tapped
confirm, confirm vs auto-confirm, release vs refund) both pass the
stale-read checks, but only one claims the transition; the loser
returns `null` — no audit entry, no counters, no credit — instead of
double-applying. `refundEscrowTx`, `markEscrowChargeSucceeded` and
`markEscrowChargeFailed` use the same predicate discipline, as do
`markBatchPaidOut` (status-predicated `PENDING → SUCCESS` flip plus a
conditional balance **decrement** — never an absolute overwrite, so a
credit landing mid-settlement survives to the next sweep) and
`markBatchFailed` (only `PENDING` can fail; a webhook-settled `SUCCESS`
batch cannot be flipped by a stale reconciler).

Journeys settled before this invariant existed were repaired by
`scripts/backfill-settlement-credit.ts` — see the
[deployment runbook](./deployment/runbook.md#settlement-credit-remediation-escrow-credit).

## The acceptance and audit-chain invariants (BID-ATOMICITY)

The same single-winner discipline holds upstream of settlement, where
the escrow is born:

- **One journey, one winner.** A bid acceptance commits as one atomic
  claim — journey flip predicated on `REQUESTED`, bid flip predicated on
  `PENDING`, rival declines and escrow creation in the same transaction;
  the affected-row count decides, and the losing accept gets
  `BID_NOT_PENDING` (400) having mutated nothing — enforced in
  `acceptBidCore` (`services/bid.service.ts`).
- **The escrow belongs to the winner.** The escrow row is created inside
  that same claim transaction (`createEscrowTx`,
  `services/escrow.service.ts`), backed by the `Escrow.journeyId`
  unique, so it can only ever reference the driver whose accept
  committed.
- **Auto-accept is not a second arbiter.** `tryAutoAcceptBid`
  (`services/customer-modes/auto-accept.ts`) only pre-filters
  eligibility and defers to the same atomic claim; a lost race maps to a
  calm `race-lost` no-op.
- **The audit chain cannot fork.** At most one `EscrowAuditLog` entry
  per `(escrowId, sequenceNumber)` — enforced by the database unique
  (migration `20260731000000_bid_atomicity_audit_chain_unique`), with
  `appendAuditEntryTx` (`services/escrow-audit.service.ts`) treating a
  unique violation as "re-read, recompute, retry (bounded)" so
  legitimate concurrent appends serialize.
- **One decision per conflict.** Every conflict-resolver `decide()`
  claims its decision first (`assertConflictUndecidedTx`,
  `services/admin/admin-action-audit.service.ts`); a racing second admin
  gets `ALREADY_DECIDED` (409) and no side-effects.
- **Caps hold under concurrency.** The AML daily-cumulative
  sum-and-decide is serialized per subject
  (`services/aml/limits.ts`), the fee-waiver campaign cap per
  instrument type (`services/fee-waiver/index.ts`), and AML flag dedupe
  per `(user, type, journey)` (`services/aml/flag-store.ts`) — each via
  a transaction-scoped advisory lock, since none of these predicates has
  a unique-index shape.

For what the audit-chain migration prints when it meets pre-existing
duplicates, see the
[deployment runbook](./deployment/runbook.md#expected-output-from-the-audit-chain-unique-migration-bid-atomicity).

## Payout preferences

`User.payoutPreference` (enum `PayoutPreference`, default
`AT_SHIFT_END`). All schedule times are Africa/Kigali (`utils/kigali-time.ts`).

| Preference | Paid when | Mechanism |
|---|---|---|
| `AT_SHIFT_END` (default) | Driver taps "end shift" | `POST /api/payout/end-shift` → `firePreferenceChangeBatch(driverId, 'SHIFT_END')`. Returns 400 `NOT_SHIFT_END_MODE` unless the driver's *effective* preference is `AT_SHIFT_END`. |
| `TWICE_DAILY` | 06:00 and 18:00 | `jobs/twice-daily-payout.job.ts` (60s tick, fires once per window) |
| `DAILY_22H` | 22:00 | `jobs/payout.job.ts` (60s tick, once per day, cohort `DAILY_22H`) |

## Training wheels (new-driver override)

`services/payout/training-wheels.ts` — `getEffectivePreference()`.
Drivers still on the default `AT_SHIFT_END` with
`User.completedShifts < 3` are treated as `TWICE_DAILY`, so brand-new
drivers get paid on the fixed schedule without having to learn the
end-shift flow. Drivers who explicitly chose `TWICE_DAILY` or
`DAILY_22H` are never overridden.

**Naming caveat — read this before quoting the field.** Despite its
name, `User.completedShifts` counts completed **rides**: it is
incremented once per escrow release in `releaseEscrowTx`, i.e. once
per ride. The override therefore lifts after **3 completed rides** —
often within a single morning — not after 3 shifts or 3 working days.
(A rename to fix the name collided with the pre-existing
`User.completedRides` counter, which is a *different* number:
incremented for both customer and driver on journey completion and
used for customer tiers and AML. Whether the threshold *should* be
"3 rides" or "~3 working days" is an open product decision.)

## Changing preference (guarded)

`POST /api/payout/preference/request-otp` then
`POST /api/payout/preference` (`services/payout/preferences/`):

- **OTP** — the change must present a verified OTP
  (purpose `PAYOUT_PREFERENCE_CHANGE`, `guards.ts`).
- **Rate limit** — one change per 24h per driver (429
  `PREFERENCE_CHANGE_RATE_LIMITED`).
- **30-min cooldown** — if the driver has a pending balance, the
  change queues a payout due 30 minutes later. The
  `PayoutPreferenceChangeLog` row (`payoutFired: false` +
  `payoutDueAt`) *is* the schedule; `jobs/preference-change-payout.job.ts`
  scans and fires due rows, so a server restart can't lose the payout.
- **Anomaly threshold** — pending balance above 50,000 RWF
  (`ANOMALY_PAYOUT_THRESHOLD` env override) blocks the automatic
  payout (`anomaly-check.ts`); the balance stays put for review and
  the change itself still applies.

## The one-in-flight invariant

**A driver can have at most one un-settled (`PENDING`) `DriverPayoutBatch`
at any moment.** It is enforced by the database — a partial unique index,
`DriverPayoutBatch_driverId_pending_key`
(`UNIQUE (driverId) WHERE status = 'PENDING'`, migration
`20260729000000_payout_idempotency_one_inflight_batch`) — not by
application code.

The database is the right place because every application-level guard is
a read followed by a later write: two concurrent callers (a driver
double-tapping "end shift", a payout job racing the end-shift route) can
both read "no batch in flight" and both create one, and no amount of
in-process checking closes that window across processes. The constraint
rejects the second insert no matter who raced whom;
`firePreferenceChangeBatch` maps that rejection (`P2002` on `driverId`)
to the same `{ batchId: null, amount: 0 }` no-op a sequential second call
gets, so the losing caller — usually a double-tap — sees a clean 200.

Prisma's schema language cannot express a partial unique index, so it
lives in raw SQL in the migration; introspection ignores partial indexes,
which keeps the e2e `migrate diff` faithfulness gate clean (documented on
the model in `schema.prisma`). Do **not** replace it with
`@@unique([driverId])` — that would forbid payout *history*, not just
concurrent in-flight batches.

Two related idempotency keys complement the index: the daily job's
day-keyed `txRef` (`payout.job.ts`) makes a re-run of the same day's
sweep collide on `DriverPayoutBatch_txRef_key`, and the
preference-change/`end-shift` path derives its `txRef` from the batch id,
so a retried transfer for the same batch presents the identical reference
to the gateway while legitimate separate payouts (new batches) differ.

## Safety nets

| Net | Where | What it catches |
|---|---|---|
| Fallback payout | `jobs/payout-fallback.job.ts` (hourly) | Any balance unpaid for >24h, regardless of preference, fires `FALLBACK_24H`. |
| AML hard-cap | `services/aml` (`assertAmlCheck` before every transfer) | Over-cap payouts are skipped and a CRITICAL `AmlFlag` is written; sibling payouts continue. |
| Freeze | `User.frozenAt` | Frozen drivers are excluded from every cohort and from `firePreferenceChangeBatch`. |
| Hold | `DriverPayoutBatch.held/heldAt/heldBy/heldReason` | Admin-held batches are skipped by the reconciler. |
| In-flight exclusion | `payout.service.ts` + partial unique index (see [the one-in-flight invariant](#the-one-in-flight-invariant)) | Any un-settled `PENDING` batch excludes the driver from new payouts — money may be in flight; paying again would double-pay. The cohort filters are advisory; the database index is the enforcement. |
| Transfer webhook | `routes/webhook.routes.ts` (`transfer.completed`) | Settles `PENDING` batches as `SUCCESS`/`FAILED` as the gateway reports. |
| Payout reconciliation | `jobs/payout-reconciliation.job.ts` (60s tick, rows ≥30min old) | Polls the gateway for batches the webhook missed; batches with no transfer id after 24h are failed so the funds stay visible in the balance. Late reversals re-credit atomically (`markBatchTransferReversed`). |
| Job leadership | `services/job-lock.ts` (`withJobLock`) | The four payout jobs take a Postgres advisory lock per tick, so overlapping server processes (scale-out, deploys) can't double-fire a sweep. |

## Batch triggers

Every `DriverPayoutBatch` records why it was created
(enum `PayoutBatchTrigger`):

| Trigger | Fired by |
|---|---|
| `SCHEDULED_22H` | `payout.job.ts` daily run |
| `SCHEDULED_06` / `SCHEDULED_18` | `twice-daily-payout.job.ts` windows |
| `SHIFT_END` | `POST /api/payout/end-shift` |
| `PREFERENCE_CHANGE` | `preference-change-payout.job.ts` after the 30-min cooldown |
| `FALLBACK_24H` | `payout-fallback.job.ts` |
| `ADMIN` | Reserved for manual admin disbursement — no code path writes it yet |

## Operations

PAYOUT-D adds the admin money-operations surface: everything below is
read-only over the tables and services above — no new money-mutating
endpoints.

For reviewing the AML flag queue that feeds the freeze flow (triage
order, per-pattern one-pagers, the precision ledger), see
[`aml-review-runbook.md`](./aml-review-runbook.md).

Driver revocation (DRIVER-ID v3) settles a revoked driver's remaining
balance through this same engine (`firePreferenceChangeBatch` with the
`ADMIN` trigger; freeze wins — settlement is deferred until unfreeze):
see [`driver-identity-lifecycle.md`](./driver-identity-lifecycle.md).

### What the admin payouts screen shows

`/admin/payouts` (client) is backed by `routes/admin-payouts.routes.ts`
(`/api/admin/payouts`, `authMiddleware` + `adminOnly`):

- **Summary strip** (`GET /summary`) — batch counts by status and
  trigger over 24h/7d, plus four operational counters: *stuck*
  `PENDING` batches (older than 30 minutes — the reconciler's own
  eligibility threshold), *reversals* in the last 7 days, currently
  *held* batches, and currently *frozen* drivers. Non-zero stuck or
  reversal counts are visually flagged on the page.
- **Batch table** (`GET /batches`) — every `DriverPayoutBatch`
  filterable by `status`/`trigger`/`held`/`driverId` within a
  `sinceHours` window (default 7 days), newest first, each row joined
  with the driver's nickname and phone. Served by the existing
  `[driverId,status]`, `[createdAt]` and `[held]` indexes.
- **Driver money view** (`GET /driver/:driverId`, client route
  `/admin/payouts/driver/:driverId`) — the driver's
  `DriverBalance.pendingAmount`, stored vs effective preference
  (training wheels composed via `getEffectivePreference`, exactly as
  the driver-facing summary does), freeze state
  (`frozenAt/frozenReason/frozenBy/frozenCategory`), and the last 20
  batches.

### Freeze / unfreeze and the payout paths

The driver money view's Freeze/Unfreeze actions call the existing
audited `/api/admin/freeze` endpoints — the payouts surface adds no
mutation of its own. Freezing a driver holds their un-paid batches
(`held/heldAt/heldBy/heldReason`) and excludes the driver from every
payout cohort; held batches are skipped by the reconciler and stay out
of the payout paths until released. Unfreeze takes a `releasePayouts`
flag: `false` restores the account but keeps batches held; `true` also
clears the hold so the normal settle/fallback machinery picks the money
back up. Both actions return the affected batch count
(`heldBatchCount` / `releasedBatchCount`), which the client surfaces in
the confirmation line, and both write `AdminAction` audit rows.

### Where reversals and stuck batches come from

- **Reversals** — the transfer webhook (`transfer.completed` with a
  reversal outcome) or a late reconciler poll calls
  `markBatchTransferReversed`: the batch flips `SUCCESS → FAILED`, the
  amount is re-credited to the balance atomically, and `paidOutAt`
  (set when the batch first succeeded) is left intact. That is the
  queryable reversal signature: **`status: FAILED` with `paidOutAt`
  set**. The reversal instant itself is not stored, so the summary's
  7-day reversal window is anchored on `paidOutAt`; if exact reversal
  timestamps ever matter, add a `reversedAt` field.
- **Stuck batches** — a `PENDING` batch means money may be in flight;
  the reconciler polls batches ≥30 minutes old and settles them from
  gateway state, and fails 24h-old batches with no transfer id. A
  non-zero stuck count on the summary means the webhook *and* the
  reconciler are both behind — check gateway connectivity first.

### Escalation path

Money-integrity events are captured to Sentry (in addition to being
visible on this screen): `payout-transfer-reversed` (a settled
transfer bounced), balance-clamp discrepancies (disbursed more than
the recorded balance), and AML hard-cap skips (CRITICAL `AmlFlag`).
Sentry remains the alerting channel; the payouts screen is the
investigation surface. For a driver dispute: driver money view →
batch list → freeze if suspicious → resolve → unfreeze with
`releasePayouts`.

---

Last verified against commit `83568e6` (branch
`claude/payout-d-admin-money-ops-j2s792`, 2026-07-02).
