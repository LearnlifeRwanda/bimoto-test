-- PILOT-INSTRUMENT G1: pickup-identity verification capture (the V-4
-- evidence trigger).
--
-- PickupVerification: at most one row per journey — the customer's
-- answer to "Is this your driver? (jacket #NNNN)" when the driver
-- arrives at pickup. Evidence only: no code path may freeze, flag,
-- cancel, or notify off this table. It exists so the pilot can measure
-- the pickup-mismatch rate and decide whether the per-ride dynamic
-- QR/PIN second factor (V-4) is needed.
--
-- Purely additive; no existing table or row is touched.

-- CreateEnum
CREATE TYPE "PickupOutcome" AS ENUM ('MATCHED', 'MISMATCH', 'UNSURE');

-- CreateTable
CREATE TABLE "PickupVerification" (
    "id" UUID NOT NULL,
    "journeyId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "outcome" "PickupOutcome" NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PickupVerification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PickupVerification_journeyId_key" ON "PickupVerification"("journeyId");

-- CreateIndex
CREATE INDEX "PickupVerification_outcome_createdAt_idx" ON "PickupVerification"("outcome", "createdAt");

-- CreateIndex
CREATE INDEX "PickupVerification_createdAt_idx" ON "PickupVerification"("createdAt");

-- AddForeignKey
ALTER TABLE "PickupVerification" ADD CONSTRAINT "PickupVerification_journeyId_fkey" FOREIGN KEY ("journeyId") REFERENCES "Journey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickupVerification" ADD CONSTRAINT "PickupVerification_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
