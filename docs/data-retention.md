# Data Retention Policy

What the platform actually deletes, keeps, and anonymizes — verified
against the code as of PAYOUT-F, not aspirational. When this document
and the code disagree, the code has drifted: fix one of them.

## Delete-after (enforced)

| Data | Retention | Enforced by |
|---|---|---|
| GPS traces (`GpsPoint`) | 14 days (`GPS_TRACE_RETENTION_DAYS`, `packages/shared/src/constants/config.ts`) | Nightly sweep `packages/server/src/jobs/gps-retention.job.ts` (05:00). Points whose journey is in a non-terminal or disputed status (anything but `COMPLETED`/`CANCELLED`/`EXPIRED`) are **held regardless of age** until the journey resolves — retention exists for dispute resolution. A journey holding an `ACTIVE` `EmergencyAlert` is held too, regardless of status, until that alert is resolved or expires (SOS-FOLLOW). |
| Emergency alerts (`EmergencyAlert`) | Not swept | The state row for an emergency: who raised it, their role, the press coordinates, and how it ended. Retained as the record of a safety incident and read by the ops history tab. |
| Expired OTP rows (`OtpCode`) | Purged once expiry is >24h past | Same nightly sweep (`otpDeleted` in its completion line). |
| BNR reports (`BnrReport`) | `RETENTION_YEARS` (default 7y, env `BNR_RETENTION_YEARS`) — see `services/bnr-report/config.ts` | Monthly, in `jobs/bnr-monthly.job.ts` (`deleteOlderThan`). |
| Mobility aggregates (`MobilityAggregate`) | A retention helper exists (`deleteOlderThanForRetention` in `services/mobility/store.ts`) but **no job schedules it** — aggregates are retained indefinitely today. They are k-anonymized, non-personal, and the intended long-term store (see next section). |

## The aggregate-then-discard contract

Raw GPS points are distilled nightly into k-anonymized
`MobilityAggregate` rows (`jobs/mobility-aggregation.job.ts`, 04:00) —
the platform's long-term insights store. Raw points only need to
outlive that distillation, and the retention sweep runs an hour later
so the aggregator always sees yesterday's points first. The sweep
additionally enforces a hard margin (`AGGREGATE_MARGIN_DAYS` in
`jobs/gps-retention.job.ts`): if `GPS_TRACE_RETENTION_DAYS` is ever
edited to within 3 days of the aggregation window's lower bound, the
sweep refuses to run and raises a Sentry error rather than silently
starving the pipeline.

Consequence, stated plainly: **new analytical questions can only be
asked of the trailing 14 days of raw data.** Anything older exists
only in the aggregates that were computed at the time. A new
aggregator module (the pluggable `AGGREGATOR_MODULES` list in
`services/mobility/aggregator/`) must therefore be added when a
question is first *anticipated*, not when it is finally asked.

## GPS traces: fourteen days, held under dispute

RIDE-TRACE (18 August) made two decisions together, and they only make
sense together.

**The ride is now recorded.** The driver's phone writes a position
roughly every eight seconds while a leg is under way — the passenger
leg on `ActiveRidePage`, the delivery leg on `GoodsPickupPage` — into
the local buffer, drained to `POST /api/sync/gps` when the network
allows. Store-and-forward only: the recorder (`useRideTraceRecorder`)
has no socket in it and emits nothing, so no ride can be followed live
by anyone, staff included. The separate pre-pickup broadcast a customer
sees while the motari approaches is unchanged and still stops at
pickup.

**The window is fourteen days, not thirty.** `GPS_TRACE_RETENTION_DAYS`
is 14. A trace only has to outlive the dispute it exists to settle, and
`DISPUTE_WINDOW_HOURS` is 24 — a fortnight is generous against that and
short enough that the platform is not accumulating a history of where
people go.

**Unless a dispute is open.** The shorter window is only safe because
the hold already exists and is enforced by the sweep itself, not by
anybody remembering. `jobs/gps-retention.job.ts` deletes only points
whose journey has reached a terminal status:

```sql
WHERE gp."timestamp" < ${cutoff}
  AND j."status" = ANY(
    ARRAY['COMPLETED', 'CANCELLED', 'EXPIRED']::"JourneyStatus"[]
  )
```

Everything else — `DISPUTED`, `INTERRUPTED`, `IN_PROGRESS`,
`AWAITING_CONFIRMATION` — is held regardless of age until the journey
resolves, and swept on the first nightly run after it does.

**Unless an emergency is open** (SOS-FOLLOW). A journey holding an
`ACTIVE` `EmergencyAlert` is held too, whatever its status:

```sql
  AND NOT EXISTS (
    SELECT 1 FROM "EmergencyAlert" ea
    WHERE ea."journeyId" = j."id" AND ea."status" = 'ACTIVE'
  )
```

This is the same idea as the dispute hold, reaching a different fact. An
emergency deliberately outlives the ride it started on — completing a
journey does not close an alert, only ops or the 60-minute valve does —
so a ride that ended while somebody was still in trouble would otherwise
become sweepable in the middle of the thing its trace exists for. The
hold releases the moment the alert becomes `RESOLVED` or `EXPIRED`: the
journey is then governed by its status and its age alone, and is swept on
the first nightly run that finds it old enough.

**The policy sentence, as it is said out loud:** traces are kept for 14
days and then deleted; if a ride is under dispute, its trace is kept
until the dispute is settled; nobody can watch a ride live. That
sentence appears to drivers on the verification/terms screen
(`legal.rideTraceNotice`) and on Diagnostics
(`diagnostics.rideTraceNote`), and to passengers in the user guide
(`guide.trace.*`), in all three locales.

**The margin guard is unaffected.** It refuses to run when the cutoff
lands within `AGGREGATE_MARGIN_DAYS` (3) of the aggregation window's
lower bound (24h). At 14 days the cutoff sits ten days clear of the
ceiling, so the guard stays dormant — the retention suite asserts this
directly ("margin guard is dormant at today's values (14d retention, 1d
window)"). It would trip below roughly 4 days, which is the point of
it.

No server code changed for any of this: the constant is the single
source of truth and the sweep reads it as its default `retentionDays`
argument.

## Keep-at-least (deletion prohibited)

Financial and compliance records are excluded from every sweep and
must never be added to one without counsel sign-off: escrows, payout
batches, the escrow audit log, AML flags, BNR reports, admin actions,
and the payout-preference change log. Statutory minimum retention
periods for these are **TBD — to be confirmed with counsel**; no
number in this repo should be treated as that answer.

## Account deletion, as actually implemented

Deletion is a **request with a clock on it**, not a button that erases.
`DELETE /api/users/me` opens a 72-hour cancellable window
(`ACCOUNT_DELETION_HOLD_HOURS`); `POST /api/users/me/deletion/cancel`
closes it again; a background job
(`jobs/deletion-execution.job.ts`) performs the erasure when the clock
runs out. The erasure itself hard-deletes **no User row** and touches
nothing in the keep-at-least list.

**Where a user does this in the app** (AR-SURFACE): Settings → the Account
section at the very bottom, below the logout button → *Delete My Account*
→ `/settings/delete-account`, which states what is erased and what is kept
before a press-and-hold confirm opens the window. The entry is deliberately
buried; the CANCEL is not — a countdown banner with a one-tap cancel is
mounted at the app shell and therefore renders on every screen for as long
as the window is open. *Export My Data* sits in the same section and serves
`GET /api/users/me/data-export`, whose contents are ruled by D20 and
described in the next section.

## The data export, and the one thing it does not contain

Founder decision D20 (24 August) settled, table by table, what the
self-serve export at `GET /api/users/me/data-export` hands a person.
The assembly and the per-table projections live in
`packages/server/src/services/data-export.service.ts`; the reason for
every withheld column is recorded at its own query.

**In** — the subject's own records: their profile (including their own
decrypted phone number, which is the point of portability), driver
profile, journeys in either role, bids, the escrows they are a party to,
fee waivers, payout batches, payout-preference changes, ratings in both
directions, the FULL conversation on every journey they were a party to,
the emergency alerts they raised, ride reports they filed, pickup
verifications, reconciliation responses, vehicle changes, auto-bid rules
and their own deletion requests.

**Out as noise**: device tokens, sync events, sync rejections and error
reports. Device plumbing and diagnostics; nobody is being denied
anything.

**Out as a carve-out, and stated rather than hidden.** Five tables are
withheld from the self-serve export: `AmlFlag`, `AdminAction` concerning
the account, `NameMismatchLog`, `DriverConflictOverride` and
`AccountTombstone`. These are the platform's fraud-prevention and
investigation records, and the reason they are withheld is that a fraud
check readable on demand by the person it is about stops working as a
fraud check. Withholding them is a decision that a person is entitled to
know has been taken, so the export **says so in the file itself**: a
top-level `notice` field carries one plain-English sentence naming
exactly these categories and pointing at a manual request to Bimoto
support, and `noticeKey` beside it lets a client render the same
sentence translated. The sentence is asserted present by test, and the
five tables are asserted absent by key.

Two limits on that promise, stated so nobody reads more into it:

- **The manual route has no named channel yet.** The notice says
  "a request to Bimoto support" and no more, because this repo holds no
  support address and inventing one here would be inventing policy. Give
  the channel a name and the sentence should name it. This belongs on
  the same open-questions list as the retention table below.
- **The consent screen's privacy text is deliberately untouched.**
  `legal.privacyText` is a versioned legal string gated by
  `CURRENT_PRIVACY_VERSION`: editing it without a bump reaches nobody who
  already accepted, and editing it WITH a bump walks every existing user
  back through the consent gate. Neither is a side effect the carve-out
  should cause. The sentence therefore lives in the payload, in this
  document, and behind `noticeKey` for whichever surface offers the
  download.

**What the export does NOT do is delete or change anything**, and it
runs on a live account. `DeletionRequest` rows are in scope precisely
because the subject is still there to read them; the tombstone is not,
and by the time one exists there is no account to export from.

### The 72-hour window

During the window the account behaves **normally** in every respect but
one: no scheduled ride may be booked for a time **past the account's own
deletion date**. Immediate rides, earlier scheduled rides, SOS, chat and
money are all untouched, and cancelling the request makes the later slot
bookable again at once. `requestedAt` is the compliance timestamp under
Law 058/2021's thirty-day erasure clock; the 72 hours sit well inside it.

`GET /api/users/me` reports the open window as
`accountDeletion: { requestedAt, executesAt, deferredReason } | null`
(`deferredReason` added by AR-SURFACE, so a user whose deletion is past due
is told which single thing is holding it, and ops can see the same on
`/admin/deletions`). At most one
request may be pending per account, enforced by a partial unique index.

### Deferral: when the clock runs out but the erasure waits

A request whose window has closed is **not** erased while any of these
holds. The machine-readable reason is written to
`DeletionRequest.deferredReason`, and the row keeps retrying:

| Blocking state | Reason code |
| --- | --- |
| A non-terminal journey, as customer or driver | `NON_TERMINAL_JOURNEY` |
| An escrow in PENDING, HELD or FROZEN, either party | `LIVE_ESCROW` |
| An emergency alert the user raised, still ACTIVE | `UNRESOLVED_EMERGENCY` |
| The account is frozen | `ACCOUNT_FROZEN` |
| A driver balance still owing | `POSITIVE_DRIVER_BALANCE` |

Deferral never force-executes and **never cancels** the request: the
user asked, the law gives them thirty days to have it honoured, and a
request that quietly cancelled itself would drop both. A row deferred
past seven days keeps retrying; nothing expires it.

### What the erasure does, in one transaction

Every write below commits or rolls back together. A crash part-way
leaves the account **untouched**, not half-erased — which matters
because a half-erased user can no longer authenticate to retry.

- **AccountTombstone written** from the ORIGINAL `phoneHash`, in the
  same transaction as the write that destroys it (see below).
- **User row anonymized**: `phone`/`phoneHash` replaced with an
  encrypted `DELETED-<id>` marker, `nickname` → "Deleted User",
  `emergencyContacts` cleared, `isDeleted` + `accountDeletedAt` set.
- **DriverProfile anonymized**: registration plate, licence and RURA
  authorization numbers, cooperative name and the three document photo
  URLs cleared; vehicle description → "Deleted"; driver taken offline.
- **Device tokens deleted.** The FK declares `onDelete: Cascade`, which
  never fires because no User row is ever hard-deleted, so the rows go
  explicitly. Otherwise an erased account keeps receiving push.
- **Outstanding OTP codes deleted** for the original phone hash — the
  number must stop being loggable-into.
- **Every refresh token revoked.** Before this, sessions survived
  erasure: nothing in the codebase read `isDeleted`, so an anonymized
  account with a live token kept using the app as "Deleted User". Auth
  now refuses a deleted account (401) as well.

After the transaction commits, and only then:

- **Uploaded verification files hard-deleted from disk.** Deletion
  follows the three document URL columns, read before the
  anonymization nulls them (`services/document-deletion.service.ts`).
  It used to remove the directory `uploads/verification/<userId>`;
  since DOC-GUARD G2 documents are stored under opaque uuids, so that
  directory sweep alone would have deleted nothing. It is still run,
  for files written before that change.

### What is kept after erasure, and why

**The tombstone — exactly three facts, and nothing else.** Keyed by the
account's original `phoneHash`:

| Kept | Why |
| --- | --- |
| `phoneHash` (the original) | Recognise a returner. It is a one-way hash, never a dialable number. |
| `deletionCount` | How many times an account on this number has been deleted. |
| `wasSuspended` | Whether the account was suspended or frozen when erased. |
| `lastDeletedAt` | When the most recent erasure committed. |

The tombstone exists because the erasure **must** destroy the User row's
`phoneHash` — the account has to stop being findable by phone number —
and that same write destroys the only key by which a returner can be
recognised. Without it, a suspended user could delete their account and
re-register clean.

It is deliberately not more than this: **no** relation to the User row,
**no** encrypted phone (a hash is one-way; a ciphertext is not), no
nickname, no user id, and no per-deletion history beyond a count and the
most recent date. A test pins `Object.keys` in both directions, because
the pressure on a table like this is always to add one more harmless
column.

A returner whose tombstone says `wasSuspended` is **not refused
registration**. The new account is created with `isFlagged` and
`flagReason = RETURNED_AFTER_DELETION_WHILE_SUSPENDED`, which puts it in
front of an admin. Flag is not a block here, exactly as it is not a block
anywhere else in this codebase.

**Also retained** (unchanged): journeys, GPS points (until the
fourteen-day sweep), messages, ratings, parcel photos, and every
financial/compliance record in the keep-at-least list above. Parcel
photos (`pickupPhotoUrl`/`deliveryPhotoUrl`) are never touched by an
individual deletion — they belong to the delivery and to the other party's
proof of it.

Nothing in the keep-at-least list is touched by account deletion.

**Pending decisions** — categories with no retention policy yet,
awaiting the team's retention table: ride messages, inbound SMS,
driver documents/screener records.

### Driver documents: still pending, and deliberately not wired

DOC-GUARD G3 was asked to delete a rejected applicant's documents
"after a stated period". There is no such period to state. This
document is the record of what the platform deletes, and it lists
driver documents under *pending decisions* above — so wiring a number
would not be enforcing a policy, it would be **inventing** one, and
inventing it in the one place (a nightly sweep over identity
documents) where being wrong is unrecoverable.

What DOC-GUARD did instead, none of which needs a retention number:

- documents are encrypted at rest, so an undeleted file is ciphertext
  rather than a scanned licence;
- they are readable only by their owner and an admin;
- a superseded document is deleted when it is replaced, and every
  document is deleted on account deletion — the two erasure paths that
  already had a stated basis.

**Open question for the retention table** — how long may a REJECTED
applicant's driving licence, RURA authorisation and insurance
certificate be kept? The competing pulls: a rejected applicant may
appeal or re-apply, and RURA may ask what was reviewed; against that,
a person who was refused has the strongest claim to erasure. The
answer needs the team and probably counsel, not a default. The
mechanism to enforce whatever they choose already exists
(`deleteDocumentsForUrls` plus the `rejectionReason`/`verificationStatus`
columns); only the number is missing.
