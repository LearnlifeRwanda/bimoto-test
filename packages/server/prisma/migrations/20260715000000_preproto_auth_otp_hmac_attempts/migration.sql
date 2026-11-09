-- PREPROTO-AUTH G1: OTP hardening (adversarial review #1/#7/#11).
--
--   1. attemptCount — per-code wrong-guess counter; the verify path kills
--      the code once it crosses OTP_MAX_ATTEMPTS (G2).
--   2. `code` column semantics change: it now stores hmacOtp(plaintext)
--      (HMAC-SHA256 keyed by OTP_HMAC_KEY / ENCRYPTION_KEY), never the
--      SMS code itself. Existing plaintext rows can no longer match an
--      HMAC comparison, so any in-flight unused codes are marked used —
--      users just request a fresh code (codes live 5–10 min anyway).
--   3. Index swap: verification no longer filters on `code` (the HMAC is
--      compared constant-time in application code), so the
--      (phoneHash, code) index is replaced by the shape the new lookup
--      query actually uses.

-- AlterTable
ALTER TABLE "OtpCode" ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0;

-- Invalidate in-flight plaintext codes (see 2. above).
UPDATE "OtpCode" SET "used" = true WHERE "used" = false;

-- DropIndex
DROP INDEX IF EXISTS "OtpCode_phoneHash_code_idx";

-- CreateIndex
CREATE INDEX "OtpCode_phoneHash_purpose_used_expiresAt_idx" ON "OtpCode"("phoneHash", "purpose", "used", "expiresAt");
