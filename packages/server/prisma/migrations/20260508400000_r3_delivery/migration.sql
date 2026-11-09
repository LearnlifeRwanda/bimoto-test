-- R3-DELIVERY — parcel size for goods stops + 4th compositional fare axis.
--
-- Adds the ParcelSize enum and a nullable parcelSize column on Leg.
-- Non-goods legs (PASSENGER_PICKUP/DROPOFF/WAIT) keep parcelSize: null;
-- goods legs (GOODS_PICKUP/GOODS_DROPOFF) require it (enforced at the
-- service layer in validateLegSequence). The fare composition picks up
-- the largest parcelSize across a journey's goods legs and applies it
-- via parcelMultiplier in fair-price.service.ts.
--
-- Backward-compat invariant: existing legs (none in pilot v1 traffic
-- to date — R3-LEGS just shipped) get NULL automatically. No data
-- migration required.

-- CreateEnum
CREATE TYPE "ParcelSize" AS ENUM ('SMALL', 'MEDIUM', 'LARGE');

-- AlterTable
ALTER TABLE "Leg" ADD COLUMN "parcelSize" "ParcelSize";
