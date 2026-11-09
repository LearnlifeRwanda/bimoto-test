-- FIELD-FIT G5 — declared parcel weight, in kilograms.
--
-- Nullable and with no default: the field is optional on create, and
-- every journey booked before it existed simply has no value. Nothing
-- reads it as a number without a null check.
ALTER TABLE "Journey" ADD COLUMN "goodsWeightKg" DOUBLE PRECISION;
