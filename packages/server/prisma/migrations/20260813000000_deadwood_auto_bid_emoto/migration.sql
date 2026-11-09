-- DEADWOOD G4 — one vehicle enum.
--
-- POST/PATCH /api/driver/auto-bid-rules validated vehicleTypeFilter
-- against z.enum(['MOTO','BIKE','EMOTO']) while the shared VehicleType
-- enum — and therefore every Journey.vehiclePreference value the
-- auto-bid evaluator compares against — spells it 'E_MOTO'. The
-- evaluator's comparison is a plain !==, so any rule stored as 'EMOTO'
-- was guaranteed never to match a journey.
--
-- Additive and idempotent: it rewrites only rows carrying the old
-- spelling, and the column is a plain nullable text column, so nothing
-- is dropped, widened or renamed. Rules with any other filter (or
-- NULL, meaning "any vehicle") are untouched. The route continues to
-- ACCEPT 'EMOTO' from a deployed APK and normalise it, so this
-- migration and older clients can coexist.
UPDATE "DriverAutoBidRule"
SET "vehicleTypeFilter" = 'E_MOTO'
WHERE "vehicleTypeFilter" = 'EMOTO';
