-- SOS-FOLLOW G2 — an emergency becomes a state.
--
-- Additive throughout: one new enum, one new table, one new
-- AdminActionType member. Nothing existing is altered or dropped, so
-- the deployed server keeps working against this schema until the code
-- that reads the table ships alongside it.

-- The three states an emergency can be in. There is no fourth: an alert
-- is live, a person closed it, or the 60-minute valve closed it.
CREATE TYPE "EmergencyAlertStatus" AS ENUM ('ACTIVE', 'RESOLVED', 'EXPIRED');

-- SOS-FOLLOW G3 — the audit action an admin resolve writes into the
-- appendAdminActionTx hash chain, following the RESOLVE_* convention of
-- every conflict decision already in the enum.
ALTER TYPE "AdminActionType" ADD VALUE 'RESOLVE_EMERGENCY_ALERT';

CREATE TABLE "EmergencyAlert" (
    "id" UUID NOT NULL,
    "journeyId" UUID NOT NULL,
    "raisedById" UUID NOT NULL,
    "raisedByRole" TEXT NOT NULL,
    "pressLat" DOUBLE PRECISION,
    "pressLng" DOUBLE PRECISION,
    "status" "EmergencyAlertStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" UUID,
    "resolveNote" TEXT,

    CONSTRAINT "EmergencyAlert_pkey" PRIMARY KEY ("id")
);

-- Serves the ops ACTIVE list and the GPS retention hold's NOT EXISTS.
CREATE INDEX "EmergencyAlert_status_createdAt_idx" ON "EmergencyAlert"("status", "createdAt");

-- Serves the press handler's "is there already an ACTIVE row for this
-- journey" lookup and the ops history tab's per-journey read.
CREATE INDEX "EmergencyAlert_journeyId_createdAt_idx" ON "EmergencyAlert"("journeyId", "createdAt");

-- ONE ACTIVE ROW PER JOURNEY, in the database rather than in a hope.
--
-- Prisma's schema language cannot express a partial unique index, so
-- this is raw SQL here and a find-then-create in the press handler —
-- exactly the shape LAUNCH-TRUTH used for the fee waiver
-- ("FeeWaiver_one_nonrevoked_per_driver", 20260713000000). Repeated
-- presses on one journey are the same emergency, and two ACTIVE rows
-- would mean two follow permissions and two things for ops to close.
CREATE UNIQUE INDEX "EmergencyAlert_one_active_per_journey" ON "EmergencyAlert"("journeyId") WHERE "status" = 'ACTIVE';

ALTER TABLE "EmergencyAlert" ADD CONSTRAINT "EmergencyAlert_journeyId_fkey" FOREIGN KEY ("journeyId") REFERENCES "Journey"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmergencyAlert" ADD CONSTRAINT "EmergencyAlert_raisedById_fkey" FOREIGN KEY ("raisedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmergencyAlert" ADD CONSTRAINT "EmergencyAlert_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
