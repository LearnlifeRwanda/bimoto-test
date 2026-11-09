-- R3-SYNC-REJECTION-MODEL — persist server-side sync rejections so the funnel
-- offline-sync-success metric becomes diagnostic. Closes GAP-P24 created in
-- R3-FUNNEL-METRICS-DASHBOARD (PR #65).
--
-- Purely additive: one new enum + one new table + two indexes + one FK.
-- No ALTER on SyncEvent, no ALTER on User columns (only the back-relation
-- is added on the Prisma side; PostgreSQL needs no schema change for that).
-- 0 INSERT statements per the data-layer additive-only invariant.

-- CreateEnum
CREATE TYPE "SyncRejectionCode" AS ENUM ('FK_VIOLATION', 'DUPLICATE_EVENT_ID', 'VALIDATION_ERROR', 'STALE_TIMESTAMP', 'PERMISSION_DENIED', 'UNKNOWN');

-- CreateTable
CREATE TABLE "SyncRejection" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "clientEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "rejectionCode" "SyncRejectionCode" NOT NULL,
    "rejectionMessage" TEXT NOT NULL,
    "payloadSummary" TEXT,
    "serverTimestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncRejection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SyncRejection_serverTimestamp_idx" ON "SyncRejection"("serverTimestamp");

-- CreateIndex
CREATE INDEX "SyncRejection_userId_serverTimestamp_idx" ON "SyncRejection"("userId", "serverTimestamp");

-- AddForeignKey
ALTER TABLE "SyncRejection" ADD CONSTRAINT "SyncRejection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
