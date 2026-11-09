# Socket Wiring Audit — SOCKET-HYGIENE G1 (2026-07-27)

> **READ THIS FIRST — the counts below are a 2026-07-27 SNAPSHOT, not a
> live index.** They were true at `f7e604a` and are not true now: the
> constant count, the LIVE list and the EMIT-ONLY list have all moved
> since (LIVE-WIRE, SOS-FOLLOW, TEAM-ANSWERS, and NOTIFY G3, which added
> six per-user notification events and their listeners).
>
> **The living matrix is a TEST, not this file:**
> `packages/shared/src/__tests__/socket-event-contract.test.ts`. It
> resolves every emit and every listener on both sides of the wire on
> each CI run, and fails on a client listener with no server emit, a
> client→server emit with no handler, or an emit-only event missing
> from (or stale in) its intentional-orphan registry. That registry is
> the current EMIT-ONLY list, maintained by the guard rather than by
> hand.
>
> What this document is still good for is the METHOD and the
> ARCHAEOLOGY: how the inventory was taken, and why each dead wire was
> dead. Verify any COUNT in it against the test before citing it.
>
> **One name in the lists below no longer exists at all.**
> `JOURNEY_CUSTOMER_COMPLETED` was retired with the endpoint that emitted
> it (founder decision D10, EXPORT-AND-LEDGER G3). It still appears in the
> EMIT-ONLY count row below, which is a 2026-07-27 fact and stays one; its
> own row in the emit-site table is struck and says what happened.

Authoritative emit↔listen reconciliation of the socket layer, rebuilt from
live `main` (`f7e604a`, post-#129). Supersedes the #122 SOCKET-FIX dead-list,
which predates #124 (SOS-WIRE) and #126 (NET-UX).

Method: every server emit site was inventoried through BOTH raw `.emit()`
calls AND the helper wrappers (`emitToJourney`, `emitToAdmins` — both defined
in `packages/server/src/socket/index.ts`), plus the raw room emitters
`io.to('user:…').emit`, `io.to('journey:…').emit`, `socket.to(room).emit`,
and `socket.emit`. Client listeners and emits were inventoried across all
three socket connectors (`useSocket.ts`, `useDriverLocationBroadcast.ts`,
`useDriverLocationStream.ts` — the only files importing `socket.io-client`).
Server client→server handlers live solely in `packages/server/src/socket/index.ts`.
Test files are excluded throughout.

## Verdict summary (39 constants)

| Class | Count | Constants |
|---|---|---|
| LIVE (client→server, handled) | 3 | JOIN_JOURNEY, LEAVE_JOURNEY, UPDATE_LOCATION |
| LIVE (server→client, listened) | 7 | JOURNEY_AVAILABLE, JOURNEY_WISH_PRICE_UPDATED, ACCOUNT_FROZEN, AUTO_BID_FIRED, DRIVER_LOCATION, EMERGENCY_ALERT, NEW_MESSAGE |
| EMIT-ONLY (forward wiring — keep) | 23 | ERROR, SUGGEST_UP_AVAILABLE, JOURNEY_CREATED, JOURNEY_STARTED, JOURNEY_ENDED, JOURNEY_CONFIRMED, JOURNEY_DISPUTED, JOURNEY_INTERRUPTED, JOURNEY_CANCELLED, JOURNEY_EXPIRED, JOURNEY_AUTO_CONFIRMED, JOURNEY_CUSTOMER_COMPLETED, JOURNEY_RECONCILED, JOURNEY_RECONCILIATION_REQUIRED, BID_ACCEPTED, BID_WITHDRAWN, BID_DECLINED, BID_EXPIRED, SCHEDULED_RIDE_REMINDER, SCHEDULED_RIDE_MATCHED, SCHEDULED_RIDE_EXPIRED, SCHEDULED_RIDE_CANCELLED, SCHEDULED_RIDE_BID_WINDOW_OPENED |
| NAME-SPLIT PAIR (unify in G3) | 2 | BID_PLACED (`bid:placed`, client listens) ↔ JOURNEY_ROOM_BID_PLACED (`bid-placed`, server emits) |
| LISTEN-ONLY (dead — remove in G2) | 2 | JOURNEY_UPDATED, BID_UPDATED |
| CLIENT-EMIT-NO-HANDLER (dead — remove in G2) | 2 | MESSAGE_SEND, DRIVER_LOCATION_CLIENT |

3 + 7 + 23 + 2 + 2 + 2 = 39. ✓

## Corrections to prior beliefs

- **NEW_MESSAGE is LIVE, not emit-only.** The constants-file section header
  ("emitToJourney — no client listeners") is stale: `useSocket.ts:143`
  listens for `new-message` and the server emits it from
  `message.routes.ts:85` (`emitToJourney`). The raw-grep undercount the
  dispatch warned about is real — 26 of the 33 server emit sites go through
  `emitToJourney`/`emitToAdmins`, not raw `.emit()`.
- **`driver:location` ↔ `driver-location` is NOT a live name-split pair.**
  The entire `driver:location` client twin is dead on both sides (details
  below), so it is a G2 removal, not a G3 unification.
- **`emergency:alert` ↔ `emergency-alert`** was already unified by #124
  (SOS-WIRE G1); EMERGENCY_ALERT (`emergency-alert`) is LIVE on the journey
  room and the `admins` room. Nothing to do.

## (a) Server emit inventory (complete, helpers resolved)

Via `emitToJourney(journeyId, EVENT, data)` → `io.to('journey:…').emit`:

| Constant | Emit site(s) |
|---|---|
| JOURNEY_ROOM_BID_PLACED | `routes/bid.routes.ts:75` |
| BID_ACCEPTED | `routes/bid.routes.ts:147`, `routes/scheduled-ride.routes.ts:150` |
| BID_WITHDRAWN | `routes/bid.routes.ts:253` |
| BID_DECLINED | `jobs/journey-expiry.job.ts:66` |
| BID_EXPIRED | `jobs/bid-expiry.job.ts:25` |
| JOURNEY_CREATED | `routes/journey.routes.ts:98`, `routes/journey.routes.ts:1139` |
| JOURNEY_STARTED | `routes/journey.routes.ts:719` |
| JOURNEY_ENDED | `routes/journey.routes.ts:756` |
| JOURNEY_CONFIRMED | `routes/journey.routes.ts:782` |
| JOURNEY_DISPUTED | `routes/journey.routes.ts:817` |
| JOURNEY_INTERRUPTED | `routes/journey.routes.ts:855`, `services/journey.service.ts:1463` |
| JOURNEY_CANCELLED | `routes/journey.routes.ts:1102`, `jobs/no-show-timeout.job.ts:217` |
| JOURNEY_EXPIRED | `jobs/journey-expiry.job.ts:77`, `jobs/journey-expiry.job.ts:119` |
| JOURNEY_AUTO_CONFIRMED | `jobs/auto-confirm.job.ts:145` |
| ~~JOURNEY_CUSTOMER_COMPLETED~~ | **RETIRED** — EXPORT-AND-LEDGER G3 (founder decision D10) deleted `customerCompleteJourney`, which held this event's only emit site (by then `services/journey.service.ts:2132`). The constant and its intentional-orphan registry entry went with it. Row kept, struck, because this file is the archaeology. |
| JOURNEY_RECONCILED | `services/journey.service.ts:1418` |
| JOURNEY_RECONCILIATION_REQUIRED | `services/journey-resilience/reconciliation.ts:123` |
| EMERGENCY_ALERT | `routes/journey.routes.ts:984` |
| NEW_MESSAGE | `routes/message.routes.ts:85` |
| SCHEDULED_RIDE_REMINDER | `jobs/scheduled-ride-reminder.job.ts:82` |
| SCHEDULED_RIDE_MATCHED | `jobs/auto-fallback-pick.job.ts:31` |
| SCHEDULED_RIDE_EXPIRED | `jobs/auto-fallback-pick.job.ts:48` |
| SCHEDULED_RIDE_CANCELLED | `routes/journey.routes.ts:1212` |
| SCHEDULED_RIDE_BID_WINDOW_OPENED | `jobs/bid-window-opener.job.ts:31` |

Via `emitToAdmins(EVENT, data)` → `io.to('admins').emit`:

| Constant | Emit site |
|---|---|
| EMERGENCY_ALERT | `routes/journey.routes.ts:999` |

Via raw emits:

| Constant | Emit site | Mechanism |
|---|---|---|
| ERROR | `socket/index.ts:59`, `socket/index.ts:87` | `socket.emit` (unauthorised-journey) |
| DRIVER_LOCATION | `socket/index.ts:108` | `socket.to(room).emit` (journey room) |
| JOURNEY_AVAILABLE | `services/discovery/supply-broadcast.ts:133`, `services/discovery/urgent-broadcast.ts:113` | `io.to('user:…').emit` |
| AUTO_BID_FIRED | `services/auto-bid/evaluator.ts:308` | `io.to('user:…').emit` |
| SUGGEST_UP_AVAILABLE | `services/customer-modes/suggest-up-scheduler.ts:65` | `io.to('user:…').emit` |
| JOURNEY_WISH_PRICE_UPDATED | `services/customer-modes/suggest-up.ts:123` | `io.to('journey:…').emit` |
| ACCOUNT_FROZEN | `services/admin/socket-disconnect.helper.ts:26` | `socket.emit` (then force-disconnect) |

Constants with NO server emit site anywhere (helpers included):
`JOURNEY_UPDATED`, `BID_PLACED` (`bid:placed`), `BID_UPDATED`,
`DRIVER_LOCATION_CLIENT` (`driver:location`), and the three client→server
names (`JOIN_JOURNEY`, `LEAVE_JOURNEY`, `UPDATE_LOCATION`, `MESSAGE_SEND` —
inbound, not expected to be server-emitted).

## (b) Client listener inventory (complete)

| Constant | Listener site | Verdict |
|---|---|---|
| JOURNEY_UPDATED | `useSocket.ts:127` | LISTEN-ONLY — no emit site exists. Dead. |
| BID_PLACED (`bid:placed`) | `useSocket.ts:132` | Split pair — server emits the same logical event as `bid-placed`. |
| BID_UPDATED | `useSocket.ts:138` | LISTEN-ONLY — no emit site exists. Dead. |
| NEW_MESSAGE | `useSocket.ts:143` | LIVE. |
| JOURNEY_AVAILABLE | `useSocket.ts:153` | LIVE. |
| JOURNEY_WISH_PRICE_UPDATED | `useSocket.ts:162` | LIVE. |
| DRIVER_LOCATION_CLIENT | `useSocket.ts:174` | LISTEN-ONLY and the handler body is empty. Dead. |
| AUTO_BID_FIRED | `useSocket.ts:182` | LIVE. |
| ACCOUNT_FROZEN | `useSocket.ts:201` | LIVE. |
| EMERGENCY_ALERT | `useSocket.ts:210`, `components/admin/AdminEmergencyAlerts.tsx:27` | LIVE (journey room + admins room). |
| DRIVER_LOCATION | `useDriverLocationStream.ts:139` | LIVE. |

No client listener exists for any of the 23 EMIT-ONLY constants — they are
the forward wiring for unbuilt UI (lifecycle, scheduled rides, suggest-up,
bid lifecycle) and stay.

## (c) Client→server emit inventory (complete)

| Constant | Client emit site(s) | Server handler | Verdict |
|---|---|---|---|
| JOIN_JOURNEY | `useSocket.ts:51`, `useDriverLocationStream.ts:126`, `useDriverLocationBroadcast.ts:84` | `socket/index.ts:52` | LIVE |
| LEAVE_JOURNEY | `useSocket.ts:57`, `useDriverLocationStream.ts:76,170`, `useDriverLocationBroadcast.ts:55,134` | `socket/index.ts:69` | LIVE |
| UPDATE_LOCATION | `useDriverLocationBroadcast.ts:101` | `socket/index.ts:75` | LIVE |
| MESSAGE_SEND | `useSocket.ts:69` (`sendMessage`) | **none** | Dead |
| DRIVER_LOCATION_CLIENT | `useSocket.ts:63` (`emitDriverLocation`) | **none** | Dead |

## Proof-of-death for the G2 removals

- **JOURNEY_UPDATED / BID_UPDATED** (`useSocket.ts:127` / `:138`): no
  `.emit(SOCKET_EVENTS.JOURNEY_UPDATED|BID_UPDATED)` nor any
  `emitTo*` call with these constants exists anywhere in
  `packages/server/src` (or anywhere else). The store actions they call
  (`updateJourney`, `updateBid`) have live non-socket callers
  (`useJourney.ts`, `useBids.ts`, `sync/ConflictResolver.ts`) and stay.
- **MESSAGE_SEND** (`useSocket.ts:67–71`): the server has exactly three
  `socket.on` handlers (`socket/index.ts` — JOIN_JOURNEY, LEAVE_JOURNEY,
  UPDATE_LOCATION); `message:send` is not among them. Messages are sent via
  REST (`POST /api/journeys/:id/messages`) and broadcast back as
  NEW_MESSAGE. Doubly dead: no page consumes `useSocket().sendMessage` —
  ChatPage, ApproachPage and MatchedPage each define a local REST-based
  `sendMessage` and call `useSocket(journeyId)` without destructuring it.
- **DRIVER_LOCATION_CLIENT** (`useSocket.ts:61–65` emit, `:174` listener):
  no server handler and no server emit for `driver:location`; the client
  listener body is an empty no-op; no component calls
  `useSocket().emitDriverLocation`. Real location streaming runs over
  UPDATE_LOCATION → DRIVER_LOCATION in the two dedicated hooks. Dead on
  all four counts.

## Name-split status (G3 input)

- **`bid:placed` ↔ `bid-placed`: CONFIRMED still split, unify.** Same
  logical event — "a new bid landed on this journey". Server emits the
  created bid to the journey room as `bid-placed`
  (`bid.routes.ts:75`); the client's handler for `bid:placed`
  (`useSocket.ts:132` — `addBid` + toast) can never receive it. Unify to
  the server's spelling `bid-placed` (the same direction #124 took for
  `emergency-alert`), collapsing BID_PLACED and JOURNEY_ROOM_BID_PLACED
  into one constant. The wire format does not change; the client simply
  listens for the name actually emitted.
- **`driver:location` ↔ `driver-location`: NOT a pair to unify** — the
  `driver:location` side has no live use at all (see proof-of-death), so
  it is removed in G2 rather than unified.
- **`emergency:alert` ↔ `emergency-alert`: already unified** in #124.

## Consequences for later groups

- G2 removes: 2 dead listeners (JOURNEY_UPDATED, BID_UPDATED), the dead
  `sendMessage`/`emitDriverLocation` client emit paths, the
  DRIVER_LOCATION_CLIENT no-op listener, and the 4 now-unreferenced
  constants (JOURNEY_UPDATED, BID_UPDATED, MESSAGE_SEND,
  DRIVER_LOCATION_CLIENT).
- G3 merges BID_PLACED/JOURNEY_ROOM_BID_PLACED → BID_PLACED
  (`bid-placed`). Constant count lands at 34.
- G4's EMIT-ONLY allowlist is exactly the 23 constants in the verdict
  table above (post-G3, `bid-placed` is LIVE and not allow-listed).

## Execution status (SOCKET-HYGIENE, this branch)

All three consequence groups shipped exactly as scoped above — G2
(dead-wire removal), G3 (bid-placed unification, wire format unchanged),
G4 (orphan guard: LISTEN-ONLY dead wires and unhandled client emits now
fail CI; the 23 EMIT-ONLY events live in a commented allowlist the guard
checks for exactness in both directions). The guard was proven both
ways: a planted dead listener plus an unhandled client emit failed
exactly the two new checks; the clean tree passes. Post-change, every
constant classified LIVE here still has both its emit and listen sides —
verified by the guard itself on every CI run from now on.
