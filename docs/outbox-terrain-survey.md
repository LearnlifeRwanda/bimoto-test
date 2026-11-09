# OUTBOX G1 — terrain survey

Evidence gathered at `cde11a3` (main) before any edit, for the passenger
booking outbox and the offline boot path. Recorded because three of the
beliefs this work was commissioned on turned out to be wrong, and the
design had to change to fit what is actually there.

## 1. Queue tables: ALIVE, not dead

The commission assumed `syncEvents` and `gpsBuffer` were writer-less
leftovers that could be retired in the same migration that adds the
outbox. They are not. The machinery is complete, mounted and running:

| Reference | File |
| --- | --- |
| `syncManager.startMonitoring()` — called at boot | `packages/client/src/App.tsx:225` |
| `EventQueue.enqueue` → `db.syncEvents.add` (writer) | `packages/client/src/sync/EventQueue.ts:6` |
| `SyncManager.enqueueEvent` (writer, public API) | `packages/client/src/sync/SyncManager.ts:26` |
| Upload/markSynced/markFailed on `syncEvents` | `packages/client/src/sync/SyncManager.ts:40-59` |
| `gpsBuffer` drain to `POST /api/sync/gps` | `packages/client/src/sync/SyncManager.ts:62-83` |
| `syncMeta` read + write (`lastSyncTimestamp`) | `packages/client/src/sync/SyncManager.ts:86-98` |
| `db.syncEvents` read/update/delete (live UI) | `packages/client/src/components/sync/RejectedEventsBanner.tsx:24,36,41` |
| Banner mounted in the shell | `packages/client/src/components/layout/AppShell.tsx:42` |

Verdict per table:

- **`syncEvents` — ALIVE.** Reader, uploader, rejection surface and
  retry/discard affordances are all mounted. What is missing is only an
  in-app *caller* of `enqueueEvent` (the `useJourney` path retired as
  dead code in #163). A table whose drain loop runs every 15s and whose
  contents render in a shipped banner is not a table you drop.
- **`gpsBuffer` — ALIVE.** Same drain loop, same absence of a caller.
- **`syncMeta` — ALIVE and written every sync.** Also cleared by
  `lib/session-reset.ts` and `components/ErrorBoundary.tsx`.

**Consequence for the design:** nothing is retired. The outbox is a new,
user-scoped table added alongside. This is what `lib/session-reset.ts`
itself asked for in its header — "Fixing it properly means stamping
ownership on the queue — a schema change, and its own dispatch."

The generic `syncEvents` pipeline is also the wrong shape for a deferred
booking: it posts to `POST /api/sync/events` with an `eventType`/`payload`
envelope, whereas a deferred create is just the original
`POST /api/journeys` held back. Reusing it would mean teaching the server
a journey-create event type — a second creation path for the same
resource. The outbox replays the real endpoint instead.

## 2. Server sync surface

`packages/server/src/routes/sync.routes.ts`, all `authMiddleware`:

- `POST /api/sync/events` — `validate(syncUploadSchema)` →
  `syncService.processEvents(userId, events)`. Returns
  `{ processed, rejected[] }`; rejection codes `FK_VIOLATION`,
  `DUPLICATE_EVENT_ID`, `VALIDATION_ERROR`, `STALE_TIMESTAMP`,
  `PERMISSION_DENIED`, `UNKNOWN` (`services/sync.service.ts`
  `classifyRejection`).
- `GET /api/sync/events?since=` — per-caller download.
- `POST /api/sync/gps` — `validate(gpsBatchSchema)`.

`RejectedEventsBanner` consumes `db.syncEvents` rows carrying a
`failReason` of the form `CODE: message`, and localises
`sync.rejection.<CODE>` with the server message as `defaultValue`.

**Replay target: the plain `POST /api/journeys`**, as expected — not a
sync event. Verified.

## 3. Idempotency: the journeys route had none

`POST /api/journeys` (`routes/journey.routes.ts:96`) →
`journeyService.createJourney(customerId, body)`
(`services/journey.service.ts:66`) → `prisma.journey.create` inside a
transaction. The `Journey` model (`prisma/schema.prisma:487`) carried no
client-supplied key and no uniqueness that a repeat create would violate.

So a create whose **response** was lost — the normal failure on a flaky
Kigali connection, where the row is written but the client never learns
it — would be re-sent by any replay engine and produce a second journey.
That is the double-booking §4 named as a STOP condition, and it is not
avoidable client-side: the client cannot distinguish "never arrived"
from "arrived, answer lost".

It is fixable additively, so this is not a STOP. See the completion
report for the guard as built (`clientRequestId`, unique per customer,
pre-checked and race-safe).

## 4. Boot sequence

`App.tsx` bootstrap (`:208-230`), in order:

1. `restoreSessionAtBoot()` (`lib/auth-refresh.ts`) — native only;
   exchanges the persisted refresh token for an access token. On web
   `getStoredRefreshToken()` is always null and this is a no-op.
2. `apiFetch('/api/users/me')` — **requires the network**.
3. success → `setUser(...)`, `syncManager.startMonitoring()`.
4. failure of any kind → `setUser(null)` → `isAuthenticated: false`.
5. `finally` → `setLoading(false)`.

What persists across a restart:

- `secure-token-store` — the **refresh token only**, native only, secure
  storage or Capacitor Preferences. The access token is memory-only by
  design.
- `prefs` (localStorage + native Preferences) — `bimoto-lang`,
  `hasSeenWelcome`, `registrationPending`.
- Dexie — journeys/bids/messages/syncMeta caches, `mapCache`,
  `mapDownloads`.

Nothing persists that says *who was signed in*. So step 4 is
indistinguishable from "never signed in", and the offline cold boot
lands on `/login` — or on `/welcome` when `hasSeenWelcome` is unset
(`AuthRoute`, `App.tsx:117-122`). Either way it is not the user's home.
The offline-map spec already fenced this off in a comment
(`packages/e2e/tests/offline-map-regions.spec.ts:232-236`).

`apiFetch` with no network: `trackedFetch` catches the fetch rejection,
calls `reportApiFailure()` and throws a typed `ApiError` of kind
`OFFLINE` (device network down) or `UNREACHABLE` (network up, API
silent). `isConnectivityError()` (`lib/api.ts`) is exactly the
"never got an answer" predicate the write path needs; a 4xx is kind
`REJECTED` and is excluded by it.

## 5. Connectivity authority

`sync/connectivity.ts` is the single source of truth (three states:
`online` / `offline` / `unreachable`), fed by window events,
`reportNetworkStatus` from `@capacitor/network`, and every `apiFetch`
outcome. `useConnectionState` is its React binding and composes
`useNetworkStatus` (device-level only). **The module — via
`onConnectivityChange` — is authoritative for the replay trigger**; it
is the same signal `SyncManager.startMonitoring` already subscribes to.

## 6. Layout shift: the notice was not the cause

The commission attributed the moving submit button on `/journey/new` to
`RouteFallbackNotice` mounting and unmounting. It cannot be: the notice
is absolutely positioned in **all four** of its consumers, inside a
fixed-height map box.

| Consumer | Placement |
| --- | --- |
| `RoutePreviewMap.tsx:265` | `absolute bottom-2` inside `h-[240px]` |
| `DriverApproachMap.tsx:208` | `absolute top-16` |
| `DriverNavMap.tsx:205` | absolute overlay |
| `LocationPickerMap.tsx:225` | inside a `fixed` overlay |

The real shift source is its sibling: the **route-alternatives block**
(`RoutePreviewMap.tsx:268-302`) — a wrapping row of 44px chips plus a
hint paragraph, in normal flow directly below the map, rendered only
`{alternatives && alternatives.length > 1}`. `useRouteAlternatives`
resolving, failing and retrying mounts and unmounts that block, and
everything below it on the booking form — including the submit button —
moves. That is what gets reserved.
