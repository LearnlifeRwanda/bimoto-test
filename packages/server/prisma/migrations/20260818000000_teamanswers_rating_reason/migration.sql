-- TEAM-ANSWERS G2 (OPEN DECISIONS item 15) — a low passenger rating may
-- optionally carry a reason key. Additive and nullable: existing rows are
-- untouched and keep meaning exactly what they meant.
ALTER TABLE "Rating" ADD COLUMN "reason" TEXT;
