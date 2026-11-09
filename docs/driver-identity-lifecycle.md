# Driver identity lifecycle (DRIVER-ID v3)

How Bimoto identifies a driver as a *person*, how that identity is
revoked, and how the motorcycle stays an honestly-tracked attribute of
the person rather than part of the identity.

Design rationale: the panel's vest/person-identity discussion and
vehicle-switching research of 8 July 2026. The pilot metrics this
architecture serves are **pickup-mismatch reports** and
**time-to-revoke** (target: one admin minute).

## The identifier: the number identifies, only the app verifies

The person-first identifier is `DriverProfile.ruraAuthorizationNumber`
— the **jacket number**. The column doubles as the slot where motorized
drivers record their RURA transport authorization, but the identifier
role is vehicle-independent: bicycle and e-bike drivers carry jacket
numbers too (the seed's `BM-SIM-002` bike driver, for example). It is
unique (Postgres unique index; NULLs permitted, so pre-approval and
legacy rows are unaffected) and, since v3, **mandatory at approval**:
no profile becomes `VERIFIED` without the number — for any vehicle
type — and, for vehicle types whose compliance-matrix entry has
`registrationRequired` (MOTO, E_MOTO), without the registration plate
(`assertDriverApprovable`, `services/driver-verification.service.ts`,
driven by `VEHICLE_COMPLIANCE`, enforced in both `VERIFIED` writers —
the admin approve route and the cooperative-leader approve).

**The pointer-object rule:** any physical object carrying the number —
jacket, vest, sticker, future QR tag — is a convenience *pointer*,
never a trust token. You cannot revoke cloth. What you revoke is the
number's validity in the app, and anyone can check that validity in
seconds (below). Every customer surface that shows the number
(`DriverCard`, `BidCard`, the accepted-booking screen, the chat
header) shows it **only for `VERIFIED` drivers**, so an unverified
number never looks official.

## Lifecycle states

`VerificationStatus`: `PENDING → UNDER_REVIEW → VERIFIED | REJECTED`,
plus the v3 terminal state **`REVOKED`**.

`REVOKED` is deliberately the *only* new state. It is orthogonal to the
two existing pause mechanisms and changes neither:

| Concern | Mechanism | Owner |
|---|---|---|
| Identity no longer valid | `verificationStatus = REVOKED` | this document |
| Money under investigation | `User.frozenAt` (freeze) | `admin/freeze.service.ts`, payout-architecture.md |
| Behaviour (no-shows) | `User.suspendedUntil` (time-boxed) | driver-penalty machinery |

### Revocation (`revokeDriver`, admin route `POST /api/admin/verifications/:userId/revoke`)

One transaction (the freeze-service convention):

1. `verificationStatus = 'REVOKED'`, `revokedAt = now()`, `isOnline = false`.
2. Every `PENDING`/`ACCEPTED` bid of the driver is bulk-withdrawn with
   `withdrawnSource: 'SYSTEM'` — the first production writer of that
   enum value (the bid-cycle-ring detector ignores SYSTEM withdrawals
   by design). This is a deliberate system-level override of the bid
   state machine, which has no user-facing `ACCEPTED → WITHDRAWN` edge.
3. A hash-chained `AdminAction` row (`action: REVOKE_DRIVER`, reason
   mandatory, ≥ 10 chars) — the permanent record. `revokedAt` on the
   profile merely mirrors current state.

Post-commit, best-effort: driver sockets are disconnected, and
**settlement** runs (next section).

Gates that make REVOKED bite everywhere: the bid gate rejects REVOKED
absolutely (even for vehicle types with no regulatory requirements and
even under `SKIP_DRIVER_VERIFICATION`), the online toggle refuses
`isOnline: true`, and the driver app replaces the dashboard with a calm
terminal notice (`driver.revokedNotice`) — no online toggle, no bidding
UI.

### Settlement: revocation settles, never confiscates — and freeze wins

Revocation never deletes records and never touches money except to
**pay it out**. Any positive `DriverBalance` is settled through the
standard single-driver payout engine
(`firePreferenceChangeBatch(driverId, 'ADMIN')` — the `ADMIN` trigger's
first caller), which AML-checks the transfer and refuses frozen
drivers. There is no parallel payout path.

**Ordering rule: freeze wins.** If the driver is frozen at revocation
time, no settlement fires (`settlement.deferredForFreeze: true` in the
route response). The balance stays put; after unfreeze, the normal
payout machinery (cohorts + the 24h fallback, which exclude frozen
drivers but nobody else) settles it. Nothing needs to remember to
re-fire.

### Re-application: the only exit from REVOKED

There is **no reinstate endpoint**, and no code path sets
`REVOKED → VERIFIED` directly (`assertDriverApprovable` refuses REVOKED
profiles with a 422). A returning driver re-applies through the normal
verification submission flow (`PUT /api/users/me/driver-verification`):
any re-submission from a REVOKED profile resets it to `PENDING` and
clears `revokedAt` (the AdminAction chain keeps the history), after
which a complete submission auto-promotes to `UNDER_REVIEW` and goes
through admin review like any first application.

## The public live-validity lookup

`GET /api/driver-id/:number` — public, no auth, its own rate-limit
scope (`'driver-id'`, 20/min/IP; scoped so lookup traffic can never
drain another bucket). Client page: `/check-driver` (guard-less), the
landing target for any future QR pointer object.

The contract is rigid and snapshot-tested:

- `{ "active": true, "firstName", "vehicleType" }` **only** when the
  driver exists AND is `VERIFIED` AND `suspendedUntil` is null/past.
  `firstName` carries `User.nickname` — the platform's person display
  name; no separate legal-name field exists.
- `{ "active": false }` — **byte-identical** — for every other case:
  revoked, rejected, pending, under review, suspended, and
  **nonexistent** numbers alike.

**Privacy rationale (the uniform negative):** the endpoint answers
exactly one question — "is this number an active Bimoto driver right
now?" — and nothing else. Because the negative never distinguishes
"revoked" from "never existed", it cannot be used as an existence
oracle to enumerate drivers, confirm a person's past registration, or
leak lifecycle details. Neither shape ever includes phone, plate,
photo, rating, or history.

This is what makes any old vest or jacket provably dead: the cloth
still says the number; the lookup says `active: false`.

## The vehicle-change ledger, guard, and chip

The person is the identity; the motorcycle is a **mutable attribute** —
most Kigali motari do not own their machine, so switching must stay
frictionless. v3 keeps it self-service and instant (no approval step)
but makes it visible:

- **Ledger** — every actual change of vehicle type/plate/description
  through `updateDriverVehicle` (`PUT /api/users/me/driver-profile`)
  writes an append-only `VehicleChangeLog` row (old → new, indexed on
  `[driverId, changedAt]`). No-op saves write nothing.
- **Guard** — the change is *deferred* (409 `VEHICLE_CHANGE_BLOCKED`,
  "Finish your current ride before changing your vehicle details.")
  while the driver has a journey in
  `MATCHED`/`IN_PROGRESS`/`AWAITING_CONFIRMATION` or a
  `PENDING`/`ACCEPTED` bid — i.e. while a customer could be looking for
  the old moto. Never forbidden, only deferred.
- **Deletion bypass** — the account-deletion anonymization write
  (`DELETE /api/users/me`) deliberately bypasses both guard and ledger:
  it is an erasure, not a switch.
- **Chip** — customer bid/booking payloads expose
  `vehicleUpdatedRecently` (latest ledger row within 7 days);
  `DriverCard`/`BidCard` render the neutral chip "Moto updated
  recently". Panel ruling: switching is normal life; the chip is a
  fact, not an accusation — no warning styling.

The ledger is deliberately shaped for later fraud-pattern use (rapid
serial changes as an input signal), but **no detector consumes it in
this dispatch** — see the note in `aml-review-runbook.md`.

## Driver face photos: closed

There is **no driver face-photo layer** — no schema field, no upload,
no display, nothing in the public lookup. (Document photos —
license/RURA/insurance — are verification evidence, not identity
display, and predate v3.) Closed by the panel's photo discussion and
the founder's decision of 8 July 2026. Reopening requires,
**cumulatively**:

1. written counsel clearance under Rwanda's Law 058/2021 sensitive-data
   regime,
2. driver opt-in consent,
3. post-match-only display,
4. exclusion from the public lookup, and
5. pilot pickup-mismatch evidence.

## Related documents

- [`payout-architecture.md`](./payout-architecture.md) — the settlement
  engine revocation reuses, freeze/hold semantics.
- [`aml-review-runbook.md`](./aml-review-runbook.md) — the freeze flow
  that "freeze wins" defers to; future consumers of the vehicle-change
  ledger.
