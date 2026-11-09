# ADR-001 — Two offline queues, and which one a feature belongs in

**Status:** Accepted (QUEUE-UNITY, 16 Aug 2026)
**Supersedes:** nothing. First ADR in this repo; `docs/adr/` starts here.

## Context

The Bimoto client holds work on the phone in two different places, and
until now that was an accident of history rather than a decision anyone
had written down. The next engineer adding an offline feature had to
re-derive which one to use by reading both, and the honest answer to
"why are there two?" was "because the second one was easier to add than
to merge into the first."

There is a real reason for two. This is it, written once.

## The two queues

### The envelope pipeline — `syncEvents` + `gpsBuffer`

`sync/EventQueue.ts` and `sync/SyncManager.ts`, drained on connectivity
recovery and on a heartbeat, mounted at boot from `App.tsx`.

It carries **telemetry**: things that *happened*, described as
`{ eventType, payload }` envelopes and posted to `POST /api/sync/events`,
plus GPS points batched per journey to `POST /api/sync/gps`. The server
interprets the envelope; the client does not care what endpoint the
interpretation eventually reaches. Rejections come back as
`{ clientEventId, code, message }` and are shown to the person whose
event was refused, who can retry or discard.

### The outbox — `outbox`

`lib/outbox.ts` and `sync/OutboxReplay.ts`, added by #167, drained on
connectivity recovery.

It carries **deferred requests**: a call the app would have made online,
held back byte-for-byte and replayed against the real endpoint when
there is signal. Today that is `POST /api/journeys` — a booking made in
a dead zone. Each entry travels with the `clientRequestId` it was first
sent with, so a create whose 201 was lost is recognised by the server
rather than booking a second ride. A 4xx is a real answer: the entry is
marked REJECTED with the server's own reason and is never retried on its
own.

## Decision

**Both stay. They are not two implementations of one idea.**

The envelope pipeline describes *what happened* and lets the server
decide what that means. The outbox holds *a request that has not left
yet* and changes nothing about it. Those are different jobs, and the
difference is load-bearing rather than stylistic.

Concretely, the reason #167 did not reuse the envelope for bookings
(`docs/outbox-terrain-survey.md` §1): teaching `syncEvents` a
`journey-create` event type would have given the server a **second way
to create a journey**. Two creation paths for one resource means two
places for validation, pricing, idempotency and authorisation to drift
apart — and the drift would surface as a passenger charged differently
depending on whether they had signal. Replaying the real endpoint keeps
one creation path, which is also what makes `clientRequestId`
idempotency possible at all: the guard lives on the endpoint, and only
requests that go through the endpoint are guarded.

The converse holds too. Telemetry has no endpoint to replay — a GPS
point is not a deferred call to anything — so pushing it through the
outbox would mean inventing one, and the outbox's per-entry,
one-in-flight, never-retry-a-refusal discipline is wrong for a stream of
points that should be batched and is fine to lose.

## The ownership model, now shared by both

This is the part QUEUE-UNITY added, and it is the same in both queues:

1. **Rows are stamped.** Every row carries the auth-store `userId` of
   whoever was signed in when it was written. Derived at write time from
   the session, never passed in by a caller, never inferred later.
2. **Writes with no session are refused,** not written unstamped. A row
   nobody can claim is a row that could only ever be sent as the wrong
   person, so producing one is not a smaller failure than refusing.
3. **Every read is scoped.** There is no "list everything" API in either
   queue. A drain, a count and a rendered list all go through
   `where('userId').equals(current)`.
4. **Identity is re-checked mid-drain.** A session can end — or a 401
   can end it — part-way through, and the rows that have not gone yet
   must not go out under whoever comes next. The drain stops silently:
   a user switch is not an error and nobody is waiting to hear about it.
5. **Foreign rows are device-quarantined, not deleted.** A logout does
   not clear either queue (`lib/session-reset.ts`). Rows stay on the
   phone, inert to everyone but their owner, and are still theirs when
   they sign back in. This is the same argument #161 made for the
   offline map, and it only became sound once rows could be told apart.
6. **Unclaimable rows belong to nobody.** Rows written before the stamp
   existed carry `userId: null` (Dexie v5). They match no scoped read,
   so they are never drained and never rendered — and they are not
   deleted either. Deciding when unclaimable data leaves a phone is a
   retention question (Trello item 10), and it is deliberately left open
   here rather than settled by a migration.

Why this matters in the field and not just in principle: a phone in a
Kigali co-op is passed between brothers. Two people's half-sent
histories sitting in one IndexedDB is the normal case, not an edge case,
and before the stamp the only two options were destroying one person's
unsent work or sending it under the other's name.

Server-side attribution is independent of all this and unchanged: every
sync route is behind `authMiddleware` and attributes to
`req.user.userId`. The client stamp is not a substitute for that — it
decides *which rows are offered* to a session, which is a question the
server cannot answer because it never sees the ones that are held back.

## The rule for the next offline feature

* **A deferred action → the outbox.** If the feature is "the user did a
  thing that needs an API call, and there was no signal", add an
  `OutboxKind`, hold the real request body, and replay it against the
  real endpoint with a `clientRequestId`. Do not invent a sync event
  for it.
* **Telemetry → the envelope pipeline.** If the feature is "record that
  something happened, for the server to interpret", add an `eventType`
  and enqueue an envelope.
* **Neither is ever unowned.** Any new table that holds work across a
  logout stamps its rows with a userId, scopes every read, re-checks
  identity mid-drain, and quarantines rather than adopts. If a new queue
  cannot follow those four rules, it should not be a new queue.

## Consequences

* Two drains run at boot instead of one. Accepted: they are cheap, they
  share one connectivity signal, and merging them would cost the single
  creation path.
* The envelope pipeline has no production producer today — its writers
  retired with #163 — but its public API, drain and refusal surface all
  ship. It is a maintained road with no traffic on it, kept because the
  next telemetry feature is cheaper to add than to re-invent, and
  because leaving an unowned queue mounted was the actual hazard.
* Pre-v5 rows are invisible forever until the retention decision lands.
  A user who had a refused sync event from before the upgrade stops
  seeing it in the refusals panel. This is quarantine working as
  designed, not data loss.
