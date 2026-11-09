# E2E Expansion Design (R3-E2E-EXPANSION)

Status: Accepted · Date: 2026-05-30 · Scope: `packages/e2e`

This ADR records the design of four new Playwright end-to-end specs and the
helper additions that back them. It documents the decisions taken and — more
importantly — every place the idealized dispatch diverged from what the real
backend actually does, so a future reader trusts the tests over the brief.

## 1. Why these four scenarios

The existing suite had a single cross-locale chat spec. The R3 release added
four cross-cutting flows whose state machines span the journey, leg, escrow,
conflict and SMS subsystems and were only covered by unit/integration tests in
`packages/server`. Each new spec locks in one end-to-end invariant:

- **multi-stop-journey** — a multi-leg journey advances each `Leg` through
  `PENDING → ACTIVE → COMPLETED` in `sequence` order and only reaches
  `COMPLETED` (escrow `RELEASED`) once every leg is done.
- **parcel-delivery** — a GOODS journey's `GOODS_DROPOFF` leg fires the
  recipient-delivered notification on completion, and a recipient SMS reply
  stamps `recipientConfirmedAt` via the real inbound webhook.
- **child-passenger** — the child-passenger flag persists, carries the real
  fare premium, and the driver bid flow interposes the safety acknowledgment.
- **disputed-flow** — a disputed journey becomes an admin conflict, the admin
  refund decision flips escrow to `REFUNDED`, and the AdminAction audit hash
  chain grows by exactly one verifiable entry.

Together they exercise the four highest-risk R3 state transitions in one
real-server pass.

## 2. Test architecture decisions

### Chromium-only, single project
The specs reuse the existing `playwright.config.ts` (unchanged). They launch a
single `chromium` browser in `beforeAll` exactly like
`cross-locale-quick-message.spec.ts`. Cross-browser coverage adds runtime cost
without testing app logic — these flows are API/state driven, not
rendering-engine sensitive — so one project is the right altitude.

### Inline fixtures over shared seed
Each spec builds its own journeys/legs/bids at runtime through the real HTTP
API (`loginAs(...).api`) rather than depending on rows from `prisma/seed.ts`.
The seed only guarantees the three actor users (TestCustomer, TestDriver,
TestAdmin); everything else is created per-test. This keeps specs independent
and order-free: a failure in one cannot corrupt another's fixtures, and reruns
are idempotent because every journey is fresh. The price is a few extra API
round-trips per test, which is cheap relative to the browser interaction.

### No `describe` wrappers, one `test()` each
Every spec is a single top-level `test()` with `test.setTimeout(...)`
(120s for the first three, 180s for the dispute flow). This mirrors the
existing spec and keeps Playwright's trace/report one-row-per-scenario, which
matches how these flows are reasoned about (one linear story with pre/mid/post
state assertions).

### Driver/admin-facing UI only where it is the thing under test
Most of each flow is driven over the authenticated `APIRequestContext` for
speed and determinism. The browser is used only for the genuinely UI-gated
parts: the child-passenger acknowledgment modal and the admin conflicts page.
Auth into the browser context reuses `applyAuthToContext`, which injects the
JWT into the Zustand store and cookies — the same mechanism the chat spec uses.

## 3. Helper-addition convention

New helpers were added to `packages/e2e/tests/helpers.ts` (additive only — no
existing export changed). The convention: keep shared E2E helpers in this one
file until it approaches ~600 LOC, then split by domain. The file is ~557 LOC
after this work, still under that ceiling, so a single module remains the
least-surprising home. All new helpers are `async` named exports matching the
existing style and reuse the module-level `prisma` client (the same one
`loginAs`/`verifyDriver` use for direct DB reads when no API surface exists).

Added: `getJourney`, `waitFor`, `createMultiStopJourney`,
`createParcelJourney`, `addChildPassengerFlag`, `getFairPrice`,
`disputeJourney`, `decideConflict`, `getAuditVerification`, `postInboundSms`,
`waitForLegDelivered`, `waitForRecipientConfirmed`, plus a `TestAdmin` entry in
`SEED_USERS`.

## 4. Deviations from the dispatch (reality wins)

The dispatch's idealized API did not match the codebase in several places.
Each spec implements what the backend actually does:

1. **Leg fields.** `Leg` has `lat/lng/name/contactName/contactPhone` — there is
   no per-leg `recipientPhone`/`pickupLat`/`dropoffLat`. The journey create
   schema (`createJourneySchema`) accepts only documented fields. Goods legs
   (`GOODS_PICKUP`/`GOODS_DROPOFF`) MUST carry a `parcelSize`
   (`validateLegSequence`).

2. **No leg auto-advance.** `markLegCompleted` only flips the named leg; it does
   not auto-activate the next. The multi-stop spec therefore activates each leg
   explicitly (`PENDING → ACTIVE` via `/legs/:legId/activate`) before
   completing it, and asserts later legs stay `PENDING`.

3. **No outbound-SMS store to intercept.** The recipient parcel-delivered SMS
   is fire-and-forget (`sms.service` → Africa's Talking SDK, which only
   `console.log`s in test/dev). There is no `OutboundSms` model and no queue
   endpoint, so the `interceptRecipientSms` helper the dispatch imagined was
   dropped. Instead the parcel spec asserts the `GOODS_DROPOFF` leg reaches the
   delivered state (`completedAt` set — the exact precondition
   `markLegCompleted` uses to fire the SMS) and then exercises the observable
   inbound half: the recipient replies `YES` (a real confirmation keyword in the
   inbound parser) to `POST /api/sms/inbound` (urlencoded `id/from/to/text`;
   HMAC verification is skipped in dev when `AT_INBOUND_HMAC_SECRET` is unset),
   which the recipient-confirm handler matches by `contactPhone` and stamps
   `recipientConfirmedAt`.

4. **Child premium is 1.1x, not 1.5x.** `CHILD_PASSENGER_MULTIPLIER = 1.1`
   (local to `fair-price.service`, not exported from `@bimoto/shared`). The
   premium is applied in the fair-price estimate (rounded to the nearest 50
   RWF), not folded into `priceCeilingRwf` (that field is only set for the
   `NEED_TO_GO` request mode). The spec asserts the ratio via
   `GET /api/journeys/fair-price` with/without `hasChildPassenger`, guarded for
   the null-range (sparse-data, <5 comparable rides) case, plus the persisted
   `hasChildPassenger` flag.

5. **Child flag is create-only + helmet-gated.** There is no PATCH/flag
   endpoint; `hasChildPassenger` is set at create. For MOTO + child age ≤ 12 the
   server's child-safety validator requires `childPassengerHelmetConfirmed:
   true`, so the helper sends it. (`addChildPassengerFlag` is therefore a
   create-a-child-journey helper, not a mutate-existing one.)

6. **Child acknowledgment UI has no checkboxes.** The real
   `ChildAcknowledgmentModal` lists three safety expectations and gates the bid
   behind a single Confirm (`data-testid="child-acknowledgment-modal"` /
   `child-ack-confirm`). There are no helmet/adult checkboxes. The spec asserts
   the modal interposes before the price-confirmation step on a child journey,
   then confirms it.

7. **Dispute = DISPUTED journey, not a Conflict row.** There is no standalone
   Conflict table. A disputed journey IS the conflict, surfaced under the
   `JOURNEY_RECONCILIATION` conflict type, so `conflictId === journeyId`.
   `POST /api/journeys/:id/dispute` sets status `DISPUTED` and escrow `FROZEN`.

8. **Decide endpoint shape + enum.** The admin decision route is
   `POST /api/admin/conflicts/:type/:id/decide` (keyed by conflict type) with a
   minimum-length `reason`. The refund decision enum is `RESOLVED_REFUND` (not
   `REFUND_CUSTOMER`); the journey-reconciliation resolver cross-writes the
   escrow audit log and appends one AdminAction. The response is
   `{ adminAction }`, whose `entryHash` is the audit chain hash. (The escrow
   ledger transition to `REFUNDED` and the journey to `CANCELLED` are applied by
   the surrounding flow; the spec asserts them by re-reading.)

9. **Audit verify is admin-chain only.** `GET /api/admin/conflicts/audit/verify`
   verifies the AdminAction hash chain and returns `{ valid, brokenAt, entries }`
   (`entries` = chain length) — not a combined escrow+admin payload. The spec
   asserts `valid === true` and that `entries` grew by exactly one after the
   decision.

10. **Admin actor.** `SEED_USERS` only had TestCustomer/TestDriver. A
    `TestAdmin` entry was added pointing at the seeded ADMIN phone
    `+250780000000` (`prisma/seed.ts`). `loginAs('TestAdmin')` reuses the
    generic OTP login.

## 5. CI runtime budget

Four specs, chromium-only, mostly API-driven with two short browser
interactions. Each spec is a single linear flow with a handful of poll loops
(≤10s timeouts). Expected wall time is well under the ~8-minute suite budget;
the dispute flow is the longest at 180s max but typically finishes in a few
seconds against a local server. No spec spins up extra browsers beyond what the
interaction requires.

## 6. What was deliberately not changed

`playwright.config.ts`, `global-setup.ts`, and
`cross-locale-quick-message.spec.ts` are untouched. No npm dependencies were
added. A full `tsc` typecheck could not be completed in the authoring sandbox
(the e2e package's dev dependencies — `@types/node`, `@playwright/test`,
`@prisma/client`, `@bimoto/shared` — are not installed there, and the same
`Cannot find type definition file for 'node'` failure reproduces on the base
branch before any change). Correctness was therefore established by reading the
server source for every endpoint, model field and enum value the specs touch
and matching them exactly; every spec's `./helpers` imports were cross-checked
against the real helper exports, and each spec was confirmed to have a single
top-level `test()`, no `describe` blocks, and the required `test.setTimeout`.
