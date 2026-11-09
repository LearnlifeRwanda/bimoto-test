-- R3-LEGS — multi-stop trip foundation.
--
-- Adds the Leg model + LegType + LegStatus enums + Journey.legs
-- relation. Pilot-invisible infrastructure: single-leg journeys (the
-- entirety of pilot v1 traffic) ship with legs: [] and are NOT
-- backfilled. Multi-leg journeys are populated by R3-DELIVERY (sub-case
-- B, customer + parcel multi-stop) and R3-POOL (sub-case C,
-- driver-bundled deliveries).
--
-- Backward-compat invariant: existing journeys have zero rows in this
-- table, so `journey.legs` returns [] for them. No data migration.

-- CreateEnum
CREATE TYPE "LegType" AS ENUM ('PASSENGER_PICKUP', 'PASSENGER_DROPOFF', 'GOODS_PICKUP', 'GOODS_DROPOFF', 'WAIT');

-- CreateEnum
CREATE TYPE "LegStatus" AS ENUM ('PENDING', 'ACTIVE', 'COMPLETED', 'SKIPPED');

-- CreateTable
CREATE TABLE "Leg" (
    "id" UUID NOT NULL,
    "journeyId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "type" "LegType" NOT NULL,
    "status" "LegStatus" NOT NULL DEFAULT 'PENDING',
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "expectedDurationMinutes" INTEGER,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Leg_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Leg_journeyId_sequence_idx" ON "Leg"("journeyId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "Leg_journeyId_sequence_key" ON "Leg"("journeyId", "sequence");

-- AddForeignKey
ALTER TABLE "Leg" ADD CONSTRAINT "Leg_journeyId_fkey" FOREIGN KEY ("journeyId") REFERENCES "Journey"("id") ON DELETE CASCADE ON UPDATE CASCADE;
