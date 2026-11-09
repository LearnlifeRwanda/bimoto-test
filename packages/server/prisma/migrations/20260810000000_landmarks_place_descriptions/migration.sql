-- LANDMARKS G4: the passenger's own words about a place travel with the
-- request.
--
-- Kigali is not addressed by street, and the landmark catalog only covers
-- the places a public map knows. For everything else the passenger says
-- where it is — "Kuwa Mudugudu", "behind the blue gate", "the house past
-- the Zion Temple turnoff" — and the motari reads it on the bid, on the
-- approach and on the confirmation.
--
-- Purely additive and nullable: no existing row is touched, every existing
-- journey keeps a NULL in both columns, and a server running this schema
-- accepts bodies from clients that have never heard of these fields. The
-- 200-character cap matches the shared createJourneySchema.

ALTER TABLE "Journey" ADD COLUMN "pickupDescription" VARCHAR(200);
ALTER TABLE "Journey" ADD COLUMN "destinationDescription" VARCHAR(200);
