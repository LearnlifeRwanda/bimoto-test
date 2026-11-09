-- R3-T — URGENT_MESSENGER trip type + target completion window.
--
-- Adds the third pilot use case alongside PASSENGER and GOODS:
-- urgent goods delivery with cascade bypass (broadcast to every
-- eligible driver immediately at max radius), 1.3x urgency premium
-- on top of the R3-V vehicle-type multiplier, and a 30-min target
-- completion window stamped at acceptBid as matchedAt + 30 min.
ALTER TYPE "JourneyType" ADD VALUE 'URGENT_MESSENGER';

ALTER TABLE "Journey"
  ADD COLUMN "targetCompletionAt" TIMESTAMP(3);
