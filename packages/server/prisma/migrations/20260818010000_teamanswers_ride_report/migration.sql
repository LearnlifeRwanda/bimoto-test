-- TEAM-ANSWERS G3 (OPEN DECISIONS item 15, driver side) — the driver's
-- incident report about a finished ride, and the tenth conflict type
-- that carries it into the existing admin review machinery.
--
-- Additive throughout: two new enum members and one new table. Nothing
-- existing changes shape or meaning.

ALTER TYPE "ConflictType" ADD VALUE 'RIDE_REPORT';
ALTER TYPE "AdminActionType" ADD VALUE 'RESOLVE_RIDE_REPORT';

CREATE TABLE "RideReport" (
    "id" UUID NOT NULL,
    "journeyId" UUID NOT NULL,
    "reporterId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "details" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RideReport_pkey" PRIMARY KEY ("id")
);

-- One report per journey per driver: a report is a single statement
-- about a single ride, not a counter anyone can run up.
CREATE UNIQUE INDEX "RideReport_journeyId_reporterId_key" ON "RideReport"("journeyId", "reporterId");
CREATE INDEX "RideReport_createdAt_idx" ON "RideReport"("createdAt");

ALTER TABLE "RideReport" ADD CONSTRAINT "RideReport_journeyId_fkey" FOREIGN KEY ("journeyId") REFERENCES "Journey"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RideReport" ADD CONSTRAINT "RideReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
