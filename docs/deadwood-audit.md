# DEADWOOD — intent audit

> Evidence gathered before anything was deleted. Companion to
> `docs/wiring-map.md` (the raw extraction) and `docs/wiring-report.md`
> (the endpoint verdicts). This file answers one question per corpse:
> **did it die on purpose, or by accident?**
>
> Baseline: `main` = `97dc895` (MAP-RWANDA, #162). The wiring map
> regenerates byte-identically at that commit, so every §0 fact this
> dispatch was given reproduces at HEAD.

## Method

Three independent checks per file, none of them "the extractor says so":

1. **Dynamic-import sweep** — `import(` and `React.lazy` across
   `packages/client/src`. The extractor's one known blind spot is a file
   reached only through a dynamic import; if any dead file were loaded
   that way the deletion would be wrong. Sixteen dynamic imports exist
   (`ErrorBoundary`, `useAndroidBackButton`, `main.tsx`'s boot chain,
   `session-reset`, and test-local imports) and **none of them names a
   file on this list**. `React.lazy` is used nowhere.
2. **Reachability walk** — for every commit from `600d493` (the
   client-source restructure that begins all twelve files' visible
   history) to `97dc895`, `git grep` for the file's import specifier in
   `packages/client/src`, excluding tests and the file itself. The last
   commit where a non-test source file still referenced it is the
   moment of death.
3. **Read the commit that did it** — the removing commit's message and
   diff, to tell "superseded by X" from "dropped by accident".

## Verdicts

`LEGACY` = superseded or deliberately retired; safe to delete.
`REGRESSION` = orphaned by accident; must NOT be deleted here — a
regression is a wiring decision, not cleanup.

| File | Verdict | Died at | Evidence / successor |
| --- | --- | --- | --- |
| `components/journey/BidCard.tsx` | LEGACY | never wired since `600d493` | No non-test client source has ever imported it in the visible history. The live customer bid list is `pages/customer/BidListPage.tsx`, which renders its own rows and uses `components/rating/DriverRatingSummary`. Its only inbound edge is from the (also dead) `VerificationBadges`. |
| `components/journey/ChildPassengerInfoCard.tsx` | LEGACY | `e28cd92` (PILOT-READY, #136) | Last importer was `NewJourneyPage.tsx`; `e28cd92`'s own message says it "removes the toggle, age field, **ChildPassengerInfoCard entry point** and the child error map from NewJourneyPage" — the deliberate "adults only" booking decision. The driver-side child surfaces that survived that wave (`ChildTravelNotice`, `ChildPassengerBadge`, `ChildAcknowledgmentModal`) are all still live and untouched. Deliberate retirement, not an accident. |
| `components/journey/JourneyProgress.tsx` | LEGACY | never wired since `600d493` | No importer, ever. The live status surfaces are `JourneyLegsDisplay`, `ApproachStatusBadge` and `CustomerJourneyOutcomeBadge`. |
| `components/journey/MiniMap.tsx` | LEGACY | never wired since `600d493` | No importer, ever — later map waves (`dec8dc8` TRUE-ROUTES, `b613f62` MAP-TRUTH) kept editing it anyway. The live maps are `MapCanvas`, `RoutePreviewMap` and `DriverApproachMap`; `b613f62`'s own comment names MiniMap as one of three components it was factoring shared code out of. |
| `components/journey/PriceInput.tsx` | LEGACY | never wired since `600d493` | No importer, ever. Price entry lives inline on the booking screens, hinted by `FairPriceHint`. |
| `components/journey/VehicleSelector.tsx` | LEGACY | never wired since `600d493` | No importer, ever. `a59901a` (FIELD-FIT, #159) extracted its glyphs into `vehicle-icons.tsx` precisely because "VehicleSelector.tsx held them and was imported by [nothing]"; the live picker is inline on `NewJourneyPage` with `VehicleTypeInfoCard`. The only remaining mention is a comment in `vehicle-icons.tsx`. |
| `components/rating/VerificationBadges.tsx` | LEGACY | `91e496c` (WIRE-AUDIT, #144) | `91e496c` removed the last live import. Its only remaining importer is `BidCard.tsx`, itself dead. The live badge surface is `ReliabilityBadge` inside `DriverRatingSummary`. |
| `hooks/useBids.ts` | LEGACY | never wired since `600d493` | No importer, ever — and its five endpoints (`POST /api/bids`, `/accept`, `/decline`, `/withdraw`, `GET /api/bids/mine`) have never existed on the server. The live bid paths are `/api/journeys/:id/bids` and `/api/journeys/:id/accept-bid`, called directly from `BidListPage` / `BidPage`. Deleting the hook removes five of the six broken wires. |
| `hooks/useEmergency.ts` | LEGACY | never wired since `600d493` | No importer, ever. The live SOS client is `components/safety/EmergencySOS.tsx` + `EmergencyButton.tsx`, mounted on `MatchedPage` and `InProgressPage`, and it calls the live `POST /api/journeys/:id/emergency`. Nothing server-side depends on this file. |
| `hooks/useGPS.ts` | LEGACY | never wired since `600d493` | No importer, ever. Live GPS is `useDriverLocationBroadcast` (socket) plus the `sync/` queue's `POST /api/sync/gps`. |
| `hooks/useJourney.ts` | LEGACY | never wired since `600d493` | No importer, ever. Journey creation and reads are `apiFetch` calls on the screens themselves (`NewJourneyPage`, `GoodsRequestPage`, `CustomerHomePage`) over `journey.store` + the Dexie cache. |
| `src/sw-register.ts` | LEGACY | never wired since `600d493` | No importer, ever, and no config references it (`grep sw-register` across `vite.config.ts`, `index.html`, `main.tsx`, `capacitor.config.ts`: zero hits). `vite.config.ts` configures `VitePWA({ registerType: 'autoUpdate' })` with the default `injectRegister: 'auto'`, which — precisely because the `virtual:pwa-register` module is never imported by the app graph — injects its own `registerSW.js` into `index.html` at build time. Deleting this file therefore changes neither the built bundle nor service-worker registration; `dist/sw.js` is still emitted by Workbox. `docs/webview-floor.md:50` treats SW registration as best-effort ("PWA caching degrades, nothing else"), and the pilot ships a Capacitor APK. |

**Count: 12 LEGACY, 0 REGRESSION.** The dispatch flagged
`ChildPassengerInfoCard` as the likely regression; the commit that
orphaned it names it in its own message as an intentional removal, so it
is retired, not dropped. Nothing on this list is withheld from deletion.

## Flake reproduction (before)

Run counts taken at `97dc895` with no source changes.

| Flake | How it was run | Result |
| --- | --- | --- |
| `DiagnosticsPage-error-log.test.tsx` → `Clear log > empties the ledger and the row, and sends nothing` | full client suite (`pnpm test:client`), 3× in full-suite order | **3 fail / 3 runs** — `expected 1 to be +0` at line 185, every time (164 files, 1 failed, 1105 passed on each run) |
| same, file alone (`vitest run src/__tests__/DiagnosticsPage-error-log.test.tsx`) | 3× | **3 fail / 3 runs** |
| same, the failing case alone in a fresh file | 1× | **pass** — confirms the order dependency |
| `e2e/tests/landmark-ride.spec.ts` | spec alone, 6× against a freshly seeded stack | see below |

### DiagnosticsPage — diagnosis

REPRODUCED, and not actually intermittent on this machine: it fails on
every run of the file and passes when the case is lifted into a file of
its own. Instrumenting the assertion shows what survives the clear:

```
LEDGER: [{"kind":"api-network","message":"request failed",
          "method":"GET","path":"/api/users/me", ...}]
```

That entry is not written by the Clear-log test. It is written by the
*previous* test's screen. `useDiagnostics` fires two sequential
`apiFetch` probes (`/api/health`, then `/api/users/me`) and guards only
the `setState` with a `cancelled` flag — the requests themselves are
never cancelled. Vitest runs `afterEach` hooks in reverse registration
order, so the spec's own hook (`vi.unstubAllGlobals()` +
`_resetErrorLedgerForTests()`) runs **before** Testing Library's
`cleanup()`. The half-finished probe therefore resumes against the *real*
`fetch`, fails to reach `localhost:3000`, and `apiFetch` records an
`api-network` entry — into whichever test's ledger happens to be enabled
when the rejection lands. That is the order dependency.

Root cause is in the source, not the test: an unmounted screen should not
still be probing the network. Fixed in G5 by giving the effect an
`AbortController`; `apiFetch` already treats an `AbortError` as "we
cancelled it, say nothing" (`lib/api.ts`, MAP-TRUTH G5), so a cancelled
probe records nothing.

**After the fix:** the file passes 3/3 standalone (was 0/3), and the
full client suite passes 3/3 consecutive runs — 165 files, 1112 tests,
green every time. The before/after comparison is like-for-like: the
same three-full-suite-runs measurement was taken at `3095b75` (all the
deletions and doors in place, the fix not yet applied) and failed 3/3
there. Two regression tests now hold both halves of the fix:
that unmount really aborts the in-flight probes, and that an aborted
probe writes nothing to the ledger.

### landmark-ride — result: UNREPRODUCED

Six consecutive runs of `tests/landmark-ride.spec.ts` against a freshly
migrated + seeded stack (real server on :3000, `vite preview` on :5173,
`--retries=0`, one worker):

| Run | Result | Wall clock |
| --- | --- | --- |
| 1 | 2 passed | 3.9 s |
| 2 | 2 passed | 3.9 s |
| 3 | 2 passed | 4.0 s |
| 4 | 2 passed | 4.4 s |
| 5 | 2 passed | 4.3 s |
| 6 | 2 passed | 4.1 s |

**0 failures in 6 runs**, so by this dispatch's own rule the flake is
marked UNREPRODUCED and no fix is attempted for it in G5. Changing a
test that passes six times out of six, on a suspicion, is how a real
flake gets buried instead of fixed.

Two honest caveats, so the next person does not read this as "the flake
is gone":

* The reported failure rate was ~1 in 3 **on CI**, where the spec runs
  inside the full serial e2e suite and inherits whatever database state
  the preceding specs left behind. Run in isolation — which is what the
  table above measures, and what G1 asked for — it does not fail. So G6
  ran the full 30-spec suite in CI's own order as well; that result is
  in the next section, and it is not as clean a number as the isolated
  runs.
* Two attempts (out of eight made to collect these six) *hung after both
  tests had passed and their journeys had been created and cancelled* —
  in Playwright's own teardown, not in the spec. That is an artifact of
  this sandbox: the pre-installed Chromium is build 1194 while
  `@playwright/test@1.59.1` expects 1217, and the runs here reach it
  through a symlink shim, so `browser.close()` does not always return.
  Both were retried and passed in about four seconds. Neither is
  evidence about the spec, and they are recorded here so the number
  "6 runs" is not quietly hiding the two attempts it took to get them.


## Full e2e suite (G6) — and what it does and does not prove

CI builds shared/server/client, runs `prisma migrate deploy` against an
empty database, seeds it, and runs the 30-spec suite **once**. That
sequence was reproduced locally, and it is green:

| Attempt | Stack state at start | Result |
| --- | --- | --- |
| 1 | fresh `migrate reset` + seed | **30 passed** (54 s) |
| 2 | fresh `migrate reset` + seed | **30 passed** (51 s) |
| 3 | database left dirty by attempt 2 | 28 passed, 2 failed (59 s) |
| 4 | database left dirty by attempt 3 | 7 passed, 23 failed (5.7 min) |
| 5 | database left dirty by attempt 4 | 28 passed, 2 failed (8.9 min) |

Attempts 3–5 are **not evidence about the specs**. The suite is written
against a freshly seeded database — it books rides for `TestCustomer`,
engages `TestDriver`, moves escrows — and nothing resets that state
between runs, which is exactly why CI seeds before every run and runs
once. Re-running against the leftovers is a different experiment, and a
meaningless one; the 23-failure attempt is what a dirty fixture looks
like, not what a regression looks like.

`landmark-ride.spec.ts:108` — the case this dispatch was told is flaky —
failed in attempt 5. That failure is recorded here rather than swept up,
but two things argue against reading it as the reported CI flake:

* it is a whole-test 240 s timeout ending in `page.waitForResponse:
  Target page, context or browser has been closed`, i.e. the browser
  went away, not an assertion that disagreed with the app; and
* that is the same symptom as the two teardown hangs in the isolated
  runs above, all of them traceable to this sandbox's Chromium build
  mismatch (1194 vs the 1217 `@playwright/test@1.59.1` wants, bridged by
  a symlink shim). Attempt 5 also took 8.9 minutes for a suite that
  takes 51 seconds when the browser is healthy.

So the verdict stands as UNREPRODUCED: under the conditions CI actually
uses, the spec passed every time it was run — 6/6 isolated and 2/2 in
full-suite order — and the one failure came from a run whose fixtures
and whose browser were both already broken. No fix is attempted, and no
claim is made that the CI flake is gone. A 1-in-3 failure has roughly a
4% chance of hiding from eight runs, and this environment cannot tell
that apart from a fix.
