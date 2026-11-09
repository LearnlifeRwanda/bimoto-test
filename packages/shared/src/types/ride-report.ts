// TYPES/RIDE-REPORT.TS
//
// TEAM-ANSWERS G3 (OPEN DECISIONS item 15, driver side, Kigali team,
// 18 August) — the driver's way to raise a problem with a finished ride.
//
// THE SUBSTITUTION, recorded so nobody has to reconstruct it: the team
// asked for driver-rates-passenger, "to identify and manage issues from
// both sides". The GOAL ships. The MECHANISM changes, by founder
// decision after a values discussion the same day.
//
// A passenger score is a number attached to a person's ability to move
// through their city. It absorbs the bias of whoever gives it, it
// invites retaliation ("he rated me two, so I rate him two"), and once
// the number exists somebody will one day propose using it for
// matching — at which point a bad night three months ago starts
// deciding whether a person can get home.
//
// An incident report gives ops the same thing the score was wanted for.
// Repeated reports about one rider are plainly visible to the admin in
// the conflicts dashboard, because that is what the dashboard already
// does for nine other kinds of trouble. What it does NOT create is the
// number. There is no per-passenger aggregate, average or count
// anywhere in this design — the pattern lives in the list of reports,
// not on the person.

/**
 * Why a driver is reporting a ride. Optional to file at all; a driver
 * who never opens this never sees it.
 *
 * STARTER SET, same standing as RatingReason: the LABELS are i18n
 * (`report.reason.*`) and the team can edit them without touching code;
 * the KEYS are persisted on the RideReport row, so changing one is a
 * migration.
 */
export enum RideReportReason {
  NO_SHOW_OR_LATE = 'NO_SHOW_OR_LATE',
  RUDE_BEHAVIOUR = 'RUDE_BEHAVIOUR',
  REFUSED_AGREED_PRICE = 'REFUSED_AGREED_PRICE',
  UNSAFE_REQUEST = 'UNSAFE_REQUEST',
  OTHER = 'OTHER',
}

/** Render order for the dropdown; OTHER stays last. */
export const RIDE_REPORT_REASONS: ReadonlyArray<RideReportReason> = [
  RideReportReason.NO_SHOW_OR_LATE,
  RideReportReason.RUDE_BEHAVIOUR,
  RideReportReason.REFUSED_AGREED_PRICE,
  RideReportReason.UNSAFE_REQUEST,
  RideReportReason.OTHER,
];

export interface RideReport {
  id: string;
  journeyId: string;
  reporterId: string;
  reason: RideReportReason;
  details?: string | null;
  createdAt: string;
}
