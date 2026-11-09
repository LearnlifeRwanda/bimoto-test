-- R3-DELIVERY-V2 — parcel content category for goods stops.
--
-- Adds the ParcelCategory enum and a nullable parcelCategory column on
-- Leg. The customer-facing UI defaults to OTHER on submit so new goods
-- legs are non-NULL in practice; legacy rows created before this
-- dispatch carry NULL. Forbidden on non-goods legs at the service
-- layer (PARCEL_CATEGORY_ON_NON_GOODS_LEG).
--
-- Backward-compat invariant: existing rows get NULL automatically. No
-- data migration required (0 INSERT statements per the §8 dispatch
-- invariant).

-- CreateEnum
CREATE TYPE "ParcelCategory" AS ENUM ('FOOD', 'ELECTRONICS', 'DOCUMENTS', 'FRAGILE', 'OTHER');

-- AlterTable
ALTER TABLE "Leg" ADD COLUMN "parcelCategory" "ParcelCategory";
