// SERVICES/CHILD-SAFETY/UNSTATED-VEHICLE.TS
//
// ANY-VEHICLE G6(b) — what a booking with no stated vehicle is
// validated as, and why that is a decision rather than an accident.
//
// THE SITUATION. `vehiclePreference` is optional on createJourneySchema
// (shared/schemas/journey.schema.ts) and ANY-VEHICLE made omitting it an
// ordinary thing to do: a customer who does not mind what turns up gets
// offers from every kind of wheel. But two pieces of compliance logic in
// createJourney have to name a vehicle BEFORE any offer exists, because
// they run at booking time:
//
//   - the child-passenger gate (validateChildBooking), and
//   - the parcel-load rule (validateParcelLoad).
//
// Three sites therefore read `data.vehiclePreference ?? 'MOTO'`. This
// constant is that MOTO, in one place, with the reasoning attached, so
// the three sites cannot drift and nobody has to guess whether the
// default was chosen or typed.
//
// WHY MOTO, FOR THE CHILD GATE — this is the load-bearing half.
//
// MOTO carries the STRICTEST child threshold in the vehicle set:
//
//     MIN_AGE_MOTO_PASSENGER    12   <- the maximum
//     MIN_AGE_E_MOTO_PASSENGER  12
//     MIN_AGE_BIKE_PASSENGER     0
//     MIN_AGE_E_BIKE_PASSENGER   0
//
// So validating an unstated booking as a moto is FAIL-CLOSED: it applies
// the highest minimum age any vehicle in the table demands. A booking
// that passes as a moto passes whatever actually arrives; the reverse
// would not be true, and defaulting to BIKE (minimum age 0) would let a
// six-year-old be booked onto a request that a moto may well answer.
//
// This property is not self-evident and it is not permanent — it is a
// fact about the CURRENT threshold table, which legal-thresholds.ts says
// in as many words is a placeholder pending RESEARCH-1. So it is
// asserted rather than asserted-in-a-comment: see
// __tests__/unstated-vehicle.test.ts, which fails the moment any vehicle
// type carries a stricter child threshold than MOTO. That failure is the
// signal to come back here and decide again, deliberately, rather than
// discover in the field that the default quietly stopped being safe.
//
// WHY MOTO, FOR THE PARCEL RULE — a weaker claim, stated honestly.
//
// The fail-closed argument above does NOT transfer, and pretending it
// does would be the kind of comment that outlives its truth. On the
// parcel side moto is the more PERMISSIVE reading for a journey carrying
// a passenger (15 kg, against a bicycle's 10 kg).
//
// What makes the default correct there is something else:
// getParcelAllowance (shared/constants/parcel-weight.ts) branches on
// `isBicycle(vehicleType)` and treats everything else as a moto, so an
// absent preference already fell into the moto branch. Passing this
// constant changes no outcome whatsoever — it makes the existing
// behaviour legible at the call site instead of leaving it to a helper's
// else-branch. The test file pins that equivalence too.
//
// The open question underneath — that on an any-vehicle journey the
// machine which eventually accepts may not be the one the declared
// weight was checked against — is a real product question about when
// parcel limits should be enforced. It is recorded here, and in the
// dispatch report, and deliberately not decided by this constant.

import { VehicleType } from '@prisma/client';

/**
 * The vehicle a booking is validated as when the customer stated no
 * preference. Read the header before changing it: for the child gate
 * this value must remain the STRICTEST type in LEGAL_THRESHOLDS, and a
 * test enforces that.
 */
export const UNSTATED_VEHICLE_DEFAULT: VehicleType = VehicleType.MOTO;
