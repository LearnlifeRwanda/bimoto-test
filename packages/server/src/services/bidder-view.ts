/**
 * MONEY-VIEW v2 G2 — the curated bidder, in ONE place.
 *
 * A bidding motari's `DriverProfile` row carries three kinds of thing:
 *
 *   1. what a passenger choosing between offers needs — his rating, his
 *      rides, his vehicle, his plate, whether he is verified, his
 *      cooperative, his jacket number;
 *   2. HIS LIVE POSITION — `lastLat`, `lastLng`, `lastLocationAt`;
 *   3. VERIFICATION INTERNALS — `rejectionReason` (why an admin turned
 *      him down, in an admin's words), `revokedAt`, `verifiedAt`, his
 *      licence and insurance photo URLs, and the self-attested
 *      `screener` relation.
 *
 * `getBidsForJourney` has selected only the first kind since DRIVER-ID v3
 * — but `GET /api/journeys/:id` and `GET /api/journeys` reach the same
 * drivers by a different road (`bids: { include: { driver: { include: {
 * driverProfile: true } } } }`) and an `include` returns every column the
 * row has. So a customer's own journey payload carried every bidder's
 * live coordinates and the reason an admin once rejected him, while the
 * route built to answer "who is bidding on me?" carried neither.
 *
 * The field set below is therefore not new. It is the one
 * `getBidsForJourney` already applies, lifted out of that query so the
 * other two exits can apply the SAME one rather than a second copy of it
 * that drifts. Adding a field here adds it everywhere a bidder travels,
 * which is the point: there is one answer to "what does a passenger see
 * of a motari who has bid on her?".
 *
 * CENSUS — every client read of a profile reached through a journey or a
 * bid payload, verified at this head:
 *
 *   avgRating, totalRides            lib/driver-rating.ts (the one shared
 *                                    accessor; MatchedPage, BidListPage,
 *                                    BidPage all go through it)
 *   vehicleType                      MatchedPage:120, ChatPage:30,
 *                                    ActiveRidePage:138, ApproachPage:80
 *   verificationStatus,
 *   ruraAuthorizationNumber          MatchedPage:340-341, ChatPage:118-122
 *                                    (the jacket number renders only for a
 *                                    VERIFIED profile)
 *   vehicleDescription,
 *   registrationPlate,
 *   insuranceConfirmed,
 *   cooperativeName                  the bid list's offer card
 *
 * No client surface reads a field outside this set off a journey or bid
 * payload. (`user.driverProfile` in the auth store is a different source —
 * `GET /api/users/me`, a motari reading his OWN profile — and is not
 * touched by this.)
 */
export const CURATED_BIDDER_PROFILE_SELECT = {
  avgRating: true,
  totalRides: true,
  vehicleType: true,
  vehicleDescription: true,
  registrationPlate: true,
  verificationStatus: true,
  ruraAuthorizationNumber: true,
  insuranceConfirmed: true,
  cooperativeName: true,
} as const;

/**
 * The bidder as a whole, for the two journey reads: who he is, and the
 * curated profile. `id` and `nickname` only — `include: { driver: … }`
 * on the customer list arm was returning the bidder's ENTIRE `User` row.
 */
export const CURATED_BIDDER_SELECT = {
  id: true,
  nickname: true,
  driverProfile: { select: CURATED_BIDDER_PROFILE_SELECT },
} as const;
