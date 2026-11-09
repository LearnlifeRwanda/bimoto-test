# Supabase setup — Bimoto Postgres

Bimoto uses [Supabase](https://supabase.com) for managed PostgreSQL
with daily backups and (on paid plans) point-in-time recovery.

## One-time setup

1. **Sign up / sign in** at <https://supabase.com>.
2. **New Project**.
   - **Name:** `bimoto`
   - **Database password:** generate and store in your password manager
     — you'll need this for the connection string.
   - **Region:** `eu-west` (Frankfurt — same region as the Render
     service for low latency).
   - **Plan:** Free is fine for the pilot; upgrade to Pro ($25/mo)
     when you need PITR.
3. Wait ~2 minutes for the project to provision.

## PostGIS: not required

PostGIS is **no longer required** (DB-BASELINE, July 2026). The schema
declared the extension historically but never used it — there are no
`Geography` columns, spatial indexes, or PostGIS function calls
anywhere in the schema or server code, and no migration creates the
extension. Plain PostgreSQL is sufficient; if a project already has
PostGIS enabled, that is harmless and nothing needs to change.

## Connection string

1. Project Settings → **Database** → **Connection String**.
2. Choose the **URI** tab.
3. Two options — **use the Connection Pooler URL** (port 6543) for
   Render:
   - **Direct connection** (port 5432): one connection per process.
     Fine for migrations, bad for serverless.
   - **Connection Pooler / PgBouncer** (port 6543): pooled, safer for
     containers that scale or restart. Use this URL for Render's
     `DATABASE_URL`. The URL looks like:
     ```
     postgresql://postgres.<project-ref>:<password>@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?pgbouncer=true
     ```
4. Append `&connection_limit=10` if you want to bound the pool from
   the Prisma side.
5. Paste this URL into Render's `DATABASE_URL` env var.

> **Prisma + PgBouncer note:** transaction-mode pooling (PgBouncer
> default) is incompatible with prepared statements. Prisma 5+
> handles this automatically when the URL has `?pgbouncer=true`.

## Backups

- **Free tier:** daily backups, 7-day retention. Sufficient for the
  pilot.
- **Pro tier:** PITR (point-in-time recovery) — can restore to any
  second within the last 7 days. Recommended once you carry real
  user / financial data.
- Verify under **Database** → **Backups**.

## Initial migration

After Render's first deploy succeeds, the `prisma migrate deploy`
that runs on container start will apply all committed migrations.
Verify:

```sql
-- in the Supabase SQL editor
SELECT migration_name, finished_at
FROM "_prisma_migrations"
ORDER BY finished_at DESC
LIMIT 10;
```

If migrations didn't apply, see Render logs and the
[runbook](./runbook.md#manual-migration).

## Security checklist

- [ ] **Row-level security** is *not* used by Bimoto — the API
      enforces authorisation. Don't enable Supabase RLS without
      coordinating; it'd break server queries.
- [ ] **Database password** stored in your password manager only;
      never committed.
- [ ] **API keys** (anon / service_role) — Bimoto does not use the
      Supabase REST/Realtime APIs, so these are unused. Don't expose
      the service-role key.
- [ ] **Allowed IPs** — leave open (Render's egress IPs aren't
      stable). The connection-pooler URL is auth-protected.

## Useful queries

```sql
-- Active connections by application
SELECT application_name, count(*) FROM pg_stat_activity GROUP BY application_name;

-- Table sizes
SELECT
  relname AS table_name,
  pg_size_pretty(pg_total_relation_size(relid)) AS size
FROM pg_catalog.pg_statio_user_tables
ORDER BY pg_total_relation_size(relid) DESC
LIMIT 20;

-- PostGIS spatial index usage
SELECT indexname, idx_scan FROM pg_stat_user_indexes WHERE indexname LIKE '%geom%';
```
