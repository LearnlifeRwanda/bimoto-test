-- PAYOUT-E: timestamp payout reversals.
--
-- markBatchTransferReversed flips a batch SUCCESS -> FAILED when the gateway
-- reports a bounce after settlement, but until now recorded no reversal
-- instant, so the admin "reversals last 7d" tile anchored its window on
-- paidOutAt (an approximation). Nullable, no default, no backfill: historical
-- reversals keep the paidOutAt approximation (the summary route falls back to
-- it for rows where reversedAt IS NULL).
ALTER TABLE "DriverPayoutBatch" ADD COLUMN "reversedAt" TIMESTAMP(3);
