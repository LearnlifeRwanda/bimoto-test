-- R3-DELIVERY-NOTIFICATIONS-2 — optional per-recipient language hint on Leg.
-- Customer sets this in GoodsStopEditor when they know the recipient prefers a
-- specific language (e.g. customer speaks French, recipient speaks Kinyarwanda).
-- NULL falls back to the journey customer's User.language at SMS-compose time.

-- AlterTable
ALTER TABLE "Leg" ADD COLUMN "recipientLanguage" "Language";
