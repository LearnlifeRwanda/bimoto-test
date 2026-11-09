-- R3-N-4 — driver no-show dispute + redispatch lineage + graduated suspension.
--
-- Three additive concerns wrapped in one migration so they land
-- together with the §2B conflict module + §2C dispute endpoint +
-- §2D penalty thresholds + §2E redispatch endpoint:
--
--   1. ConflictType.DRIVER_NO_SHOW_DISPUTE — new admin conflict for
--      drivers who believe their no-show attribution was wrong.
--   2. AdminActionType.RESOLVE_DRIVER_NO_SHOW_DISPUTE — paired audit
--      action emitted by the conflict module's decide() path.
--   3. Journey.driverDisputedAt — set by POST /dispute-no-show.
--   4. Journey.redispatchedFromId — set on the fresh journey created
--      by POST /redispatch; nullable + SET NULL on parent delete so
--      lineage is best-effort historical data.
--   5. User.suspendedUntil — set by applyDriverPenaltyForNoShow at
--      the SUSPENSION_24H_THRESHOLD; bid.service rejects bids while
--      now() < suspendedUntil.
--
-- All columns are nullable / additive — no backfill needed.

-- AlterEnum: ConflictType
ALTER TYPE "ConflictType" ADD VALUE 'DRIVER_NO_SHOW_DISPUTE';

-- AlterEnum: AdminActionType
ALTER TYPE "AdminActionType" ADD VALUE 'RESOLVE_DRIVER_NO_SHOW_DISPUTE';

-- AlterTable Journey: dispute timestamp + redispatch lineage
ALTER TABLE "Journey"
    ADD COLUMN "driverDisputedAt"   TIMESTAMP(3),
    ADD COLUMN "redispatchedFromId" UUID;

-- Self-referential FK with SET NULL so deleting an old journey does
-- not orphan the redispatch row's discoverability.
ALTER TABLE "Journey"
    ADD CONSTRAINT "Journey_redispatchedFromId_fkey"
        FOREIGN KEY ("redispatchedFromId")
        REFERENCES "Journey"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Journey_redispatchedFromId_idx" ON "Journey"("redispatchedFromId");
CREATE INDEX "Journey_driverDisputedAt_idx"   ON "Journey"("driverDisputedAt");

-- AlterTable User: graduated suspension end timestamp
ALTER TABLE "User"
    ADD COLUMN "suspendedUntil" TIMESTAMP(3);
