-- PAYOUT-F: both schema changes for this dispatch live in one migration.
--
-- 1. JobLease — expiry-based single-runner leases for the long calendar
--    jobs (withJobLease in services/job-lock.ts). Unlike the advisory
--    xact lock, a lease does not hold a database transaction open for
--    the job's whole runtime; a crashed holder is healed by expiry.
-- 2. GpsPoint("timestamp") index — the nightly GPS retention sweep
--    (jobs/gps-retention.job.ts) deletes by "timestamp" < cutoff; the
--    existing composite (journeyId, timestamp) index cannot serve a
--    pure timestamp predicate efficiently.

-- CreateTable
CREATE TABLE "JobLease" (
    "name" TEXT NOT NULL,
    "holder" TEXT NOT NULL,
    "acquiredAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobLease_pkey" PRIMARY KEY ("name")
);

-- CreateIndex
CREATE INDEX "GpsPoint_timestamp_idx" ON "GpsPoint"("timestamp");
