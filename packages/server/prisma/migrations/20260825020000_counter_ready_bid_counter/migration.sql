-- COUNTER-READY G1 — one counter-offer per bid, carried on the bid row.
--
-- Additive throughout: one new enum and three new nullable columns on an
-- existing table. Nothing is altered, renamed, dropped or backfilled (0
-- UPDATE statements), so a server running the previous build keeps
-- working against this schema — which is the point, because the code
-- that reads these columns ships DORMANT behind COUNTER_BID_ENABLED and
-- may sit unused on the pilot database for weeks.
--
-- NO DEFAULT, deliberately, on all three: the withdrawnSource convention
-- (Bid.withdrawnSource, schema.prisma) says a column that describes an
-- event only some rows lived through must stay null on the rows that did
-- not. `counterAmountRwf IS NULL` means no counter was ever made, and
-- `counterAmountRwf IS NOT NULL AND counterOutcome IS NULL` means one was
-- made and is still unanswered — the state bid expiry lapses.
--
-- The columns land on Bid rather than in a table of their own so a
-- counter is part of the row the AML graph detectors already read
-- (services/aml/graph-patterns/bid-cycle-ring.ts).

-- CreateEnum
CREATE TYPE "CounterOutcome" AS ENUM ('ACCEPTED', 'DECLINED', 'LAPSED');

-- AlterTable
ALTER TABLE "Bid"
  ADD COLUMN "counterAmountRwf" INTEGER,
  ADD COLUMN "counterAt" TIMESTAMP(3),
  ADD COLUMN "counterOutcome" "CounterOutcome";
