-- R3-DRIVER-SCREENER — in-app driver screener: one new table, four new
-- enums, two FKs (DriverProfile, Cooperative), three indexes. Closes
-- the funnel-metrics stub at funnel-metrics.service.ts:370-372 by
-- giving the "Screener-qualified" stage a real data source.
--
-- Purely additive: no ALTER on existing tables (DriverProfile gets a
-- back-relation only on the Prisma side; PostgreSQL needs no schema
-- change for that). Zero INSERT statements per the data-layer
-- additive-only invariant.

-- CreateEnum
CREATE TYPE "ScreenerLicenceStatus" AS ENUM ('YES', 'IN_PROGRESS', 'NO');

-- CreateEnum
CREATE TYPE "ScreenerRuraStatus" AS ENUM ('HAVE', 'APPLYING', 'NOT_YET');

-- CreateEnum
CREATE TYPE "ScreenerEligibilityResult" AS ENUM ('ELIGIBLE', 'INELIGIBLE', 'NEEDS_FOLLOW_UP');

-- CreateEnum
CREATE TYPE "ScreenerIneligibilityReason" AS ENUM ('UNDER_18', 'NO_DRIVERS_LICENCE', 'NEEDS_RURA_PATH', 'LOW_AVAILABILITY');

-- CreateTable
CREATE TABLE "DriverScreener" (
    "id" TEXT NOT NULL,
    "driverProfileId" UUID NOT NULL,
    "is18OrOlder" BOOLEAN NOT NULL,
    "holdsDriversLicence" "ScreenerLicenceStatus" NOT NULL,
    "hasRuraAuthorisation" "ScreenerRuraStatus" NOT NULL,
    "primaryVehicleType" "VehicleType" NOT NULL,
    "cooperativeId" TEXT,
    "cooperativeNameProvided" TEXT,
    "primaryCityBand" TEXT NOT NULL,
    "weeklyAvailabilityHours" INTEGER NOT NULL,
    "priorPlatformExperience" BOOLEAN NOT NULL,
    "priorPlatformMonths" INTEGER,
    "eligibilityResult" "ScreenerEligibilityResult" NOT NULL,
    "ineligibilityReason" "ScreenerIneligibilityReason",
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DriverScreener_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DriverScreener_driverProfileId_key" ON "DriverScreener"("driverProfileId");

-- CreateIndex
CREATE INDEX "DriverScreener_eligibilityResult_idx" ON "DriverScreener"("eligibilityResult");

-- CreateIndex
CREATE INDEX "DriverScreener_primaryCityBand_idx" ON "DriverScreener"("primaryCityBand");

-- CreateIndex
CREATE INDEX "DriverScreener_completedAt_idx" ON "DriverScreener"("completedAt");

-- AddForeignKey
ALTER TABLE "DriverScreener" ADD CONSTRAINT "DriverScreener_driverProfileId_fkey" FOREIGN KEY ("driverProfileId") REFERENCES "DriverProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverScreener" ADD CONSTRAINT "DriverScreener_cooperativeId_fkey" FOREIGN KEY ("cooperativeId") REFERENCES "Cooperative"("id") ON DELETE SET NULL ON UPDATE CASCADE;
