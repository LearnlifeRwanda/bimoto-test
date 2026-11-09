# The money view — what THIS viewer sees of THIS entity

**Status:** live at MONEY-VIEW v2 (#207). Supersedes nothing; it writes down
the concept that #202, #206 and #207 each implemented one piece of.

---

## The one idea

Bimoto's read paths kept producing the same defect in different rooms, and
each fix looked local because it was named after the room it was found in:

| # | What was found | Where |
|---|---|---|
| #202 | the passenger could read the motari's net off the commission breakdown | `getJourneyById` |
| #206 | any authenticated caller could read every bid on any journey | `GET /journeys/:id/bids` |
| #207 | the passenger's receipt printed the motari's net off the ESCROW ROW | `getJourneyById`, the customer list |
| #207 | every motari in radius received every rival's raw bid row | the driver feed |
| #207 | every bidder's live GPS and verification internals reached the customer | both journey reads |

They are one defect. **No single place answered "what does THIS viewer see
of THIS entity?"** — so every new exit for an entity started from the raw
row again, and the projection had to be re-derived, or forgotten.

The fix is not more redaction. It is a **named view per (entity, viewer)**,
and a rule that **every exit routes through one** or is **named exempt**.

---

## The views that exist

### Commission — `toCustomerSafeCommission` (#202)

The customer-safe **four**, and only the four:

```
{ bidPrice, customerTier, customerSavings, feeWaiverApplied }
```

Everything else in a breakdown is the motari's wallet. `totalCommissionRate`
and `totalCommissionAmount` are excluded **together and for one reason**:
`payout = price − amount`, and `amount = price × rate`. Either one, with the
price that is already on her screen, reconstructs his net.

`feeWaiverApplied` is a **boolean**, never an amount. On a waived ride the
waived amount IS the nominal tier commission, so publishing it hands the
payout straight back.

### Escrow — `toCustomerEscrowView` / `toDriverEscrowView` (#207)

The settlement ROW, which is the same money at a different exit.

| | customer | driver | privileged |
|---|---|---|---|
| `id`, `status` | ✅ | ✅ | ✅ |
| `amount`, `releasedAt` | ✅ | ✅ | ✅ |
| `feeWaiverApplied` (derived) | ✅ | ✅ | — |
| own tier + rate | `customerTier`, `customerCommissionRate` | `driverTier`, `driverCommissionRate` | full row |
| `commission`, `driverPayout` | ❌ | ✅ | ✅ |
| `waivedCommissionAmount` | ❌ (boolean only) | ✅ | ✅ |
| `txRef`, `flwTxId` | ❌ | ❌ | ✅ |

`id` and `status` are **load-bearing, not courtesy**: `PaymentsPage` polls
`GET /api/payments/:escrowId/status` off `journey.escrow.id`, and
`retryMomoCharge(escrowId)` needs the same id. A view without them breaks
the payment-retry surface on the screen where a charge fails.

The processor references reach **no client of any role**. They identify a
charge to anyone holding them and no surface renders either.

`feeWaiverApplied` derives from `feeWaiverId !== null`, not from the live
waiver table — LAUNCH-TRUTH G3's rule: once an escrow row exists, ITS
waiver decision wins, so a waiver expiring after the ride cannot un-waive
the display.

### The bidder — `CURATED_BIDDER_SELECT` (#207, `services/bidder-view.ts`)

A `DriverProfile` row carries three kinds of thing, and only the first is a
passenger's business:

1. **what she is choosing between** — rating, rides, vehicle, plate,
   verification status, cooperative, jacket number;
2. **his live position** — `lastLat`, `lastLng`, `lastLocationAt`;
3. **verification internals** — `rejectionReason` (an admin's words),
   `revokedAt`, licence and insurance photo URLs, the `screener` relation.

The nine curated fields were already what `getBidsForJourney` selected.
#207 lifted them into one module so the journey reads apply the SAME set
rather than a second copy that drifts. **Adding a field there adds it
everywhere a bidder travels — that is the point.**

His position reaches her legitimately through the approach STREAM, which is
scoped, rate-limited and stops at IN_PROGRESS. The raw include was the same
data with none of that.

### The settlement row read as a money view (#207)

`toCustomerListCommission` / `toDriverSettlementCommission` build the two
breakdown shapes **from the escrow row**, for list payloads that have no
breakdown of their own.

**Derived, never recomputed.** `calculateCommission` off today's tier counts
answers for the rider a customer IS, not the one she WAS when the ride
settled — a passenger crossing the 20-ride line would watch her own history
rewrite itself, and the list would disagree with the receipt. The escrow row
stores the rates and tiers that were APPLIED and the payout CREDITED.

The only real derivation is the savings pair, using
`calculateCommission`'s own definition (`shared/constants/tiers.ts`):

```
saving = round(price × (entry-tier rate − the rate that applied))
```

`totalCommissionAmount` is the **nominal** ladder figure: under a waiver
`commission` holds what was CHARGED (0) and `waivedCommissionAmount` what
the ladder would have taken, so the nominal is the waived amount when a
waiver applied and the charged amount otherwise.

---

## The rule for every new exit

> An exit either routes through a view, or is **named exempt in the
> dispatch report with its evidence**. There is no third state, and
> "it's server-internal" is a claim to be checked, not assumed.

Exempt-by-construction is a real category and the feed is the model for it:
it selects `escrow: { select: { status: true } }`, destructures it out, and
ships only the derived `reopenedUnpaid` flag. Nothing to project, because
nothing of the row leaves.

**The viewer determination must be the same one the neighbouring redaction
uses.** In `getJourneyById` that is `requestingUserId === journey.customerId`,
with `requestingUserId === undefined` meaning privileged/server-internal. A
second, subtly different test beside the first is how the next leak gets in.

**Compute the projection once, spread it into every return.** `getJourneyById`
has three returns in its participant branch; a projection built at one of
them is a projection the other two can forget.

**Two seals beat one.** The feed filters bid rows in the QUERY *and* the
mapper resolves `myBid` by `driverId` rather than taking `bids[0]`. That
second seal is not theatre: a test written against a mapper handed rival
rows caught `[0]` shipping a rival's row as "my bid" the moment the query
filter was removed. A projection correct only because the query above it is
correct is one edit from being the leak.

---

## The client side of the same idea

Three shapes come down one key, so a screen may not dereference a money
field without a **shape predicate** (`lib/commission-view.ts`):

1. the **full** breakdown — driver and privileged callers;
2. the **customer-safe four**;
3. **nothing** — the key absent entirely.

`WireCommissionBreakdown` (= `Partial<CommissionBreakdown>`) is what the wire
actually carries. The shared `CommissionBreakdown` describes the SERVER's
full breakdown correctly and is left alone.

`hasFullCommissionBreakdown` is deliberately the **superset**, not the
per-screen minimum: its job is to make a missing-field crash structurally
impossible, not to satisfy the caller it was written for.

Because the full shape **satisfies the customer-safe predicate too**, a
screen rendering both variants must order them `!full && customerSafe` — or
every driver row renders both blocks.

**And a screen shows the shape it is given, not the role it guesses.**
HistoryPage is at `/rides` for both roles and takes no role context at all:
the server sends the entitled shape, the page renders the matching block.

**Never fabricate a zero** for a field the viewer may not see. A `0` where
the motari's net belongs is a lie about what he is paid; the honest render
is to omit the line.

---

## Where the guarantees live

- **Unit** — the view functions, presence AND absence, with the absence
  asserted over the whole serialized object rather than a hand-listed set,
  so a column added to `Escrow` later cannot quietly re-open a leak.
- **Service** — that every exit actually routes through them. The views
  being correct is half of it; the other half is that no route forgets.
- **Wire (`packages/e2e`)** — the ratchet for the class, on a REAL database.
  This file's own header says why: *"Mocked suites certified the last two
  IDOR-class defects for months."* #206 proved it twice — its bid mock
  answered every call with both rows whatever was asked for, so it could see
  COLUMN scoping and was structurally blind to ROW scoping, which was the
  defect actually present.

A local run needs no Docker: `initdb` a cluster, `prisma migrate deploy`,
seed, and boot server + client with the env block in
`.github/workflows/e2e.yml`. The schema needs no PostGIS — the only
`postgis` string in the migration tree is a comment naming the dev image.

---

## Closed since — RIDES-REACH (this branch)

Both findings above were one function, and the founder's ruling before the
APK 14 cut was that everything surfaced gets fixed. They are fixed.

- **The motari's rides list reaches an answer.** ✅ `history` is a declared
  key in `journeyQuerySchema`
  (`packages/shared/src/schemas/journey.schema.ts`), so Zod no longer strips
  it, and the `LOCATION_REQUIRED` gate moved INSIDE the discovery branch
  (`packages/server/src/services/journey.service.ts`, driver arm). A
  coordinate-less own-rides query is answered, not refused, and MONEY-VIEW
  G3's settlement view renders on the screen it was built for
  (`HistoryPage`, through the `hasFullCommissionBreakdown` guard it already
  carried — no new client conditional).

  The same gate had killed a SECOND screen, which the RIDES-REACH caller
  census found and this dispatch's starting note had not: `/driver/no-show-disputes`
  (`packages/client/src/pages/driver/NoShowDisputesPage.tsx`) sends
  `?viewAs=driver&status=CANCELLED` with no coordinates and was an
  `ErrorState` for the same reason. Also cured.

- **The driver arm's non-discovery branch is scoped to its caller.** ✅ The
  arm forks: discovery (`!history && (!status || status === REQUESTED)`)
  is byte-identical, and everything else is
  `where: { driverId: userId, ...(status ? { status } : {}) }`. No status
  list is needed to say "his" — a `REQUESTED` journey has `driverId: null`
  by construction, so `driverId` alone already means MATCHED-or-later AND
  his. This is the `where` the arm's own FIELD-FIT comment had described
  since #159 without it ever having been written.

**Where the proof is.** `packages/server/src/__tests__/rides-reach-driver-arm.test.ts`
runs against a `findMany` fake that HONOURS its `where` — the only kind of
mock that can tell a scoped read from an unscoped one, and the reason this
class survives mocked suites. Restore the old `where` and its IDOR pins go
red on the rival's rows; that was run and confirmed, not assumed. At the
wire, `packages/e2e/tests/journey-read-authorization.spec.ts` seeds a real
verified rival driver who really completes a real ride, and asserts his
journey id absent from the raw body of both the rides list and the
`status=COMPLETED` query.

**Still open:** nothing in this file.
