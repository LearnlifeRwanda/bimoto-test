# Queue ownership — G1 enumeration

QUEUE-UNITY G1. Evidence gathered before any edit, at `main` = `feb0f43`.

This is an enumeration, not a sample. Every claim below names the search
space it was made over and the command shape that produced it, so a later
reader can re-run it rather than trust it.

---

## 1. Who writes the legacy queues?

**Search space:** all of `packages/client/src` (every `.ts`/`.tsx` file,
including `__tests__`). Four independent greps, unfiltered:
`enqueueEvent`, `eventQueue` / `EventQueue`, `gpsBuffer`, `syncEvents`.

### `syncEvents` — verdict: **API-ONLY**

| Site | Kind | Note |
| --- | --- | --- |
| `sync/EventQueue.ts:6` | write (`add`) | the queue's own `enqueue` |
| `sync/EventQueue.ts:10,14,18` | read / modify | drain support |
| `sync/SyncManager.ts:26` | public API (`enqueueEvent`) | wraps `EventQueue.enqueue` |
| `components/sync/RejectedItemsPanel.tsx:52,87,92` | read / update / delete | the refusal list |
| `lib/session-reset.ts:43,106` | comment only | the reported seam |
| `components/ErrorBoundary.tsx:119` | comment only | names the queue as deliberately preserved |
| `db/dexie.ts:18,32,53`, `db/tables.ts:112,119` | schema / comment | — |
| 10 files under `__tests__/` | test | seed, assert, or clear the table |

**No production caller of `syncManager.enqueueEvent` exists.** The only
callers are `__tests__/offline.test.ts` (3) and
`__tests__/SyncManager.test.ts` (2). The historical writers died with
#163.

### `gpsBuffer` — verdict: **API-ONLY, and read-only at that**

| Site | Kind | Note |
| --- | --- | --- |
| `sync/EventQueue.ts:22,26` | read / modify | drain support |
| `lib/session-reset.ts:43,106`, `components/ErrorBoundary.tsx:119` | comment only | — |
| `db/dexie.ts:19,33,53` | schema / comment | — |
| 5 files under `__tests__/` | test | mock or assert table presence |

There is **not one writer of `db.gpsBuffer` anywhere in the client** —
not even inside the sync module. `EventQueue` exposes `getUnsyncedGps`
and `markGpsSynced` and no `enqueueGps`. The buffer is a drain with no
tap.

### What runs anyway

Neither verdict makes the machinery dormant. `SyncManager.startMonitoring()`
is called at `App.tsx:225` and mounts three live things at every boot:
a connectivity-change drain, a `SYNC_HEARTBEAT_MS` interval drain, and a
Background Sync registration. `RejectedItemsPanel` renders in the shell.
`enqueueEvent` is exported and callable. All three have unowned
semantics today; the absence of producers bounds today's blast radius,
not tomorrow's.

---

## 2. A defect found while reading the drain: the queue could not drain

`EventQueue.enqueue` writes `synced: false` — a **boolean**. IndexedDB's
valid-key types are number, string, Date, binary and Array; boolean is
not among them, so Dexie omits such a record from the `synced` index
entirely. `getUnsyncedEvents()` queries `where('synced').equals(0)`.
The row is therefore invisible to its own drain.

Probed against real Dexie over `fake-indexeddb`, one real `enqueue`:

```
ROWS            [{"clientEventId":"p1", ... ,"synced":false,"id":1}]
VIA_INDEX_0     0
GET_UNSYNCED    0
```

`getUnsyncedGps()` has the identical shape and the identical fault.

Why no test caught it: `__tests__/SyncManager.test.ts` and
`__tests__/offline.test.ts` mock `db` wholesale, so they assert against
a fake `where()` rather than against IndexedDB semantics.
`RejectedItemsPanel` is unaffected because it uses `.filter()` — a table
scan, not the index — which is why refusals render while the drain that
would produce them cannot run.

Consequence for this dispatch: the scoped-drain rewrite in G2 reads by
`userId` and evaluates `synced` in memory, which repairs this as a side
effect. That is a behavioural change and is named as one in the report.
Its live blast radius is zero: there are no producers (§1), and any
residual device row is null-stamped and therefore quarantined (G2.1).

---

## 3. Server attribution — confirmed at the handler

**Search space:** `packages/server/src/routes/sync.routes.ts` and
`packages/server/src/services/sync.service.ts`, both read end to end.

| Route | Middleware | Attribution |
| --- | --- | --- |
| `POST /api/sync/events` | `authMiddleware` | `syncService.processEvents(req.user!.userId, …)` — `sync.routes.ts:62` |
| `GET /api/sync/events` | `authMiddleware` | `syncService.getEventsSince(req.user!.userId, since)` — `sync.routes.ts:92` |
| `POST /api/sync/gps` | `authMiddleware` | `saveGpsBatch(req.body.journeyId, req.body.points)` — `sync.routes.ts:138` |

Events: attribution is the authenticated session and nothing else.
`processEvents` writes `userId` from its first argument onto both
`syncEvent` and `syncRejection` rows; `getEventsSince` filters on that
same id plus journey participation. **Expected, confirmed, no server bug
to report** — which is precisely why the client is the right place to
fix ownership.

GPS: the handler is authenticated but attributes the batch by
`journeyId` alone; `saveGpsBatch` verifies the journey *exists* and does
not verify the caller participates in it. That is a server-side
observation, recorded here and **not acted on** — server changes are
fenced out of this dispatch, and it is not the seam this dispatch
closes. It does mean a stamped client queue is the only thing standing
between a borrowed phone and a mis-attributed GPS batch, which raises
rather than lowers the value of G2.

Also observed, also not acted on: `SyncManager.sync()` step 3 reads
`data.events` from the download response, but `GET /api/sync/events`
answers with a bare array (`res.json(events)`). `result.downloaded` is
therefore always 0 and `ConflictResolver.applyServerEvents` never runs.
Out of scope; recorded so it is not rediscovered.

### Rejection semantics the panel consumes

`processEvents` returns `{ processed: string[], rejected: SyncRejection[] }`
where a rejection is `{ clientEventId, code, message }`, `code` drawn from
`FK_VIOLATION | DUPLICATE_EVENT_ID | VALIDATION_ERROR | STALE_TIMESTAMP |
PERMISSION_DENIED | UNKNOWN`. `SyncManager` flattens this to
`markFailed(clientEventId, reason)`; `RejectedItemsPanel.parseFailReason`
splits it back on the first `:` into `{ code, message }` and looks up
`sync.rejection.<code>`. Unchanged by this dispatch.

---

## 4. The Dexie ladder, and what v5 must not disturb

Read in full at `db/dexie.ts`:

| Version | Adds | Dispatch |
| --- | --- | --- |
| 1 | `journeys`, `bids`, `messages`, `syncEvents`, `gpsBuffer`, `syncMeta` | — |
| 2 | `mapCache` | MAP-CACHE G2 |
| 3 | `mapDownloads` | MAP-TRUTH G4 |
| 4 | `outbox: '++id, userId, kind, status, clientId, createdAt'` | OUTBOX G2 |

Two existing tests constrain v5:

**`__tests__/map-cache-migration.test.ts`** (the #161 survivor test, 7
tests, `@vitest-environment node`). Its last describe block asserts that
`mapCache`/`mapDownloads` exist as tables and that no sibling table with
either name as a prefix was invented. v5 touches neither name and adds
no table, so the assertions hold unmodified. Its other six tests seed a
6 MB Kigali blob and prove nothing is re-downloaded or rewritten — also
untouched, since a `stores()` change to two other tables does not
rewrite `mapCache` rows.

**`__tests__/outbox-write-path.test.ts`** → *"OUTBOX G2 — the migration
is additive"* asserts `db.tables` contains `outbox`, `syncEvents`,
`gpsBuffer`, `syncMeta`, `mapCache`, `mapDownloads`, and that `outbox`'s
indexes are exactly `['clientId','createdAt','kind','status','userId']`.
v5 adds no table and changes no `outbox` index, so both hold unmodified.

Neither test asserts anything about `syncEvents`/`gpsBuffer` *indexes*,
so adding `userId` to those two collides with nothing.

---

## 5. Convention checks

* **ADR directory: does not exist.** `docs/` is flat — no `docs/adr/`, no
  file matching `*adr*`, no `ADR-` reference in any `.md`. The dispatch
  assumed an existing convention to follow. G3 therefore *establishes*
  one at the dispatch's own requested path, `docs/adr/`, numbered from
  `ADR-001`. Noted as an adaptation, per §4.
* **The banner is named `RejectedItemsPanel.tsx`**, not
  `RejectedEventsBanner.tsx`. CHROME-C (#168) split the old banner into a
  header badge plus this panel. Same component, current name.
* **SOS constants** live at `components/safety/EmergencyButton.tsx:38`
  (`HOLD_MS = 700`) and `components/safety/EmergencySOS.tsx:17`
  (`CANCEL_WINDOW_MS = 3000`) — `components/safety/`, not
  `components/emergency/`. Both are already exported and already imported
  symbolically by all five test files that reference them; there are no
  magic-number literals to chase.

---

## 6. STOP conditions — none met

* No live writer exists for either queue, so no flow can fail to tolerate
  a stamped-or-refused `enqueue` (§1).
* No fixture collision between v5 and either the survivor test or the v4
  outbox (§4).
* Server attributes events by the authenticated session, as expected
  (§3). The GPS participation gap is a recorded observation, not a
  reattribution — nothing to report as a server bug.
* The ADR convention differed from the assumption: adapted and noted
  (§5), which §4 designates as an adapt-and-continue, not a halt.

Proceeding to G2.
