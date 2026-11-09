-- MONEY-PIN G2 — the audit row records WHICH proof gated the change.
--
-- Ruling D25 replaced the SMS step-up on the payout-preference change
-- with the money PIN. PayoutPreferenceChangeLog.otpVerified could only
-- ever say `true`, so once PIN-gated rows exist the column becomes a lie
-- unless the row says which method was actually given.
--
-- otpVerified IS DELIBERATELY KEPT rather than folded into the new
-- column. Every row written before this migration recorded an SMS OTP,
-- and a historical audit row must not change meaning because a later
-- dispatch added a second method. OTP-arm rows keep setting it; PIN-arm
-- rows leave it false and carry stepUpMethod = 'PIN'.
--
-- The DEFAULT is 'OTP' precisely so the backfill is the truth: every
-- existing row WAS an OTP step-up. No data migration is required and no
-- row is rewritten (0 UPDATE statements).

-- CreateEnum
CREATE TYPE "StepUpMethod" AS ENUM ('OTP', 'PIN');

-- AlterTable
ALTER TABLE "PayoutPreferenceChangeLog"
  ADD COLUMN "stepUpMethod" "StepUpMethod" NOT NULL DEFAULT 'OTP';
