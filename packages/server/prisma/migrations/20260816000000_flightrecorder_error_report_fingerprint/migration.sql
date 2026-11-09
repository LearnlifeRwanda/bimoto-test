-- FLIGHT-RECORDER G4 — a grouping key for error reports.
--
-- One crash on one phone is an anecdote; the same crash on forty phones
-- is a dispatch prompt. The admin screen could only ever show the first,
-- because nothing in the row said which reports were the same bug.
--
-- The value is computed by the SERVER on arrival (errorFingerprint in
-- @bimoto/shared), never taken from the client: the upload route already
-- refuses to trust client shape, and a deployed APK that predates this
-- sends no fingerprint at all. Recomputing is the only way old and new
-- clients land in the same grouping.
--
-- Additive and safe on a live table: nullable with no default, so no
-- rewrite and no backfill. Every report stored before this keeps a NULL
-- and is shown as "unfingerprinted" — an honest empty seat, not a
-- retroactive guess about a bundle nobody has re-read.
ALTER TABLE "ErrorReport" ADD COLUMN "fingerprint" TEXT;

-- The grouped read-out counts by this column and filters on it; the
-- index is what keeps that a scan of the group, not of the table.
CREATE INDEX "ErrorReport_fingerprint_idx" ON "ErrorReport"("fingerprint");
