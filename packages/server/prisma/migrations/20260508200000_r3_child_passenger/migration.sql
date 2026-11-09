-- R3-CHILD — child-passenger declaration foundation.
--
-- Adds 5 fields to the Journey model that capture the customer's
-- declaration of a child passenger at booking time:
--   - hasChildPassenger (Boolean): drives the 1.1x CHILD_PASSENGER
--     multiplier in fair-price.service.ts and the <ChildPassengerBadge>
--     surface on the driver UX.
--   - childAgeYears (Int?): used by the booking-validator to gate the
--     trip against placeholder legal thresholds (MIN_AGE_MOTO_PASSENGER
--     etc.) — TODO(legal-research) for authoritative numbers.
--   - childIsUnaccompaniedMinor (Boolean): pilot v1 always blocks
--     these; field is reserved for the unaccompanied-minor pipeline.
--   - childGuardianPhone (String?): captured for the unaccompanied
--     minor flow; SMS pipeline integration deferred.
--   - childPassengerHelmetConfirmed (Boolean): customer-side declaration
--     that they will provide a child-sized helmet on MOTO/E_MOTO trips.
--
-- All fields are non-load-bearing in their numerical defaults: the
-- thresholds live in services/child-safety/legal-thresholds.ts and
-- can be recalibrated without a schema or code change.
ALTER TABLE "Journey"
  ADD COLUMN "hasChildPassenger" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "childAgeYears" INTEGER,
  ADD COLUMN "childIsUnaccompaniedMinor" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "childGuardianPhone" TEXT,
  ADD COLUMN "childPassengerHelmetConfirmed" BOOLEAN NOT NULL DEFAULT false;
