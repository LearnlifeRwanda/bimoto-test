-- MONEY-PIN G1 — the money-surface PIN and its delayed-reset pair.
--
-- Founder ruling D25: a motari's balance and payout settings sit behind a
-- four-digit number only he knows. Five additive, nullable/defaulted
-- columns on User; no table is created, no column is dropped, no row is
-- written (0 INSERT/UPDATE statements).
--
-- BACKWARD-COMPAT INVARIANT. Every existing user gets moneyPinHash NULL,
-- which is exactly the state the enrollment gate reads as "has not set
-- one yet" — the LAZY enrollment D25 ruled for. Nobody is locked out by
-- this migration; the first money-surface visit is what asks.
--
-- moneyPinHash holds hmacOtp(pin) and never a plaintext PIN, following
-- OtpCode.code (PREPROTO-AUTH G1). The pending pair carries a reset that
-- has been proven by SMS OTP but is not yet live: it activates 24 hours
-- after it was requested, and a verify with the OLD pin inside that
-- window clears it. Storing the activation as a timestamp rather than a
-- flag means no job has to run for the window to elapse.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "moneyPinHash" TEXT;
ALTER TABLE "User" ADD COLUMN "moneyPinPendingHash" TEXT;
ALTER TABLE "User" ADD COLUMN "moneyPinPendingActivatesAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "moneyPinAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "moneyPinLockedUntil" TIMESTAMP(3);
