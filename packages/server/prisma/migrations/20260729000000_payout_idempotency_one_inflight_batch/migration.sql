-- PAYOUT-IDEMPOTENCY G1: at most one un-settled (PENDING) payout batch per
-- driver, enforced by the database rather than a read-then-write check.
--
-- Why: firePreferenceChangeBatch's in-flight guard (findFirst then a later
-- create) is a time-of-check-to-time-of-use race — two concurrent callers
-- (e.g. a driver double-tapping "end shift") both read "no batch in flight"
-- and both create one. The existing @@index([driverId, status]) is not
-- unique, so nothing stops the second row. This partial unique index makes
-- the second insert fail at the database, which the service handles as a
-- no-op (see payout.service.ts).
--
-- Prisma cannot express a partial unique index in schema.prisma (no WHERE
-- clause on @@unique), so the index exists only here. That is safe for the
-- schema/migration faithfulness gate: Prisma's introspection ignores
-- partial indexes, so `prisma migrate diff --from-url ... --exit-code`
-- does not see it and will never propose dropping it. A companion comment
-- on the DriverPayoutBatch model in schema.prisma documents this.

-- Pre-flight: the live pilot database may already hold rows that violate
-- the invariant (the race this migration closes may have already fired).
-- Naive index creation would then fail mid-deploy. Resolve violations
-- deterministically and reversibly first:
--   * keep the OLDEST PENDING batch per driver (by createdAt, then id) —
--     it is the row whose txRef was presented to the gateway first;
--   * demote every later duplicate to FAILED with a failureReason naming
--     the batch that superseded it.
-- No row is deleted and no driver loses money: a PENDING batch has not
-- yet deducted DriverBalance (only markBatchPaidOut does that on SUCCESS),
-- so demoting a duplicate to FAILED leaves the driver's full balance in
-- place for the next legitimate payout. The change is reversible by
-- flipping status back to PENDING on the rows carrying this failureReason.
-- Expected case (no violations): the UPDATE touches zero rows and this
-- block is a silent no-op.
DO $$
DECLARE
  resolved integer;
BEGIN
  WITH ranked AS (
    SELECT
      "id",
      first_value("id") OVER (
        PARTITION BY "driverId"
        ORDER BY "createdAt" ASC, "id" ASC
      ) AS keeper_id,
      row_number() OVER (
        PARTITION BY "driverId"
        ORDER BY "createdAt" ASC, "id" ASC
      ) AS rn
    FROM "DriverPayoutBatch"
    WHERE "status" = 'PENDING'
  ),
  demoted AS (
    UPDATE "DriverPayoutBatch" b
    SET
      "status" = 'FAILED',
      "failureReason" = 'duplicate_in_flight_superseded_by_' || r.keeper_id
    FROM ranked r
    WHERE b."id" = r."id"
      AND r.rn > 1
    RETURNING b."id"
  )
  SELECT count(*) INTO resolved FROM demoted;

  IF resolved > 0 THEN
    RAISE WARNING
      'PAYOUT-IDEMPOTENCY: demoted % duplicate PENDING payout batch row(s) to FAILED (failureReason prefix: duplicate_in_flight_superseded_by_). No rows were deleted and no DriverBalance was touched; the kept batch per driver is the oldest by (createdAt, id). See docs/deployment/runbook.md.',
      resolved;
  END IF;
END $$;

-- The invariant itself. Partial: settled batches (SUCCESS/FAILED) are
-- unlimited per driver — only concurrent un-settled ones are impossible.
CREATE UNIQUE INDEX "DriverPayoutBatch_driverId_pending_key"
  ON "DriverPayoutBatch"("driverId")
  WHERE "status" = 'PENDING';
