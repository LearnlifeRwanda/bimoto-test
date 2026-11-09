-- PARCEL-CATEGORY — the send-a-package form gets the same contents
-- question the drop-a-package leg flow already asks.
--
-- Adds a nullable parcelCategory column on Journey, reusing the
-- ParcelCategory enum created by 20260510170000_r3_delivery_v2_parcel_category
-- for Leg. No new enum, no new values: Faustin's list (Food, Documents,
-- Electronics, Fragile, Other) is exactly the enum that already exists.
--
-- Nullable because every parcel row in the database predates the
-- question — NULL means "was never asked", which is a different answer
-- from OTHER. The customer-facing form defaults to OTHER on submit, so
-- rows created after this dispatch are non-NULL in practice.
--
-- Backward-compat invariant: existing rows get NULL automatically. No
-- data migration required (0 INSERT statements).

-- AlterTable
ALTER TABLE "Journey" ADD COLUMN "parcelCategory" "ParcelCategory";
