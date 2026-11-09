-- R3-RECIPIENT-CONFIRM — recipient SMS-reply confirmation loop.
--
-- Closes the parcel-delivery trust circle. R3-DELIVERY-NOTIFICATIONS sends a
-- "your parcel has been delivered" SMS to recipients; this dispatch wires the
-- inbound side: when the recipient SMS-replies with a confirmation keyword
-- (RECEIVED, OK, MURAKOZE, NABONYE, …), the existing sms-inbound pipeline
-- routes to a new recipient-confirm handler that matches the inbound phone
-- against recently-completed GOODS_DROPOFF legs (via Leg.contactPhone) and
-- stamps recipientConfirmedAt. The customer sees a "Recipient confirmed
-- receipt" badge on their journey progress page.
--
-- Two changes:
--   1. Extend SmsInboundIntent enum with RECIPIENT_CONFIRM (positioned after
--      BALANCE_QUERY for dispatch ordering — see §2 Group A).
--   2. Add Leg.recipientConfirmedAt (nullable timestamp). NULL for legacy
--      rows and unconfirmed deliveries.
--
-- Backward-compat invariant: existing rows are valid as-is (new column is
-- nullable). 0 INSERT statements per the §8 data-layer additive-only invariant.

-- AlterEnum
ALTER TYPE "SmsInboundIntent" ADD VALUE 'RECIPIENT_CONFIRM' AFTER 'BALANCE_QUERY';

-- AlterTable
ALTER TABLE "Leg" ADD COLUMN "recipientConfirmedAt" TIMESTAMP(3);
