-- R3-N-2 — auto-timeout cron idempotency field.
--
-- Adds noShowReminderSentAt: nullable DateTime on Journey. The
-- no-show-timeout cron (packages/server/src/jobs/no-show-timeout.job.ts)
-- sets this column when it sends the 20-min push reminder so the next
-- cron tick does not re-push the same journey. Existing rows backfill
-- to NULL — semantically correct: NULL means "no reminder sent yet for
-- this matched journey".

ALTER TABLE "Journey"
    ADD COLUMN "noShowReminderSentAt" TIMESTAMP(3);
