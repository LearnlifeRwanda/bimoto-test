# Operational runbook — Bimoto on Render + Supabase

Day-to-day operational tasks. Hand this to the on-call engineer.

> **What pilot customers will see after R3-E (2026-05-06).** Once a
> customer confirms a bid and lands on the MatchedPage, they now see a
> live driver-approach map with a "≈ N min away" pill that updates as
> the driver moves. The map mounts a leaflet view with the customer's
> pickup pin and the matched driver's animated current position;
> server-side, the driver's `update-location` socket events are now
> authorised against the journey's parties, persisted as `GpsPoint`
> rows for the plausibility audit, and broadcast to the customer's
> socket. ETA comes from `GET /api/journeys/:id/eta`, a straight-line
> haversine estimator (MOTO 25 km/h, CAR 20 km/h Kigali baseline) with
> a low/med/high confidence band. The driver-side broadcast stops at
> the MATCHED → IN_PROGRESS transition (privacy: customer must not see
> the driver after pickup); the customer-side stream and ETA poll stop
> at the same transition. No new env vars, no new top-level
> dependencies, no new infra. GAP-P12 closed.

> **R2 status (2026-05-06).** GAP-P11 (push notifications) is
> technically complete in the codebase: `services/push/`, the
> `DeviceToken` Prisma model, the `usePushNotifications` client
> hook, and the `POST /api/admin/push/test` admin endpoint all
> ship. **Operational completion still requires** a Firebase
> project + Apple Developer APNS auth key — see
> [mobile-push-setup.md](./mobile-push-setup.md). The push service
> is a no-op (with one startup warning per provider) until those
> secrets are configured, so the rest of the API runs unchanged
> in environments without push.

## Logs

### Render dashboard

Service → **Logs** tab. Live tail in browser. Filter by severity.

### CLI

```bash
# Install once
brew install render

# Authenticate
render login

# Tail live logs
render logs --tail --service bimoto-api

# Last 1h of logs
render logs --service bimoto-api --since 1h
```

### Sentry

Errors with stack traces: <https://sentry.io/organizations/bimoto/issues/>.
Filter by `service:bimoto-api`, `environment:production`.

The Sentry SDK is initialised in `packages/server/src/instrument.ts`,
which is imported as the very first line of `index.ts` so v8's
OpenTelemetry-based auto-instrumentation attaches to Express and
HTTP at require-time. Request spans + error reporting come from
`Sentry.setupExpressErrorHandler(app)`; both are no-ops when
`SENTRY_DSN` is unset.

## Shell access

```bash
render ssh --service bimoto-api
# Drops you into the container as root.
# Useful for: inspecting env, running ad-hoc prisma queries, etc.
```

Inside the container:

```bash
cd /app/packages/server
node -e "console.log(Object.keys(process.env).sort())"  # list env keys
pnpm exec prisma studio --browser none --port 5555      # DB GUI; tunnel from local
```

## Manual migration

### Expected warning from the payout-idempotency migration

`20260729000000_payout_idempotency_one_inflight_batch` adds a partial
unique index (at most one `PENDING` `DriverPayoutBatch` per driver). Its
pre-flight scans for pre-existing violations — drivers who already have
two or more `PENDING` batches, which the pre-fix race could have
produced. If it finds any, `migrate deploy` prints:

```
WARNING:  PAYOUT-IDEMPOTENCY: demoted N duplicate PENDING payout batch row(s) to FAILED ...
```

This is **informational, not a failure** — the migration still applies.
What it did: per affected driver it kept the oldest `PENDING` batch and
flipped the later duplicates to `FAILED` with
`failureReason = 'duplicate_in_flight_superseded_by_<keptBatchId>'`. No
row was deleted and no `DriverBalance` changed (a `PENDING` batch has not
yet deducted the balance), so no driver loses money — the funds stay in
the balance for the next payout cycle. To review what was demoted:

```sql
SELECT id, "driverId", amount, "failureReason", "createdAt"
FROM "DriverPayoutBatch"
WHERE "failureReason" LIKE 'duplicate_in_flight_superseded_by_%';
```

If the migration instead FAILS on
`DriverPayoutBatch_driverId_pending_key` (duplicate key), a violating row
was created between the pre-flight and the index creation — re-running
`pnpm exec prisma migrate deploy` resolves the new duplicates and
finishes. With no violations (the expected case) the migration is silent.

### Expected output from the audit-chain-unique migration (BID-ATOMICITY)

This update carries a migration:
`20260731000000_bid_atomicity_audit_chain_unique` adds a unique index on
`EscrowAuditLog (escrowId, sequenceNumber)` so the escrow audit hash
chain can no longer fork. The updater applies it exactly as normal
(migrations run on container start, or `pnpm exec prisma migrate deploy`
by hand). Its pre-flight scans for pre-existing duplicate chain
positions, which the pre-fix append race could have produced:

- **No duplicates (expected):** silent.
- **Benign duplicates** (same action/amount/previousHash — one logical
  event double-appended): the migration prints
  `WARNING:  BID-ATOMICITY: resequenced N benign duplicate audit row(s) past their chain tail ...`
  This is **informational, not a failure**. The earliest row keeps its
  position; each later duplicate is moved past that escrow's highest
  sequence number with `metadata.resequencedFrom` (its original number)
  and `metadata.resequencedBy` stamped, so the move is reversible. No
  row is deleted and no hash is rewritten. To review:

  ```sql
  SELECT id, "escrowId", "sequenceNumber", "metadata"
  FROM "EscrowAuditLog"
  WHERE "metadata" ->> 'resequencedBy' = '20260731000000_bid_atomicity_audit_chain_unique';
  ```

- **Divergent duplicates** (same chain position, DIFFERENT
  action/amount/previousHash — a genuine fork in the money audit trail):
  the migration **ABORTS** with
  `BID-ATOMICITY: divergent audit-chain fork(s) found ...` listing the
  rows, and leaves the database untouched. This is deliberate: no
  migration may pick a survivor between forked audit entries. Escalate
  with the printed rows; resolution is a human decision, after which
  `migrate deploy` is re-run.

Migrations apply automatically on container start. To run by hand
(e.g. you want to test a specific migration's effect before the
container restarts):

```bash
render ssh --service bimoto-api
cd /app/packages/server
pnpm exec prisma migrate deploy
```

To create + commit a new migration locally before deploy:

```bash
# Locally, against a DEV database (not production!)
cd packages/server
pnpm exec prisma migrate dev --name describe-the-change

# Commit packages/server/prisma/migrations/* and push.
# Render will apply on next deploy.
```

## Settlement-credit remediation (ESCROW-CREDIT)

Before ESCROW-CREDIT, the auto-confirm job released escrow without
crediting the driver's balance or incrementing `completedShifts` — every
journey confirmed by silence recorded zero driver earnings. The one-off
remediation script repairs the ledger for those journeys:

```bash
# Dry run (default): prints driver, journey, escrow and amount per
# finding, plus refusals and a summary. Touches nothing.
pnpm --filter @bimoto/server tsx scripts/backfill-settlement-credit.ts

# Apply the repair:
pnpm --filter @bimoto/server tsx scripts/backfill-settlement-credit.ts --apply
```

What it does, per shortchanged journey: credits the missing
`driverPayout` to `DriverBalance.pendingAmount` and increments
`completedShifts`, in one transaction with a
`BACKFILL_SETTLEMENT_CREDIT` audit entry. It creates **no payout batch
and no transfer** — the repaired balance is drained by the next
scheduled sweep exactly like an on-time credit. `totalRides` and
`completedRides` are not touched (the old code did increment those).

Detection is audit-trail evidence only: a `RELEASED` entry signed
`SYSTEM` without the `settledVia` metadata that the fixed path stamps.
It is idempotent (re-runs skip journeys carrying the
`BACKFILL_SETTLEMENT_CREDIT` marker, and the marker is re-checked inside
each repair transaction) and refuses rather than guesses when evidence
is ambiguous — refusals are printed with reasons for manual review. It
never runs implicitly; someone must invoke it.

## Roll back a deploy

Render keeps every deploy as a separate immutable image.

1. Service → **Events** tab.
2. Find the last known-good deploy.
3. Click **Rollback to this deploy**.
4. Render swaps containers within ~30 seconds.

> **Caveat:** rolling back the application does **not** roll back
> Prisma migrations. If a migration is incompatible with the older
> code, you'll need a forward-only fix migration. Plan migrations
> to be backward-compatible with N-1 application versions.

## Verify webhook signatures end-to-end

### Flutterwave

```bash
# Trigger a sandbox webhook from your local machine using Flutterwave's
# webhook re-send button (Flutterwave dashboard → Transactions → pick one
# → "Resend Webhook"), pointed at:
# https://bimoto-api.onrender.com/api/webhooks/flutterwave

# Then watch logs:
render logs --tail --service bimoto-api | grep -i webhook
```

A successful verification logs `flutterwave-webhook-verified` (or
similar). A signature mismatch logs `flutterwave-webhook-rejected`
and returns 401 to the caller.

### Africa's Talking inbound SMS

```bash
# Send an SMS to your shortcode (sandbox: 15555 from the AT simulator).
# Should hit /api/sms/inbound on the deployed service.
render logs --tail --service bimoto-api | grep -i 'sms-inbound'
```

If signatures don't verify, double-check `AT_INBOUND_HMAC_SECRET`
matches what's configured in the AT dashboard.

## Inspect Supabase queries

Supabase dashboard → **Database** → **Query Performance**:
- Top time-consuming queries
- Cache hit ratio
- Active connections

Useful SQL (paste into Supabase SQL editor):

```sql
-- Currently running queries
SELECT pid, now() - pg_stat_activity.query_start AS duration, query, state
FROM pg_stat_activity
WHERE (now() - pg_stat_activity.query_start) > interval '5 seconds';

-- Cancel a runaway query (replace 12345 with the pid)
SELECT pg_cancel_backend(12345);

-- Locks (helpful when migrations hang)
SELECT * FROM pg_locks WHERE NOT granted;
```

## Mobile build instructions

See [the Mobile builds section in the root README](../../README.md#mobile-builds)
for Android Studio / Xcode build steps.

## Installing a pilot APK on an Android phone

After R3-ANDROID-INSTALLABLE (2026-05-11), the `Android Build` GitHub
Actions workflow produces a debug-signed APK that is installable on
any Android phone via sideload and connects to the production server
at `https://bimoto-api.onrender.com`.

1. **Find the artifact.** GitHub → repo → **Actions** tab → **Android
   Build** workflow → pick the most recent successful run on `main` →
   scroll to **Artifacts** at the bottom → download
   `bimoto-android-debug-<sha>.zip`.
2. **Unzip on your laptop.** The zip contains a single `app-debug.apk`
   (or similar) file.
3. **Enable installation from unknown sources on the phone.** Android
   13+: Settings → Apps → Special app access → Install unknown apps →
   pick the app you'll open the APK with (Chrome, Files, Drive, etc.)
   → toggle **Allow from this source**. Older Android: Settings →
   Security → toggle **Unknown sources**.
4. **Transfer the APK to the phone.** Options:
   - USB cable + Files app drag-and-drop.
   - `adb install path/to/app-debug.apk` (if you have ADB installed).
   - Upload to Google Drive / Dropbox, open the link on the phone.
5. **Open the APK file on the phone.** Tap **Install**. Android shows
   a "this app was built for testing" notice — that's expected for a
   debug-signed APK; tap **Install anyway**.
6. **First launch.** The login screen renders. The app connects to
   `https://bimoto-api.onrender.com`. If the Render service is asleep
   (free tier sleeps after 15 min idle), the first request takes
   30-60s to wake the dyno — the login button may appear unresponsive
   during that window. Consider upgrading to Render's Starter plan
   ($7/mo, see render.yaml) to eliminate cold starts for the pilot.

> **Known limitation: debug-signed APK cannot go on the Play Store.**
> This dispatch ships a debug-signed APK (signed with Android's
> per-runner debug keystore). It installs on any phone via sideload
> but is rejected by the Google Play Console. The
> `R3-ANDROID-SIGNING-RELEASE` follow-up dispatch will generate a
> real keystore, upload it to GitHub Secrets, and wire a
> `signingConfigs.release` block into `app/build.gradle` once
> Bimoto is ready for Play Store submission.

## Offline sync diagnostics

After R3-F, pilots who reconnect after an offline stretch see an amber
banner at the top of the app shell when one or more queued events
were rejected by the server: *"N sync events failed — tap to review."*
Tapping opens a list with each event's type, the human-readable cause,
and **Retry** / **Discard** buttons. The taxonomy is a discriminated
`SyncRejectionCode`:

- `FK_VIOLATION` — referenced entity (journey, bid, etc.) was deleted
  server-side. Retry won't succeed unless the user creates a fresh
  journey; "Discard" is the usual action.
- `DUPLICATE_EVENT_ID` — an event with the same `clientEventId` was
  already accepted (often a duplicate retry). Safe to discard.
- `VALIDATION_ERROR` — payload failed Zod validation. Capture the
  client `App` version from Sentry; this usually means a schema drift.
- `STALE_TIMESTAMP` — event is older than the server's grace window
  (currently unused in code, reserved for future state-machine guards).
- `PERMISSION_DENIED` — caller no longer has authority to emit the
  event (e.g., suspended account). Should not retry.
- `UNKNOWN` — catch-all; check Sentry under
  `tags.sync_rejection_code=UNKNOWN` for the underlying exception.

### Canonical sync path (R3-X)

After R3-X, the client has exactly one sync path:

- **Producers** — `useEmergency`, `useBids`, `useJourney` enqueue
  events via `eventQueue.enqueue(...)` (see `packages/client/src/sync/EventQueue.ts`),
  which writes to Dexie's `db.syncEvents` table. `useGPS` writes
  points directly to `db.gpsBuffer`.
- **Consumer** — `syncManager.startMonitoring()` (called from
  `App.tsx` after the `/api/users/me` resolve) drives an upload +
  download heartbeat: pending events to `/api/sync/events`, batched
  per-journey GPS to `/api/sync/gps`, then a download of server
  events since `db.syncMeta.lastSyncTimestamp` applied via
  `ConflictResolver`.
- **Banner** — `<RejectedEventsBanner>` subscribes to
  `db.syncEvents` (via `dexie-react-hooks`'s `useLiveQuery`) and
  surfaces rows where `failReason` is set. Retry clears the flag
  so SyncManager picks the row up again on its next heartbeat;
  Discard deletes it.

> **Pre-R3-X legacy IndexedDB note.** Pilot/dev devices that booted
> the app before R3-X-cleanup landed (PR #35) and never connected
> after R3-X may still have a `bimoto-offline` IndexedDB on disk. It
> is no longer read by the application; it is harmless. To reclaim
> the storage manually: DevTools → Application → IndexedDB →
> `bimoto-offline` → "Delete database."

## Database unreachable (DB-RESILIENCE, 2026-07)

Background, from the 29 July Kigali incident: the pilot Mac went to
sleep, every socket in the Prisma connection pool died while Postgres
itself stayed healthy, and on wake the pool kept handing out dead
connections — the server ran but did nothing useful until Postgres was
restarted by hand. Since DB-RESILIENCE the server heals this on its
own: connection-establishment failures (Prisma `P1001`) are retried
with backoff and the dead pool is torn down and rebuilt, so jobs and
requests recover within seconds of the database becoming reachable
again. **You should not need to restart anything for this class of
failure.**

### What you will see while it heals

- User requests answer **503 `DATABASE_UNAVAILABLE`** (the app shows
  "Bimoto has a problem, not your phone"), not a generic 500.
- `/api/health` answers `status: "degraded"`, `dbConnected: false`.
- Server log lines, each with a timestamp:
  - `[DB-RESILIENCE] <time> connection error at <operation> (attempt n/5): P1001 …`
  - `[DB-RESILIENCE] <time> retrying <operation> in <ms>ms (attempt n/5)`
  - `[DB-RESILIENCE] <time> giving up on <operation> after 5 attempts`
    (the next job tick, at most 60s later, starts a fresh retry cycle)
  - `[DB-RESILIENCE] <time> database recovered at <operation> after N
    consecutive connection failure(s) (unreachable since <time>)` —
    this is the all-clear.

### The `db` object in `/api/health`

Answers "when did the database last work?" without reading OS logs:

| Field | Meaning |
|---|---|
| `lastSuccessAt` | Last time any monitored query succeeded. Stale by more than ~2 min while the server is up = the DB has been unreachable since then. |
| `lastErrorAt` / `lastErrorCode` / `lastErrorMessage` | The most recent database error. The first errors of an outage are typically `P1017` ("Server has closed the connection" — dead pooled sockets), followed by `P1001` ("Can't reach database server") on fresh attempts. |
| `consecutiveConnectionFailures` | 0 when healthy; climbing while an outage is in progress. |
| `unreachableSince` | Start of the current outage window; `null` once recovered. |

The pre-existing `status` and `dbConnected` fields are unchanged.

### What to do if it does NOT heal

1. `curl -s localhost:3000/api/health | jq .db` — confirm the outage
   window and the error code.
2. If `lastErrorCode` is `P1001` for more than ~2 minutes, the database
   is genuinely down or unreachable (not just a dropped pool): check
   Postgres itself (`brew services list`, `pg_isready`, Postgres logs).
   Restart Postgres only if Postgres is actually broken.
3. Authentication/credential errors (`P1000`) or anything that is not a
   connection error will NOT be retried by design — fix the cause; the
   server is behaving correctly by failing fast.
4. On the pilot Mac, also confirm the power policy: idle sleep on
   battery is what caused the July incident (`pmset -g` — both the AC
   and battery profiles need `sleep 0`).

A restart of the *server* is safe if ever needed: shutdown now stops
all twenty background jobs, closes the HTTP server, disconnects the
pool, and exits within 10 seconds of Ctrl+C / SIGTERM.

## Common incidents

| Incident | First actions |
|---|---|
| Health check failing for >2 min | Check Render logs for stack trace. If crash loop, roll back to last known-good deploy. |
| 5xx spike on a route | Check Sentry for the new error class. Often a recently-deployed code change. |
| Database CPU at 100% | Supabase dashboard → Query Performance. Cancel runaway queries. Add an index if pattern is recurring. |
| Webhook signatures rejected at scale | Verify `FLW_SECRET_HASH` / `AT_INBOUND_HMAC_SECRET` env vars match vendor dashboard. Most common cause: trailing newline pasted into Render. |
| Free-tier service sleeping | Upgrade to Starter ($7/mo) or set up an external uptime ping. |
| User reports lost data after deploy | Check Supabase backups (**Database** → **Backups**). PITR available on Pro plan. |
| `GET /api/map/kigali.pmtiles → 404 MAP_NOT_AVAILABLE` in logs | Not an incident. The offline map file is **optional**; a server without `MAP_PMTILES_PATH` provisioned says so with exactly this 404, and the client shows a calm "not available yet" line and keeps using online tiles. |

## On-call escalation

1. **First responder** (you): triage via Sentry + Render logs;
   roll back if regression.
2. **Engineering lead** (Joschll): if root cause unclear within 30 min.
3. **Founders**: if user-visible incident lasts >1 h.

## Useful one-liners

```bash
# Quick health check
curl -s https://bimoto-api.onrender.com/api/health | jq

# Trigger a manual deploy without pushing code
render deploy --service bimoto-api

# View env vars (names only; values masked)
render env --service bimoto-api list
```
