# Bimoto migrations — how to set up and update a database safely

The migration history was repaired in July 2026 (DB-BASELINE): the schema
originally reached databases via `prisma db push`, so no migration created
the base tables. `20260430000000_init` is the reconstructed baseline — on
an empty database it creates exactly the schema that the earliest real
migration (`20260506000000_add_device_token`) assumed already existed.

There are exactly three supported paths. Pick the one that matches your
database.

## 1. Fresh, empty database (new machine, new environment)

```bash
cd packages/server
pnpm exec prisma migrate deploy   # or: pnpm db:migrate:deploy
```

That is all. `migrate deploy` applies the baseline plus every later
migration, in order, non-interactively. It never resets, never prompts,
and never deletes data — it is the only migrate command that servers,
bundles, and operators should ever run.

## 2. Existing database that was set up with `db push` (the pilot)

A `db push`-managed database already HAS all the tables, so the
migrations must be recorded as applied — not re-run. One-time adoption:

```bash
cd packages/server

# a) Make sure the database matches the current schema (this is the
#    same non-destructive sync every previous update bundle ran):
pnpm exec prisma db push --skip-generate

# b) Record every migration in this tree as already applied:
for d in prisma/migrations/*/; do
  pnpm exec prisma migrate resolve --applied "$(basename "$d")"
done
```

This writes bookkeeping rows into `_prisma_migrations` and touches
nothing else — no table is created, altered, or dropped, and no data is
read or written. From then on, every future update is path 1:
`prisma migrate deploy`.

> Why every migration and not just the baseline? Because the database
> already contains the *full* current schema, not just the baseline's
> part of it. If only `20260430000000_init` were resolved, the next
> `migrate deploy` would try to re-run the other migrations and fail on
> already-existing tables and types.

### Optional parity note: one partial index

Migration `20260713000000_launch_truth_fee_waiver` creates a partial
unique index that Prisma's schema language cannot express, so `db push`
never created it on the pilot:

```sql
CREATE UNIQUE INDEX "FeeWaiver_one_nonrevoked_per_driver"
  ON "FeeWaiver"("driverId") WHERE "revokedAt" IS NULL;
```

The invariant (at most one non-revoked waiver per driver) is also
enforced in the grant service, so this is belt-and-suspenders, not a
correctness gap. After baselining you may run the statement above once
to bring an ex-`db push` database to full parity with a
migrate-deploy-built one. It fails harmlessly (without corrupting
anything) if existing data ever violated the invariant — investigate
before retrying in that case.

## 3. Development machine (throwaway data only)

```bash
pnpm db:migrate:dev    # prisma migrate dev
```

`migrate dev` is a development tool: it can generate new migrations and
— on drift — **offer to reset (wipe) the database**. That is fine for a
disposable local dev database and catastrophic anywhere else.

## The one rule

**Never run `prisma migrate dev` (or `pnpm db:migrate:dev`) against a
database whose data you care about.** Real databases take
`prisma migrate deploy` only. CI proves on every run that a fresh
`migrate deploy` from an empty database builds the complete schema.
