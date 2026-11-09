-- LIVE-WIRE G5 — Jean's item 13(c): an optional 1/2/3-hour delivery
-- window for STANDARD parcels. Additive and nullable: every existing
-- row keeps NULL, which is the meaningful "no window asked for" state,
-- and no fare anywhere reads this column.
ALTER TABLE "Journey" ADD COLUMN "standardDeliveryHours" INTEGER;
