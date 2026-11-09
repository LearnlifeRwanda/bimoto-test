-- R3-N-1 — cancel reason taxonomy + asymmetric attribution.
--
-- Adds the CancelReason enum, four new attribution counter fields on
-- User (noShowCount, driverInitiatedCancellationCount, wrongVehicleCount,
-- lateMarkCount), and three new columns on Journey (matchedAt,
-- cancelledAt, cancelReason). Backfills Journey.matchedAt for existing
-- non-pre-MATCHED rows using updatedAt as a best-effort approximation
-- (acceptable for analytics on pre-pilot data).

-- CreateEnum
CREATE TYPE "CancelReason" AS ENUM (
    'CUSTOMER_CHANGED_MIND',
    'DRIVER_NO_SHOW',
    'DRIVER_LATE',
    'DRIVER_WRONG_VEHICLE',
    'SAFETY_CONCERN',
    'CUSTOMER_NO_SHOW',
    'DRIVER_CAN_NOT_MAKE_IT',
    'BOTH_NO_SHOW'
);

-- AlterTable User: new attribution counters
ALTER TABLE "User"
    ADD COLUMN "noShowCount"                      DOUBLE PRECISION NOT NULL DEFAULT 0,
    ADD COLUMN "driverInitiatedCancellationCount" INTEGER          NOT NULL DEFAULT 0,
    ADD COLUMN "wrongVehicleCount"                INTEGER          NOT NULL DEFAULT 0,
    ADD COLUMN "lateMarkCount"                    DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable Journey: new lifecycle timestamps + cancel reason
ALTER TABLE "Journey"
    ADD COLUMN "matchedAt"    TIMESTAMP(3),
    ADD COLUMN "cancelledAt"  TIMESTAMP(3),
    ADD COLUMN "cancelReason" "CancelReason";

-- Backfill Journey.matchedAt for existing rows that have already
-- progressed past REQUESTED. updatedAt is the closest pre-existing
-- proxy for "when this journey transitioned to MATCHED". Slight drift
-- is acceptable since the data is pre-pilot.
UPDATE "Journey"
SET "matchedAt" = "updatedAt"
WHERE "status" IN (
    'MATCHED',
    'IN_PROGRESS',
    'AWAITING_CONFIRMATION',
    'COMPLETED',
    'CANCELLED',
    'INTERRUPTED',
    'DISPUTED',
    'EXPIRED'
)
AND "driverId" IS NOT NULL;
