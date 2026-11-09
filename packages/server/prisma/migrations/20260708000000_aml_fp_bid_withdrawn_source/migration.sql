-- AML-FP G4: bid-withdrawal provenance (third schema change of the July record).
--
-- The bid-cycle-ring detector counts ACCEPTED -> WITHDRAWN churn as a
-- collusion signature, but server machinery and human drivers were
-- indistinguishable in the data. Adds BidWithdrawnSource (USER | SYSTEM)
-- and a nullable Bid.withdrawnSource stamped at every WITHDRAWN write.
-- Nullable, no default, no index, no backfill: legacy rows stay null and
-- deliberately keep counting in the detector (it must not go blind on
-- pre-migration data).

-- CreateEnum
CREATE TYPE "BidWithdrawnSource" AS ENUM ('USER', 'SYSTEM');

-- AlterTable
ALTER TABLE "Bid" ADD COLUMN "withdrawnSource" "BidWithdrawnSource";
