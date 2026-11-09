# Test hygiene inventory — 2026-05-09

R3-TEST-HYGIENE dispatch — investigation phase output.

Baseline at HEAD `a430ff1` (R3-DELIVERY merge, PR #49). Run on a fresh
checkout with `pnpm install && pnpm --filter @bimoto/shared build`, then
`pnpm --filter @bimoto/server test`:

```
Test Suites: 5 failed, 1 skipped, 159 passed, 164 of 165 total
Tests:       9 failed, 1 skipped, 1214 passed, 1224 total
```

The 9 failures decompose into 5 test files. All 9 are stale-fixture or
stale-mock failures introduced by R3-LEGS (which wrapped `createJourney`
in `prisma.$transaction(...)` and added a new `/legs/:legId/complete`
endpoint). None expose a real product bug; none require env (DB, secrets);
none are flaky.

## Pre-condition for running the suite locally

`@bimoto/shared` must be built before tests run. The shared package
declares `main: dist/index.js` and `types: dist/index.d.ts`, so ts-jest's
type-check phase fails with `Cannot find module '@bimoto/shared'` until
`packages/shared/dist/` exists. CI passes today because CI does not run
`pnpm --filter @bimoto/server test` — the e2e workflow only runs
`pnpm test:e2e`. This means the 9 failures cataloged below have been
hidden from PR signal entirely.

Resolution is documented in `docs/test-environment.md` (Group D commit).

## Failure inventory

### 1. `swagger.test.ts:40` — `Swagger spec › contains all 123 annotated endpoints across route files`

- **File:** `packages/server/src/__tests__/swagger.test.ts`
- **Assertion:** `expect(endpoints.length).toBe(123)`
- **Failure:** `Expected: 123 / Received: 124`
- **Category:** stale-fixture
- **Root cause:** R3-LEGS (PR #48) added `POST /api/journeys/:id/legs/:legId/complete` with `@openapi` JSDoc. The endpoint is registered in the swagger spec at runtime. Hardcoded count was last updated for R3-N-5; R3-LEGS bumped it from 123 to 124.

### 2. `journey.test.ts:79` — `Journey Service › createJourney › creates a journey with REQUESTED status and increments totalRequests`

- **File:** `packages/server/src/__tests__/journey.test.ts`
- **Assertion:** call to `journeyService.createJourney(...)`
- **Failure:** `TypeError: prisma_1.default.$transaction is not a function`
- **Category:** stale-mock
- **Root cause:** R3-LEGS wrapped the `journey.create` + `legs.createMany` writes in `prisma.$transaction(async (tx) => {...})` at `journey.service.ts:204`. The mock at `journey.test.ts:4-33` does not include `$transaction`, so the function call throws.

### 3a–c. `urgent-journey.test.ts` — three R3-T `createJourney` cases

- **File:** `packages/server/src/__tests__/urgent-journey.test.ts`
- **Tests:**
  - `R3-T — createJourney with URGENT_MESSENGER › calls broadcastUrgentImmediately and NOT scheduleCascadeBroadcasts for URGENT_MESSENGER`
  - `... › calls scheduleCascadeBroadcasts (NOT urgent broadcast) for GOODS — regression check`
  - `... › calls scheduleCascadeBroadcasts (NOT urgent broadcast) for PASSENGER — regression check`
- **Failure:** `TypeError: Cannot read properties of undefined (reading 'status')` at `journey.service.ts:252` (`if (journey.status === JourneyStatus.REQUESTED)`)
- **Category:** stale-mock
- **Root cause:** `urgent-journey.test.ts:33` defines `$transaction: jest.fn()` (returns `undefined`). R3-LEGS expects `$transaction` to invoke the callback and return its result; with `jest.fn()` the result is `undefined`, so the subsequent `journey.status` access throws.

### 4. `redispatch.test.ts:120` — `redispatchJourney — R3-N-4 customer re-discovery › happy path: spawns a fresh REQUESTED journey and stamps redispatchedFromId`

- **File:** `packages/server/src/__tests__/redispatch.test.ts`
- **Assertion:** call to `redispatchJourney('j-orig', 'c1')`, which internally calls `createJourney` (`journey.service.ts:1178`)
- **Failure:** `TypeError: Cannot read properties of undefined (reading 'status')` at `journey.service.ts:252`
- **Category:** stale-mock
- **Root cause:** `redispatch.test.ts:12` defines `$transaction: jest.fn()` — same issue as urgent-journey. The `redispatchJourney` happy path delegates to `createJourney`, which now requires the `$transaction` callback to be invoked.

### 5a–c. `customer-modes-journey-creation.test.ts` — three K3-mode createJourney cases

- **File:** `packages/server/src/__tests__/customer-modes-journey-creation.test.ts`
- **Tests:**
  - `createJourney + customer modes › omitting requestMode → WAIT_AND_COMPARE, no ceiling (backward compat)`
  - `... › NEED_TO_GO + multiplier=1.3 → ceiling computed and stored`
  - `... › CEILING LOCKED at creation: subsequent fair-price changes do not affect stored ceiling`
- **Failure:** `TypeError: prisma_1.default.$transaction is not a function`
- **Category:** stale-mock
- **Root cause:** Mock at `customer-modes-journey-creation.test.ts:9-20` does not include `$transaction`. Same R3-LEGS-induced drift as `journey.test.ts`.

## Categorical breakdown

| Category | Count | Files |
|---|---|---|
| stale-fixture | 1 | swagger.test.ts |
| stale-mock | 8 | journey.test.ts, urgent-journey.test.ts (×3), redispatch.test.ts, customer-modes-journey-creation.test.ts (×3) |
| stale-input | 0 | — |
| env-dependent | 0 | — |
| real-bug | 0 | — |
| flaky | 0 | — |

Group B addresses all 9 mechanically. Group C is a no-op (no env-dependent or real-bug failures). Group D updates `docs/test-environment.md` with the local-run prerequisite.

## Why these 9 escaped the previous dispatch's verification

R3-LEGS's executor presumably ran `pnpm test` locally with `@bimoto/shared/dist` already present from a prior build. The five test files above were not in their changed-file set, so they didn't notice the regressions. R3-DELIVERY's executor noted the 9 failures explicitly but verified via `git stash` that they pre-dated R3-DELIVERY — the correct call (don't fix scope outside your dispatch), but the debt accumulated.

The CI-vs-local divergence (server unit tests not run in CI) is the structural reason these never blocked. Out of scope for this dispatch — flagged in PR body for a future workflow audit.
