// SERVICES/CHILD-SAFETY/__TESTS__/UNSTATED-VEHICLE.TEST.TS
//
// ANY-VEHICLE G6(b) — the two facts that make `?? MOTO` a decision.
//
// createJourney validates a booking with no stated vehicle preference as
// a moto, at three sites. That is either fail-closed reasoning or an
// accident of whichever enum member got typed first, and a comment
// cannot tell the two apart a year from now. These tests can.
//
// Fact 1 is the load-bearing one and it is a claim about a table that
// legal-thresholds.ts openly calls a placeholder: MOTO carries the
// STRICTEST child threshold of the whole vehicle set. If that ever stops
// being true — a stricter vehicle type is added, or RESEARCH-1 returns
// values that reorder the table — the default stops being fail-closed
// and this file fails. That failure is the point: it forces a deliberate
// revisit instead of a silent loosening on a child booking.
//
// Fact 2 is about the parcel side, where the fail-closed argument does
// NOT hold, and the tests say so rather than papering over it.

import { LEGAL_THRESHOLDS } from '../legal-thresholds';
import { UNSTATED_VEHICLE_DEFAULT } from '../unstated-vehicle';
import { validateChildBooking } from '../booking-validator';
import { validateParcelLoad, getParcelAllowance } from '@bimoto/shared';
import { VehicleType } from '@prisma/client';

/** Every per-vehicle minimum passenger age in the table, by vehicle. */
const MIN_AGE_BY_VEHICLE: Record<string, number> = {
  MOTO: LEGAL_THRESHOLDS.MIN_AGE_MOTO_PASSENGER,
  E_MOTO: LEGAL_THRESHOLDS.MIN_AGE_E_MOTO_PASSENGER,
  BIKE: LEGAL_THRESHOLDS.MIN_AGE_BIKE_PASSENGER,
  E_BIKE: LEGAL_THRESHOLDS.MIN_AGE_E_BIKE_PASSENGER,
};

describe('fact 1 — the unstated default is the STRICTEST vehicle (fail-closed)', () => {
  test('the default is MOTO', () => {
    expect(UNSTATED_VEHICLE_DEFAULT).toBe(VehicleType.MOTO);
  });

  test('every vehicle type in the enum has a threshold in the table', () => {
    // Guards the assertion below against a new vehicle type that simply
    // is not represented here — which would let the maximum check pass
    // while saying nothing about the new type at all.
    for (const vt of Object.values(VehicleType)) {
      expect(MIN_AGE_BY_VEHICLE).toHaveProperty(vt);
      expect(typeof MIN_AGE_BY_VEHICLE[vt]).toBe('number');
    }
  });

  test("MOTO's minimum passenger age is the MAXIMUM across the table", () => {
    // THE ASSERTION THIS FILE EXISTS FOR.
    //
    // Failing here means a vehicle type now demands a HIGHER minimum age
    // than MOTO, so validating an unstated booking as a moto no longer
    // applies the strictest rule, and an any-vehicle booking could pass
    // a gate the machine that actually arrives would fail.
    //
    // Do not fix this by changing the number. Go to
    // services/child-safety/unstated-vehicle.ts and decide what an
    // unstated preference should be validated as now.
    const ages = Object.values(MIN_AGE_BY_VEHICLE);
    expect(MIN_AGE_BY_VEHICLE[UNSTATED_VEHICLE_DEFAULT]).toBe(Math.max(...ages));
  });

  test('a child too young for a moto is refused when no vehicle is stated', () => {
    // The property above, exercised through the real validator: this is
    // the behaviour the default buys.
    const tooYoung = LEGAL_THRESHOLDS.MIN_AGE_MOTO_PASSENGER - 1;
    const result = validateChildBooking({
      vehicleType: UNSTATED_VEHICLE_DEFAULT,
      childAgeYears: tooYoung,
      hasChildPassenger: true,
      isUnaccompaniedMinor: false,
    });
    expect(result.allowed).toBe(false);

    // And the same child WOULD be allowed on a bicycle — which is
    // precisely why defaulting to the bicycle would be the wrong way
    // round.
    const onABike = validateChildBooking({
      vehicleType: VehicleType.BIKE,
      childAgeYears: tooYoung,
      hasChildPassenger: true,
      isUnaccompaniedMinor: false,
    });
    expect(onABike.allowed).toBe(true);
  });
});

describe('fact 2 — the parcel side: reachable, and outcome-neutral', () => {
  // The dispatch's premise was that a parcel journey can never carry a
  // null preference, because GoodsRequestPage always sends one. The
  // client does — but the CLIENT is not the oracle, and at the schema
  // level `vehiclePreference` is `.optional()`, so a body without it
  // validates. The default at journey.service.ts:159 is therefore
  // genuinely reachable (a direct API call, an outbox replay of an older
  // body), not dead code. These tests pin what it does when reached.

  test('a GOODS journey with no stated vehicle gets the moto-alone allowance', () => {
    const unstated = validateParcelLoad({
      vehicleType: UNSTATED_VEHICLE_DEFAULT,
      journeyType: 'GOODS',
      weightKg: null,
      sizeCategory: 'MEDIUM',
    });
    // Moto-alone is a SIZE rule, not a weight ceiling, and the size rule
    // is stated rather than enforced today
    // (ENFORCE_MOTO_ALONE_SIZE_RULE = false), so the booking goes
    // through and the breach is recorded as an advisory.
    expect(unstated.allowed).toBe(true);
    expect(unstated.allowance.maxWeightKg).toBeNull();
    expect(unstated.allowance.maxSizeCategory).toBe('SMALL');
  });

  test('the default changes NO parcel outcome — it only makes the branch legible', () => {
    // getParcelAllowance branches on isBicycle() and treats everything
    // else as a moto, so an absent preference already landed in the moto
    // branch. This is the honest justification for the parcel sites: not
    // "MOTO is strictest" (it is not, here), but "this is what already
    // happened, said out loud".
    for (const journeyType of ['GOODS', 'PASSENGER']) {
      const withDefault = getParcelAllowance(UNSTATED_VEHICLE_DEFAULT, journeyType === 'PASSENGER');
      const withNothing = getParcelAllowance(
        undefined as unknown as string,
        journeyType === 'PASSENGER',
      );
      expect(withDefault).toEqual(withNothing);
    }
  });

  test('and on the parcel side moto is NOT the strictest — stated, not hidden', () => {
    // Recorded so nobody later copies the fail-closed sentence from the
    // child gate onto the parcel sites: with a passenger aboard, a moto
    // may carry 15 kg where a bicycle may carry 10.
    const moto = getParcelAllowance(VehicleType.MOTO, true);
    const bike = getParcelAllowance(VehicleType.BIKE, true);
    expect(moto.maxWeightKg).toBeGreaterThan(bike.maxWeightKg!);
  });
});
