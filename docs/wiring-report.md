# Wiring report — every feature either reaches a screen or says why not

**Dispatch:** WIRE-AUDIT · **Date:** 2026-08-03 · **Verified against:** `main` @ `80655b7` (post-#143)

> **How this document works.** The raw extraction lives in
> [`wiring-map.md`](./wiring-map.md) / [`wiring-map.json`](./wiring-map.json)
> and is regenerated with `pnpm wiring:map`. This document holds the
> **verdicts**: every server endpoint and every client screen classified,
> with evidence, and a recommendation for everything that isn't wired.
> The CI guard (`pnpm wiring:check`) fails when a *new* orphan endpoint
> or unreachable screen appears that isn't in
> `scripts/wiring-audit/allowlist.json`.
>
> This report **supersedes [`dead-code-report.md`](./dead-code-report.md)
> for wiring questions** (that report is an export-level ts-prune scan;
> this one is feature-level: endpoint → call → screen → nav path).
> The ts-prune report remains valid for its own export-level scope.

## Verdict classes

| Class | Meaning |
| --- | --- |
| **wired-and-reachable** | endpoint ↔ client call ↔ screen ↔ navigation path all present |
| **screen-unreachable** | the code exists and calls its endpoints, but no navigation path reaches the screen |
| **server-orphan** | endpoint with no live client caller and no documented external consumer |
| **dormant-by-decision** | built and deliberately not (yet) surfaced — decision provenance cited |
| **intentionally-headless** | never meant to have a screen (webhooks, ops/runbook curl surfaces, docs) |

## Verdict counts

| Surface | wired | screen-unreachable | server-orphan | dormant-by-decision | intentionally-headless | total |
| --- | --- | --- | --- | --- | --- | --- |
| Server endpoints (156) | 89 | — (see screens) | **15** ¹ | 20 | 32 | 156 |
| Client screens (44) | 26 | **18** | — | — | — | 44 |

¹ 14 endpoints with zero callers + 1 (`POST /api/journeys/:id/confirm`)
whose only caller is a file nothing imports (dead code).

Additionally the extractor surfaced two finding classes the dispatch did
not enumerate but which are exactly its subject:

- **Broken navigation wires (2):** taps that land on the 404 screen.
- **Broken call wires (1 live + 5 in dead code):** client calls to
  endpoints that do not exist.
- **Dead client files (13):** files nothing imports from the bundler entry.

---

## 1 · Headline findings (the ones that answer the founder's question)

### 1.1 The driver's tap on a nearby request lands on the 404 screen

`DashboardPage.tsx:474` navigates to `` `/driver/journey/${request.id}/bid` ``,
but the declared route is `/driver/bid/:id` (`App.tsx`). No route matches
`/driver/journey/:id/bid`, so the tap renders `NotFoundPage`. `git log -L`
shows this target has been wrong since the file was created. **This is the
single most consequential wire in the report: it is the only in-app entry
into the driver bidding flow, and it is broken.**
→ *Recommendation: one-line fix (`/driver/bid/${request.id}`) — named
follow-up candidate, highest priority. Not fixed here per §3 invariants.*

### 1.2 The in-ride flow has (almost) no in-app entry

No navigation edge — BottomNav, `<Link>`, `navigate()`, or guard redirect —
targets any of: `/driver/bid/:id`, `/driver/approach/:id`,
`/driver/ride/:id`, `/driver/goods/:id`, `/driver/no-show-disputes`,
`/journey/:id/progress`, `/journey/:id/confirm`. The only entries found
anywhere are **push-notification deep links** (`usePushNotifications.ts:96`
returns `/journey/:id/progress` for journey pushes, `:95` returns
`/journey/:id/chat` for messages). A user who misses or disables push has
no path from the home screens into an active ride's screens, and the
driver approach/active-ride/goods screens have no discovered entry of any
kind. These screens do call their endpoints (the wiring *above* the screen
is fine); it is the navigation *into* them that is missing.
→ *Recommendation: follow-up dispatch to add resume-into-active-ride
navigation (e.g. active-journey banner/redirect on `/` and `/driver`).*

### 1.3 The customer completion wire is dead code

`POST /api/journeys/:id/confirm` is called only from `hooks/useJourney.ts:265`
— a file **nothing imports**. `ConfirmPage` (itself unreachable, see 1.2)
fetches the journey and posts `rate`/`dispute`, but never `confirm`.
`POST /api/journeys/:id/customer-complete` has no caller at all. Ride
completion today therefore rests on the server-side auto-confirm jobs.
→ *Recommendation: founder decision — either wire the confirm step
(ConfirmPage + navigation) or record auto-confirm as the designed pilot
behaviour and delete the dead client hook.*

### 1.4 A live socket handler refetches from an endpoint that doesn't exist

`useSocket.ts:156` (live — imported by DashboardPage, BidPage, MatchedPage,
ChatPage, ApproachPage) calls `GET /api/bids/mine` on `AUTO_BID_FIRED`.
No such route exists (`/api/bids` mounts only `GET /my-history`). The
refetch fails silently by design ("best-effort"), so the auto-bid toast
shows but the list never refreshes from this path.
→ *Recommendation: follow-up fix — point the refetch at a real endpoint
or drop it.*

### 1.5 The admin island's only entry is the login redirect

Admins DO land on `/admin` at login: `roleHomePath('ADMIN')` returns
`/admin` (`lib/role-home.ts:7`) and LoginPage/RegisterPage navigate
through it — a dynamic target the tool honestly reports as UNRESOLVED
rather than an edge. But that is the *only* entry: no BottomNav tab, no
ProfilePage entry, no static link outside the island. An admin who
navigates away (e.g. to `/profile` via the bottom nav) has no in-app way
back except re-login or typing the URL. Within the island the wiring is
healthy (all 11 admin pages call live endpoints).
→ *Recommendation: founder decision — accept login-redirect + URL as the
admin convention (allowlisted here) or add a persistent admin entry
point for the ADMIN role.*

### 1.6 Mobile-money payment initiation has no client caller

`POST /api/payments/initiate` (the non-card path) has zero callers; the
client only uses `POST /api/payments/initiate-card` (`services/payment.ts:92`).
Hand-grep confirmed (spot-check 2).
→ *Recommendation: founder decision — if MoMo initiation is meant to be
client-triggered it needs wiring; if it is IVR/USSD/server-driven,
document and keep allowlisted.*

---

## 2 · Server endpoints — classification by family

Evidence for "0 callers" claims: `pnpm wiring:map` full-sweep of
`client/src` (all 4 call forms: `apiFetch` literal/template, raw `fetch`,
bare `/api/...` string literals), plus the named hand-grep spot-checks in
§6. Full per-endpoint caller lists: `wiring-map.md`.

### 2.1 wired (89)

All endpoints marked `called` in `wiring-map.md` with at least one caller
in live (imported) code. This includes, settling the §0.2 leads:

- **`GET /api/driver/stats` — WIRED.** Called from
  `components/driver/DriverStatsCard.tsx:96`, rendered by the (reachable)
  driver `DashboardPage` and `DriverEarningsCard`. The reviewer's
  hooks/lib-only scan missed it because the call sits in a component.
- **`GET /api/sim/inbox` — WIRED.** `SimulationBanner.tsx:33` (rendered
  globally in `App.tsx`) links the admin HTML inbox view.
- **`GET /api/map/kigali.pmtiles` — WIRED** in code
  (`services/map-cache.ts`, via the `MAP_PATH` constant); dormant at
  runtime until the pmtiles file is provisioned (§4 dormant list).

Note: 35 of the 89 are called *only from screens that are themselves
unreachable* (the admin island and the in-ride flow, §3) — the
endpoint↔call wiring is present, the screen↔nav link is the broken layer.

### 2.2 server-orphan — wire it or delete it (13, founder decisions)

| Endpoint | Evidence | Recommendation |
| --- | --- | --- |
| `GET /api/bids/my-history` (bid-history.routes.ts:36) | 0 callers; hand-grep `my-history` in client = 0 hits (spot-check 1) | **§0.2 lead settled: server-orphan.** Wire into a driver bid-history screen, or delete route |
| `POST /api/journeys/:id/confirm` | only caller is dead `useJourney.ts:265` | see finding 1.3 — wire or delete with the flow decision |
| `POST /api/journeys/:id/customer-complete` | 0 callers | see finding 1.3 |
| `POST /api/payments/initiate` | 0 callers; client uses initiate-card only (spot-check 2) | see finding 1.6 |
| `PUT /api/users/me/online-status` | 0 callers; hand-grep = 0 (spot-check 4) | wire a driver online toggle, or delete |
| ~~`DELETE /api/users/me`~~ | **WIRED** (AR-SURFACE) | Settings → Account → Delete My Account → `/settings/delete-account`, two steps and a press-and-hold confirm. No longer a finding |
| ~~`GET /api/users/me/data-export`~~ | **WIRED** (AR-SURFACE) | Settings → Account → Export My Data; Blob download on web, share-sheet or clipboard on native. No longer a finding |
| `GET /api/users/:id/profile` | 0 callers | public profile view unwired — wire or delete |
| `DELETE /api/journeys/:id/bids/:bidId` | 0 callers | bid withdrawal unwired (the dead `useBids` used a different, nonexistent path) — wire or delete |
| `POST /api/journeys/:id/cancel-scheduled` | 0 callers; ScheduledRidePage uses generic `/cancel` | wire (scheduled-specific cancel semantics) or delete |
| `POST /api/journeys/:id/reconcile` | 0 callers | likely ops/job surface — confirm intended consumer, then allowlist or delete |
| `GET /api/journeys/:id/reconciliation-status` | 0 callers | same as above |
| `POST /api/scheduled-rides/:id/conflict-acknowledge` | 0 callers | SCHED-UI conflict flow gap — wire or delete |
| `GET /api/drivers/me/screener` | 0 callers (`POST` is wired) | resume-screener-state unused — wire or delete |
| `GET /api/admin/payouts/batches/:id` | 0 callers (batch *list* is wired) | wire a batch-detail view or delete |

### 2.3 dormant-by-decision (20)

| Family | Endpoints | Provenance |
| --- | --- | --- |
| Cooperative leader | 11 (`/api/cooperative/**`) | §0.5 of the dispatch: Jean's view-only dashboard is decided but not yet built — the frontend gap is *expected*. Hand-grep `api/cooperative` in client = 0 hits (spot-check 3) |
| Driver auto-bid rules | 6 (`/api/driver/auto-bid-rules/**`) | `useSocket.ts` SOCKET-FIX G5 comment: "The auto-bid management UI is a separate future dispatch". Rules fire server-side today (`AUTO_BID_FIRED` is handled) |
| Customer modes | 3 (`POST /api/journeys/:id/suggest-up`, `GET .../supply`, `GET .../customer-mode-status`) | `socket-wiring-audit.md` (2026): "forward wiring for unbuilt UI … and stay" |

### 2.4 intentionally-headless (32)

| Family | Endpoints | Reason (one line each) |
| --- | --- | --- |
| Payment webhook | `POST /api/webhooks/flutterwave` | called by the payment gateway, not the client |
| SMS inbound webhook | `POST /api/sms/inbound` | called by the SMS provider |
| OpenAPI | `GET /api/docs.json` | public API contract by design (index.ts comment); Swagger UI mounts at `/api/docs` |
| Simulated-SMS inbox | `GET /api/sim/messages` | **§0.2 lead settled: intentionally headless.** Documented curl surface (`pre-prototype-runbook.md:114`); the HTML view `/api/sim/inbox` is the wired counterpart |
| AML review | 6 (`/api/admin/aml-flags/**`) | runbook-driven curl surface (`aml-review-runbook.md`, e.g. line 216 documents `GET .../precision` by curl); no admin UI exists or is promised |
| BNR compliance | 5 (`/api/admin/bnr-reports/**`) + `GET /api/admin/reports/monthly` | regulator reporting generated by the monthly job; downloads fetched by ops (API.md) |
| Freeze inspection | 3 (`GET /api/admin/freeze`, `/:userId`, `/:userId/audit`) | runbook/ops reads (`aml-review-runbook.md`); the freeze/unfreeze *actions* are wired in AdminPayoutDriver |
| Admin SMS-inbound review | 5 (`/api/admin/sms-inbound/**`) | ops review surface for the SMS webhook; no UI built or promised |
| Mobility aggregates | 5 (`/api/admin/mobility/**`) | job-driven aggregation (`data-retention.md`); admin endpoints are ops reads |
| Push test | `POST /api/admin/push/test` | ops smoke-test endpoint |
| Escrow audit | `GET /api/admin/escrow/:id/verify` | audit-chain verification for ops (API.md) |
| Pickup-verification summary | `GET /api/admin/pickup-verifications/summary` | V-4 pilot-trigger evidence read (`pilot-triggers.md`) |

*Honesty note:* for the ops families above, "intentionally-headless" is
grounded in runbooks/docs where cited; where only the API.md entry exists
(escrow verify, reports/monthly) the verdict is **ops-consumed by
convention, confidence medium** — the allowlist reasons say so, and
deleting any of them remains a founder decision this report does not make.

---

## 3 · Client screens — classification

### 3.1 wired-and-reachable (26)

`*` (NotFound, reachable by definition), `/`, `/check-driver`, `/consent`,
`/customer/priority`, `/customer/urgent`, `/driver`, `/driver/account`,
`/driver/scheduled`, `/driver/screener`, `/driver/verification`, `/guide`,
`/journey/:id/bids`, `/journey/:id/chat`, `/journey/:id/matched`,
`/journey/:id/receipt`, `/journey/:id/scheduled`, `/journey/goods`,
`/journey/new`, `/login`, `/payments`, `/profile`, `/register`, `/rides`,
`/settings`, `/welcome` — each with at least one navigation path from a
boot seed (see `wiring-map.md` "All routes" for the exact inbound edges).

### 3.2 screen-unreachable (18)

| Route | Screen | Evidence / nuance | Recommendation |
| --- | --- | --- | --- |
| `/driver/bid/:id` | BidPage | only intended entry is the **broken** target in DashboardPage:474 (finding 1.1) | fix the nav target (follow-up, highest priority) |
| `/driver/approach/:id` | ApproachPage | no entry of any kind found | wire (post-accept navigation) |
| `/driver/ride/:id` | ActiveRidePage | no entry of any kind found | wire (approach → ride transition) |
| `/driver/goods/:id` | GoodsPickupPage | no entry of any kind found | wire |
| `/driver/no-show-disputes` | NoShowDisputesPage | no entry of any kind found | wire (e.g. from driver account) |
| `/journey/:id/progress` | InProgressPage | **push deep-link only** (usePushNotifications.ts:96) — no in-app path | wire (active-ride resume) |
| `/journey/:id/confirm` | ConfirmPage | no entry of any kind found (finding 1.3) | wire with the completion-flow decision |
| `/admin` + 10 sub-screens | Admin island | entered only via the dynamic login redirect (`roleHomePath` → `/admin`), which the tool reports as UNRESOLVED; no static entry exists (finding 1.5) | founder decision: login-redirect convention (allowlisted) or add a persistent entry |

`MatchedPage`'s redispatch handler also navigates to `/journey/:id/waiting`
(MatchedPage.tsx:230) — **a route that does not exist**; after a
redispatch the customer lands on the 404 screen. (Second broken nav wire,
alongside 1.1.)

---

## 4 · Dormant-by-decision (dispatch §0.5 — not news)

- **Offline maps** — `GET /api/map/kigali.pmtiles` is wired
  (`services/map-cache.ts`); the server answers `MAP_NOT_AVAILABLE` until
  ops provisions `MAP_PMTILES_PATH` (designed; index.ts MAP-CACHE G1
  comment). Dormant at runtime, not in code.
- **Child-passenger flow** — removed from pilot booking by team decision;
  the orphaned client component `ChildPassengerInfoCard.tsx` shows up in
  the dead-file sweep (§5) as expected.
- **Cooperative-leader backend** — see §2.3; frontend gap is expected
  (Jean's view-only dashboard decided, not built).

## 5 · Dead client files (import-closure sweep, informational)

Nothing imports these from the bundler entry (`main.tsx`); test imports
excluded. This is the LocationPicker/DriverCard failure class, found
mechanically now:

`components/journey/BidCard.tsx`¹, `ChildPassengerInfoCard.tsx` (§4),
`DriverCard.tsx` (**deleted in this PR — G3**), `JourneyProgress.tsx`,
`MiniMap.tsx`⁴, `PriceInput.tsx`, `VehicleSelector.tsx`⁴,
`components/rating/VerificationBadges.tsx`², `hooks/useBids.ts`³,
`hooks/useEmergency.ts`, `hooks/useGPS.ts`, `hooks/useJourney.ts`³,
`sw-register.ts`.

¹ despite `JacketNumber.test.tsx`'s comment calling it "the live BidCard".
² imported only by the two dead card components.
³ `useBids.ts` additionally calls five endpoints that don't exist
(`POST /api/bids`, `GET /api/bids/mine`, `POST /api/bids/:id/accept|withdraw|decline`).
⁴ **deleted since — see the addendum below.**

> **Addendum, 24 August 2026 (MAP-REACH G6c).** Two entries on this list
> no longer name a file that exists, and citing them as present-tense
> dead code has become the wrong kind of wrong — a reader checking the
> report against the tree finds nothing there and cannot tell whether the
> file moved, was renamed, or was cleaned up.
>
> * **`VehicleSelector.tsx` — DELETED.** Recommendation 4 (dead-file
>   cleanup) was executed for it. `a59901a` (FIELD-FIT, #159) first
>   extracted its glyphs into `components/journey/vehicle-icons.tsx`
>   precisely because it was imported by nothing, and DEADWOOD G2 then
>   removed the file. The only mentions left in the tree are comments in
>   `vehicle-icons.tsx` and an assertion in `vehicle-icons.test.tsx` that
>   pins its lightning-bolt glyph OUT of the rest of the codebase. See
>   also `docs/deadwood-audit.md`, which classified it LEGACY — "no
>   importer, ever".
> * **`MiniMap.tsx` — DELETED.** Also gone from
>   `components/journey/`. Its map-surface role was absorbed when
>   MAP-TRUTH G2 gave every surface the shared `BaseTileLayer`; the §2a
>   container table above still cites `MiniMap.tsx:84`, which is likewise
>   a historical reference now.
>
> The list itself is left standing rather than rewritten. It is a dated
> finding and it was true when it was written; this note records what has
> happened to it since, which is the same convention Recommendation 3
> above already follows.

**Per §3 invariants, none of these are deleted here except DriverCard
(pre-verified in the dispatch). The rest are founder decisions this list
enables.**

## 6 · Manual spot-checks (§6 requirement — 5 performed)

1. **`GET /api/bids/my-history`** — `grep -rn "my-history" client/src` →
   0 non-test hits. Tool verdict (orphan) confirmed.
2. **`POST /api/payments/initiate`** — `grep -rn "payments/initiate"` →
   only `initiate-card` (services/payment.ts:92). Confirmed.
3. **`/api/cooperative/*`** — `grep -rn "api/cooperative" client/src` →
   0 non-test hits. Confirmed.
4. **`PUT /api/users/me/online-status`** — `grep -rn "online-status"` →
   0 non-test hits. Confirmed.
5. **`DriverCard.tsx`** — `grep -rn "DriverCard" client/src` → only the
   file itself, two shared test files, and one comment in
   `i18n-used-keys.test.ts`. Zero production importers. Confirmed
   (matches #142's report and the dispatch's §0.3 pre-verification —
   with one correction: the file lives at `components/journey/`, not
   `components/driver/` as the dispatch stated).

## 7 · What the tool cannot see (blind spots, stated on the record)

1. **Dynamically-built paths** land in UNRESOLVED buckets (8 at HEAD:
   3 calls, 5 nav) — never guessed. E.g. `navigate(roleHomePath(...))`
   resolves at runtime to `/`, `/driver`, or `/admin` (verified by
   reading `role-home.ts`); the admin-island verdict in 1.5 already
   accounts for it.
2. **Push deep links** are data-driven; the tool does not model them as
   navigation edges. They are accounted for manually (finding 1.2).
3. **Method inference**: an `apiFetch` with a non-literal init object gets
   method `null` (matches any); `method:` inside a `JSON.stringify` body
   could theoretically confuse it (none observed at HEAD).
4. **Glued dynamic suffixes** (`` `/api/x${query}` ``) are assumed to be
   query builders and stripped; a suffix that is really a path segment
   would over-match.
5. **Reachability is static**: a nav edge inside dead-branch JSX still
   counts; conversely, server-driven redirects aren't seen.
6. **Calls from live-but-unreachable screens count as "called"** (§2.1
   note) — the screen layer carries that flag instead.
7. **`sw-register.ts`** may be a Vite-injected special (it appears dead to
   the import graph; vite-plugin-pwa normally injects its own register).
8. **Express `router.use('<path>', subrouter)` nesting** is not walked —
   it is surfaced as UNRESOLVED instead (0 at HEAD).

## 8 · Recommended follow-up dispatches (in value order)

1. **Fix the two broken nav targets** (DashboardPage:474 → `/driver/bid/:id`;
   MatchedPage:230 → an existing route) + the `GET /api/bids/mine` refetch
   (1.4). Small, surgical, high value.
2. **Active-ride resume navigation** — give the in-ride flow (customer and
   driver) an in-app entry (1.2).
3. **Completion-flow decision** — wire `confirm`/`customer-complete` or
   bless auto-confirm and delete the dead client path (1.3).
   > **Addendum, 19 August 2026 (GROUNDSKEEPER G6).** Half of this executed.
   > `POST /api/journeys/:id/confirm` was wired in #177 and is now called
   > from `InProgressPage` — the passenger's explicit "I am here", releasing
   > escrow without waiting for auto-confirm. `customer-complete` was not
   > touched and remains a server orphan awaiting the same decision; its
   > wiring-audit allowlist entry now says so. This line is left standing
   > rather than rewritten: the report is a dated finding, and what it found
   > was true when it was written.
4. **Dead-file cleanup** — founder sign-off on the §5 list.
5. **Admin entry point** for the ADMIN role, if URL-entry isn't the
   intended convention (1.5).
