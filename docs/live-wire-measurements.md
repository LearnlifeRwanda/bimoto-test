# LIVE-WIRE G1 — measured, then reproduced

Baseline taken on `main` at `65d77f5` (post-#160 TEAM-SAID) against a
live local stack: Postgres 16 with every migration applied, the real
`@bimoto/server` process (`PAYMENTS_MODE=simulated`, `SMS_MODE=simulated`),
and two real Socket.io clients — one per role — driving the real HTTP
endpoints. The instrument is `scripts/livewire/measure.ts`; it is
re-runnable and is the same instrument used for the after-table.

Everything below is a number the harness printed or a state a read
established. Nothing here is inferred.

---

## 1. The table — before

`ITERATIONS=10` per transport. Latency is wall-clock from the acting
`POST` leaving the harness to the other side's socket delivering the
event that would move its screen.

| transport | bid POST → passenger `bid-placed` | accept POST → driver `bid-accepted` |
|---|---|---|
| websocket | **p50 15 ms · p95 26 ms** (10/10) | **no event, 10/10 attempts** (8 s timeout) |
| polling (forced fallback, no upgrade) | **p50 18 ms · p95 20 ms** (10/10) | **no event, 10/10 attempts** (8 s timeout) |

Two further counters from the same run, both transports, both 10/10:

| observation | result |
|---|---|
| socket `bid-placed` payload carries `driver { nickname, … }` | **0 / 10** |
| bidding driver's `join-journey` refused by the server | **10 / 10** |

### What the numbers say

**The transport is not the problem.** A bid reaches the passenger's
socket in 15–18 ms, and forcing the long-polling fallback changes
nothing measurable. Field phones that hold a socket at all are getting
the event essentially instantly. "Bids are too slow to appear" is
therefore *not* a networking story — and G2 must not be spent tuning a
transport that already answers in tens of milliseconds.

**The passenger's row arrives empty.** `POST /api/journeys/:id/bids`
emits the raw Prisma `Bid` row (`bid.routes.ts:75` emits exactly what
`bidService.createBid` returns — `id, journeyId, driverId, price,
etaMinutes, status, createdAt, updatedAt`). The passenger's list renders
the driver's name and rating from the *serialized* shape
(`bidService.getBidsForJourney` → `driver { nickname, avgRating, … }`),
which the socket payload does not carry. So the row appears in ~15 ms
with no name and no rating, and only becomes a real offer when the
10 s poll (`BidListPage.tsx:48`, `BID_POLL_INTERVAL_MS = 10_000`)
replaces it. **Effective passenger latency to a usable bid = the poll
interval: p50 ≈ 5 s, worst case 10 s.**

**The driver has no realtime path at all.** `bid-accepted` is emitted to
the room `journey:<id>` (`bid.routes.ts:147`). Membership of that room is
gated by `loadJourneyParties` (`socket/index.ts:21`), which authorises
only `journey.customerId` and `journey.driverId`. While a journey is
`REQUESTED` its `driverId` is `null`, so **a bidding driver's join is
refused** — measured 10/10. There is no `user:<driverId>` emit for bid
outcomes either. The driver's only route to "your bid was accepted" is
`ActiveJourneyBanner`, whose restore effect is `[role]`-dependent and
therefore **runs once, on mount**: he must navigate away and back.
Latency: unbounded, human-triggered.

That asymmetry is the field report. Both halves of "too slow on both
sides" are real; neither is the transport.

---

## 2. Every polling interval in the loop — before

| interval | file:line | value | what it drives |
|---|---|---|---|
| `BID_POLL_INTERVAL_MS` | `packages/client/src/pages/customer/BidListPage.tsx:48` | 10 000 ms | passenger's bid-list refresh (the fallback that is in practice the *primary* path, per §1) |
| `LOCATION_UPDATE_INTERVAL` | `packages/client/src/pages/driver/DashboardPage.tsx:24` | 15 000 ms | one coupled tick: GPS fix → `PUT /users/me/location` → `GET /api/journeys?viewAs=driver` (the request feed) |
| `ETA_REFRESH_MS` | `packages/client/src/hooks/useDriverLocationStream.ts:149` | (unchanged, outside the bid loop) | passenger's ETA refresh on an active ride |
| `UrgentBadge` tick | `packages/client/src/components/journey/UrgentBadge.tsx:82` | 60 000 ms | countdown redraw only, no network |
| `ConnectionBanner` countdown | `packages/client/src/components/layout/ConnectionBanner.tsx:55` | 500 ms | redraw only, no network |

The driver's request feed has no dedicated interval: it rides the 15 s
location tick. A driver who is online but stationary refreshes his feed
every 15 s.

The driver feed *does* already have a socket push path —
`supply-broadcast.ts:133` and `urgent-broadcast.ts:113` emit
`journey:available` into `user:<driverId>`, which `registerSocketHandlers`
joins at connect time (`socket/index.ts:44`), and `DashboardPage`
consumes as `availableSignal` (`DashboardPage.tsx:353`). **No new
architecture is needed for the driver feed** — the ring machinery already
emits. The gap is bid *outcomes*, not request *discovery*.

---

## 3. §0.4 doors — reproduced, with verdicts

| # | field report | verdict | evidence |
|---|---|---|---|
| 15 | "an approved offer reappears in available requests" | **by design, badly worded** | `escrow.service.ts:243` `releaseMatchTx` sets the journey back to `REQUESTED`, clears `driverId`/`agreedPrice`, and re-opens every bid it had closed. Driven by `unpaid-match-reaper.job.ts:59`. The mechanics are #155/#156's deliberate unpaid-release. Nothing on screen says so. → G5 fixes the wording, not the mechanics. |
| 16 | "passenger cannot see the offer the driver approved" | **real, and it is the driver-side gap seen from the other end** | `useSocket.ts` registers handlers for `bid-placed`, `new-message`, `journey:available`, `journey:wish-price-updated`, `auto-bid:fired`, `account:frozen`, `emergency:alert` — and **no handler for `bid-accepted` or `bid-withdrawn` on either side**. The server emits `bid-accepted`; nobody listens. → G2. |
| 21/22 | active-ride map/route "not working" | **could not reproduce as stated** | `driver/ActiveRidePage.tsx` renders no map component at all — it is a phase/earnings screen (`commissionBreakdown`, timer, complete-stop actions). The route-with-alternatives surfaces the email confirmed working are `useRouteAlternatives` / `DriverApproachMap`, mounted on the *approach* page. There is no broken map here to fix; there is a missing one, which is a design ask, not a defect. Reported, not fixed. |
| 31 | leaving the waiting-for-driver page strands the passenger | **confirmed** | `CustomerHomePage.tsx` navigates only to `/journey/new` and `/journey/goods`. `HistoryPage.tsx` links out only for `status === 'COMPLETED'` (→ receipt, line 252). `ActiveJourneyBanner`'s `ACTIVE_STATUSES` do not include `REQUESTED`. **No surface anywhere routes back to `/journey/:id/bids`.** → G5. |
| 4 | registration back button | **confirmed absent** | `BackControl` (#150) is mounted by `AppHeader`, which is mounted by `AppShell`. In `App.tsx`, `/register` (line 245) — like `/login`, `/consent`, `/welcome` — is **not** wrapped in `<AppShell>`, so it carries no header and no back control. → G5. |
| 27 | scheduled page says "no internet" while online | **not reproducible as a page-local bug** | Neither `customer/ScheduledRidePage.tsx` nor `driver/ScheduledRidesPage.tsx` contains any connectivity presenter, string, or `navigator.onLine` read. The only connectivity copy in the app is the shell-level `ConnectionBanner`, which reads the single converged source (`useConnectionState` → `sync/connectivity.ts`) that #154 established. Any "no internet" seen on that page came from the shell banner, i.e. from the converged state, not from a second opinion. Nothing page-local to fix. Reported, not fixed. |
| 403 | passenger PUTs `/api/users/me/location` and is refused | **guard is correct; the client should not ask** | `user.routes.ts:709` is `authMiddleware, driverOnly`; `driverOnly` (`middleware/auth.ts:136`) admits `DRIVER` and `BOTH`, refuses `CUSTOMER`. The only caller is `DashboardPage.tsx:96`. `App.tsx:275` mounts `/driver` behind `ProtectedRoute` with **no role gate**, so a `CUSTOMER` can render the driver dashboard, tap "Go online", and earn the 403. → G5 stops the client from asking. |

---

## 4. §0.3 — the profile that would not die

Reproduced by reading every persistence site. The walk (login as A →
populate → logout → login as B) survives because `logout()`
(`stores/auth.store.ts:88`) clears **only** `user`, `isAuthenticated`
and `token`. Nothing else in the client is cleared or keyed by user.

Full enumeration:

| store / cache | persisted? | holds user data? | state before this dispatch |
|---|---|---|---|
| `stores/auth.store.ts` | no (memory) | yes | cleared on logout |
| `stores/journey.store.ts` | no (memory) | yes — `activeJourney`, `nearbyRequests`, `availableSignal` | **survives logout** |
| `stores/bid.store.ts` | no (memory) | yes — `bids`, `myBids` | **survives logout** |
| `stores/chat.store.ts` | no (memory) | yes — messages | **survives logout** |
| `stores/emergency-alert.store.ts` | no (memory) | yes | **survives logout** |
| `stores/simulation.store.ts` | no (memory) | yes | **survives logout** |
| `stores/ui.store.ts` | no (memory) | partly — `accountFrozen` | **survives logout** |
| `stores/diagnostics.store.ts` | no (memory) | yes — last location sent, feed hops | **survives logout** |
| Dexie `journeys` / `bids` / `messages` / `gpsBuffer` | **yes, IndexedDB** | yes | **survives logout AND app restart, not keyed by user** |
| Dexie `syncEvents` (offline outbox) | yes | yes | survives — replay semantics, see below |
| Dexie `syncMeta` | yes | yes | survives |
| Dexie `mapCache` / `mapDownloads` | yes | **no** — device-level map tiles | legitimately survives |
| `services/error-ledger.ts` (localStorage) | yes | diagnostic only, user-sent by hand | legitimately survives |
| `prefs` `bimoto-lang` | yes | device preference | legitimately survives |
| `prefs` `hasSeenWelcome` | yes | device-level | legitimately survives |
| `prefs` `registrationPending` | yes | **already keyed by user id** (`auth.store.ts:44`) | correct as-is |
| `PickupVerifyCard` localStorage key | yes | keyed by `journeyId` | no cross-user collision |

Because the memory stores are not persisted, a *reload* hides the bug —
which is exactly why it reached the field as "sometimes". A logout →
login inside the same SPA session keeps every one of them. The Dexie
tables keep theirs across restarts too.

**The offline outbox is the one thing that must not be cleared blindly.**
`syncEvents` is a replay queue: a journey created offline by user A and
not yet synced would be destroyed by a naive wipe. G5 treats it as a
deliberate survivor and says so in code.

---

## 5. §0.5 — the parcel speed surface

Verified on `GoodsRequestPage.tsx`. There are **two adjacent
radiogroups**, and the field read them as one list of three:

1. `data-testid="goods-tier-group"` (line ~320) — **Normal / Priority /
   Urgent**. This is a *routing* control, pre-dating #160: Priority and
   Urgent navigate to `/customer/priority` and `/customer/urgent`.
2. `data-testid="delivery-speed-section"` (line ~597) — **Standard /
   Express**, `SPEED_OPTIONS` (line 46), exactly the two `DeliverySpeed`
   values #160 shipped.

So #160 **joined rather than replaced**: the speed picker itself is
correctly two options, but a second speed-sounding picker sits three
inches above it. "Normal, Standard, Express" is the two groups read
top-to-bottom. G5 keeps both controls (the tier group is the only way
into the urgent flows — removing it would be a mechanics change) and
disambiguates them in copy, and adds Jean's optional 1/2/3-hour
selector under Standard.

---

## 6. Disagreements with the dispatch brief

Code wins; these are recorded rather than silently worked around.

1. **`BidCard.tsx` is not a live passenger surface.** §0.2 names it as
   the leak. It is imported by exactly two unit tests
   (`JacketNumber.test.tsx`, `VehicleUpdatedChip.test.tsx`) and by no
   page. `BidListPage` renders its own inline card. The real
   passenger-facing leak of the driver's net is
   `BidListPage.tsx:962` (accept-confirmation modal),
   `ConfirmPage.tsx:293`, `MatchedPage.tsx:378` and
   `HistoryPage.tsx:244` — all rendering `transparency.driverReceives`
   from a server-supplied `commissionBreakdown.driverPayout`. G4 strips
   the payload, which kills all four, and cleans `BidCard` too.
2. **`useDriverPayout.ts` is not the breakdown source.** §0.7 lists it
   for G4. It is the payout-*preference* hook (`/api/payout/summary`,
   end-shift, OTP). The driver's payout *range* is computed locally in
   `driver/BidPage.tsx` (`payoutRange`, line ~78) from
   `CUSTOMER_TIERS` min/max — which is precisely why he sees a range and
   not his exact net: the client does not know the customer's tier.
3. **The driver feed already has a push path** (§2 G2's conditional).
   `journey:available` → `user:<driverId>` → `availableSignal` →
   refetch. No STOP seam; nothing to build.
4. **`bid-accepted` has no listener anywhere**, on either side. §0.1
   treats the emit as sufficient. It is not.

---

# G6 — the same table, after

Same stack, same instrument (`scripts/livewire/measure.ts`), 12 iterations
per transport, server on `01f3ef0`.

| transport | bid POST → passenger `bid-placed` | accept POST → driver `bid-accepted` |
|---|---|---|
| websocket | p50 **25 ms** · p95 **37 ms** (12/12) | p50 **31 ms** · p95 **65 ms** (12/12) |
| polling (forced fallback) | p50 **23 ms** · p95 **29 ms** (12/12) | p50 **30 ms** · p95 **37 ms** (12/12) |

| observation | before | after |
|---|---|---|
| socket `bid-placed` payload carries `driver {}` | 0 / 10 | **12 / 12** |
| driver receives `bid-accepted` | **never** | **12 / 12**, both transports |
| bidding driver's journey-room join | refused 10/10 | refused 12/12 — *unchanged and correct* |

The refusal count is deliberately still 10/10 → 12/12. Nothing here
widened journey-room membership: a driver who has merely bid is not a
party to the journey, and making him one would be a permissions change,
not a latency fix. He is reached on the per-user room he already holds.

### Honest reading of the numbers

**Target ≤2 s with a healthy socket: met, with room.** Both sides are
under 70 ms at p95.

**The bid-placed p50 rose from 15 ms to 25 ms, and that is the point.**
The old 15 ms delivered a row with no name and no rating; the passenger's
real wait for a usable offer was the poll interval — p50 ≈ 5 s, worst
case 10 s. The extra ~10 ms buys the serialization that makes the row an
offer. The honest comparison is **~5 s → 25 ms**, not 15 ms → 25 ms.

*One caveat, recorded rather than smoothed over:* the first run after the
G2 change measured p50 288 ms / p95 815 ms for bid-placed and p50 875 ms /
p95 2245 ms for accept. That run was cold (fresh process, unwarmed query
plans) **and** predated moving the driver announcement ahead of the
payment-gateway leg. Both later runs, warm, agree within noise. The
numbers above are the warm, post-move state; the cold-start figures are
what a freshly restarted server's first few requests look like.

**What the fallback achieves.** Adaptive polling is the number that
matters on a phone whose socket is gone, and it is unchanged in kind —
still always running, never disabled:

| poll | before | after |
|---|---|---|
| passenger bid list | 10 s flat | **4 s** while the request is open for bids, 15 s otherwise |
| driver request feed | 15 s, coupled to the GPS-write tick | **5 s**, its own clock, while online and free |
| driver location write | 15 s | 15 s — unchanged; it costs a GPS fix, and the cascade's freshness window is far wider |

So a socket-less passenger's worst case falls 10 s → 4 s, and a
socket-less motari's 15 s → 5 s. Neither is 25 ms, and neither is
claimed to be.

---

# G6 — the role-scoped payload, printed

`scripts/livewire/payload-diff.ts` fetches the same bid on the same
journey through the same endpoint as each role. Live output, server
`01f3ef0`, a 1,200 RWF bid from a PRO driver to a SUPER customer:

```
--- keys present for the DRIVER and withheld from the CUSTOMER ---
[ 'commissionBreakdown' ]
--- keys present for the CUSTOMER and withheld from the DRIVER ---
[]

commission fields reachable in the CUSTOMER response: []
```

The customer's row carries `price: 1200`, the driver's nickname, rating,
vehicle and verification badges — everything the decision needs — and no
commission key at all. The driver's row additionally carries
`driverPayout: 1140` against `bidPrice: 1200`: the team's item 18, in the
exact words they asked for ("you are bidding 1,200; you will receive
1,140"), on the screen of the person whose money it is.

---

# G6 — the profile-switch walk

Reproduced as a test (`client/src/__tests__/live-wire-session-reset.test.ts`),
walking the field's own sequence:

1. user A signs in → journey, bids, chat, alerts, frozen flag and
   diagnostics populate;
2. A signs out;
3. user B signs in on the same device.

After step 3, every one of those is empty and the Dexie read caches
(`journeys`, `bids`, `messages`, `syncMeta`) have been cleared. The
no-logout variant — B signs in straight over A — is asserted separately,
because a field phone does not always take the tidy path. Re-setting the
SAME user (token refresh, profile edit, session restore) is asserted to
keep a live ride, because wiping it there would be its own defect.

Deliberate survivors are asserted as survivors, so a future change that
starts clearing the offline outbox — or stops clearing the bid cache —
fails here rather than in Kigali.
