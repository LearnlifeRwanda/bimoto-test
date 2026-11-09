-- OUTBOX G2 — make POST /api/journeys idempotent for the offline outbox.
--
-- A booking made with no signal is held on the phone and re-sent when the
-- signal returns. The failure that makes that dangerous is not the request
-- that never arrived; it is the one that arrived, wrote its row, and whose
-- 201 died on the way back. The phone cannot tell those apart, so it
-- re-sends — and without a name for the attempt, that is a second ride.
--
-- Additive and safe on a live table: the column is nullable with no
-- default (no rewrite, no backfill), and in Postgres NULLs never collide
-- in a unique index, so every journey booked before this — and every
-- create from a client that does not send the field — is unaffected.
ALTER TABLE "Journey" ADD COLUMN "clientRequestId" UUID;

CREATE UNIQUE INDEX "Journey_customerId_clientRequestId_key"
  ON "Journey"("customerId", "clientRequestId");
