-- LAUNCH-TRUTH G1: pilot fee-waiver instruments (12 lifetime / 500 temporary).
--
-- All additive. Four pieces:
--   1. FeeWaiverType enum — LIFETIME (pre-prototype test drivers,
--      never expires) and TEMPORARY (6 months, extendable to 12 total).
--   2. AdminActionType gains GRANT_FEE_WAIVER / EXTEND_FEE_WAIVER /
--      REVOKE_FEE_WAIVER for the hash-chained audit row every waiver
--      action must write.
--   3. FeeWaiver: one audited grant per waived driver, keyed on
--      User.id (the money path keys on the user). Partial unique index
--      enforces at most one non-revoked waiver per driver — Prisma
--      cannot express partial indexes, so it lives here as raw SQL and
--      is re-checked in the grant service.
--   4. Escrow gains waivedCommissionAmount + feeWaiverId — the
--      compute-then-zero record: commission stays the CHARGED amount
--      (0 when waived); waivedCommissionAmount records what the nominal
--      tier rate would have charged. ON DELETE RESTRICT: a waiver that
--      zeroed real money can never be deleted from under its escrows.

-- CreateEnum
CREATE TYPE "FeeWaiverType" AS ENUM ('LIFETIME', 'TEMPORARY');

-- AlterEnum
ALTER TYPE "AdminActionType" ADD VALUE 'GRANT_FEE_WAIVER';
ALTER TYPE "AdminActionType" ADD VALUE 'EXTEND_FEE_WAIVER';
ALTER TYPE "AdminActionType" ADD VALUE 'REVOKE_FEE_WAIVER';

-- CreateTable
CREATE TABLE "FeeWaiver" (
    "id" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "type" "FeeWaiverType" NOT NULL,
    "campaign" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grantedBy" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "extensionCount" INTEGER NOT NULL DEFAULT 0,
    "revokedAt" TIMESTAMP(3),
    "revokedBy" UUID,
    "reason" TEXT NOT NULL,

    CONSTRAINT "FeeWaiver_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FeeWaiver_driverId_revokedAt_idx" ON "FeeWaiver"("driverId", "revokedAt");

-- CreateIndex
CREATE INDEX "FeeWaiver_type_revokedAt_idx" ON "FeeWaiver"("type", "revokedAt");

-- Partial unique index: at most one non-revoked waiver per driver.
CREATE UNIQUE INDEX "FeeWaiver_one_nonrevoked_per_driver" ON "FeeWaiver"("driverId") WHERE "revokedAt" IS NULL;

-- AddForeignKey
ALTER TABLE "FeeWaiver" ADD CONSTRAINT "FeeWaiver_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "Escrow" ADD COLUMN "waivedCommissionAmount" INTEGER,
ADD COLUMN "feeWaiverId" UUID;

-- CreateIndex
CREATE INDEX "Escrow_feeWaiverId_idx" ON "Escrow"("feeWaiverId");

-- AddForeignKey
ALTER TABLE "Escrow" ADD CONSTRAINT "Escrow_feeWaiverId_fkey" FOREIGN KEY ("feeWaiverId") REFERENCES "FeeWaiver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
