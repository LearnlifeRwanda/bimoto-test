-- DRIVER-ID v3 G1: person-based, revocable driver identity foundations.
--
-- All additive. Four pieces:
--   1. VerificationStatus gains REVOKED — the terminal identity state.
--      Distinct from freeze (money, User.frozenAt) and suspension
--      (behaviour, User.suspendedUntil); the only exit is re-application
--      (REVOKED -> PENDING via the driver-verification submission flow).
--   2. AdminActionType gains REVOKE_DRIVER for the hash-chained audit row
--      every revocation must write.
--   3. DriverProfile.revokedAt mirrors the REVOKED state; the permanent
--      record is the AdminAction row, not this column.
--   4. ruraAuthorizationNumber becomes UNIQUE so the public validity
--      lookup resolves to exactly one driver. Postgres unique indexes
--      permit multiple NULLs — legacy rows without a number are
--      unaffected.
--   5. VehicleChangeLog: append-only old->new ledger of self-service
--      vehicle changes (the person is the identity; the motorcycle is a
--      mutable, honestly-tracked attribute). The account-deletion
--      anonymization write deliberately does not log here.

-- AlterEnum
ALTER TYPE "VerificationStatus" ADD VALUE 'REVOKED';

-- AlterEnum
ALTER TYPE "AdminActionType" ADD VALUE 'REVOKE_DRIVER';

-- AlterTable
ALTER TABLE "DriverProfile" ADD COLUMN "revokedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "DriverProfile_ruraAuthorizationNumber_key" ON "DriverProfile"("ruraAuthorizationNumber");

-- CreateTable
CREATE TABLE "VehicleChangeLog" (
    "id" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "oldVehicleType" "VehicleType" NOT NULL,
    "newVehicleType" "VehicleType" NOT NULL,
    "oldPlate" TEXT,
    "newPlate" TEXT,
    "oldDescription" TEXT NOT NULL,
    "newDescription" TEXT NOT NULL,

    CONSTRAINT "VehicleChangeLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VehicleChangeLog_driverId_changedAt_idx" ON "VehicleChangeLog"("driverId", "changedAt");

-- AddForeignKey
ALTER TABLE "VehicleChangeLog" ADD CONSTRAINT "VehicleChangeLog_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
