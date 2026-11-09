-- R3-RECIPIENT-CONFIRM-2 — auto-confirm timeout + dispute flow.
--
-- Closes the two operational gaps left by R3-RECIPIENT-CONFIRM:
--   1. Recipients who never reply leave the customer in indefinite "no
--      confirmation" state. New auto-confirm-recipient cron stamps
--      recipientConfirmStatus = AUTO_TIMEOUT after 24h.
--   2. Recipients who got the wrong/damaged parcel had no in-pipeline way
--      to signal it. New recipient-dispute SMS handler stamps
--      recipientConfirmStatus = DISPUTED + preserves the SMS body in
--      recipientDisputeReason.
--
-- Three changes:
--   1. Create RecipientConfirmStatus enum (EXPLICIT_REPLY / AUTO_TIMEOUT /
--      DISPUTED). Legacy R3-RECIPIENT-CONFIRM rows that already have
--      recipientConfirmedAt set keep status = NULL — the customer-side UI
--      renders null status with non-null confirmedAt as "EXPLICIT_REPLY
--      (legacy)" (data-layer additive-only invariant: no backfill).
--   2. Extend SmsInboundIntent enum with RECIPIENT_DISPUTE (positioned
--      after RECIPIENT_CONFIRM for dispatch ordering).
--   3. Add Leg.recipientConfirmStatus + Leg.recipientDisputeReason
--      (both nullable).
--
-- Backward-compat invariant: existing rows are valid as-is (both new
-- columns are nullable). 0 INSERT statements per the §8 data-layer
-- additive-only invariant.

-- CreateEnum
CREATE TYPE "RecipientConfirmStatus" AS ENUM ('EXPLICIT_REPLY', 'AUTO_TIMEOUT', 'DISPUTED');

-- AlterEnum
ALTER TYPE "SmsInboundIntent" ADD VALUE 'RECIPIENT_DISPUTE' AFTER 'RECIPIENT_CONFIRM';

-- AlterTable
ALTER TABLE "Leg" ADD COLUMN "recipientConfirmStatus" "RecipientConfirmStatus";
ALTER TABLE "Leg" ADD COLUMN "recipientDisputeReason" TEXT;
