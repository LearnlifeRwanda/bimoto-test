// TYPES/RATING.TS
//
// TEAM-ANSWERS (OPEN DECISIONS item 15, Kigali team, 18 August) — a
// rating is one direction only: the passenger about the driver.
//
// The team asked for the low-star reason dropdown, and for both sides
// to be able to raise issues. The reason dropdown ships as asked. The
// driver's half ships as an INCIDENT REPORT (RideReport / ConflictType
// RIDE_REPORT), not as a grade: a passenger score is a number attached
// to a person's ability to move through their city, it absorbs bias,
// it invites retaliation, and once it exists someone will propose it
// for matching. So `Rating` is, by construction, customer-about-driver
// and nothing else — enforced at the route (customerOnly) AND in
// rating.service.createRating, which refuses any ratee that is not the
// journey's driver.

/**
 * Why a passenger gave a low rating. Offered — never required — when
 * the stars are 1 or 2.
 *
 * STARTER SET. These are the categories the Kigali team named on
 * 18 August; the LABELS are i18n (`rating.reason.*`) and the team can
 * edit them freely without touching code. The KEYS are persisted on
 * the Rating row, so adding, renaming or removing one is a migration —
 * not a translation change.
 */
export enum RatingReason {
  UNSAFE_DRIVING = 'UNSAFE_DRIVING',
  PRICE_DISAGREEMENT = 'PRICE_DISAGREEMENT',
  RUDE_BEHAVIOUR = 'RUDE_BEHAVIOUR',
  WRONG_ROUTE = 'WRONG_ROUTE',
  VEHICLE_CONDITION = 'VEHICLE_CONDITION',
  OTHER = 'OTHER',
}

/** Render order for the dropdown; OTHER stays last. */
export const RATING_REASONS: ReadonlyArray<RatingReason> = [
  RatingReason.UNSAFE_DRIVING,
  RatingReason.PRICE_DISAGREEMENT,
  RatingReason.RUDE_BEHAVIOUR,
  RatingReason.WRONG_ROUTE,
  RatingReason.VEHICLE_CONDITION,
  RatingReason.OTHER,
];

/**
 * At or below this many stars the optional reason dropdown is offered.
 * The team asked for "1-2 stars"; naming it once keeps the client and
 * any future server-side use reading the same number.
 */
export const RATING_REASON_THRESHOLD = 2;

export interface Rating {
  id: string;
  journeyId: string;
  raterId: string;
  ratedId: string;
  stars: number;
  comment?: string;
  /** Optional, and only ever meaningful at or below the threshold. */
  reason?: RatingReason | null;
  createdAt: string;
}
