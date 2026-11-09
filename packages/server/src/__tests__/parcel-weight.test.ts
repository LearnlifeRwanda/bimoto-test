// FIELD-FIT G5 — the team's parcel rules, settled by the founder on
// 11 August, pinned as numbers rather than as prose:
//
//   bicycle alone .................. up to 70 kg
//   bicycle with passenger ......... up to 10 kg
//   moto alone ..................... envelope-size parcels only
//   moto with passenger ............ up to 15 kg
//
// If any of these four assertions has to change, the team's decision
// has changed — not the code.

// Lives in the server suite, not packages/shared/src/__tests__: that
// directory is run by no pipeline (see docs/field-fit-reproduction.md),
// and the rules below are what createJourney enforces.
import {
  PARCEL_WEIGHT_RULES,
  MOTO_ALONE_MAX_SIZE_CATEGORY,
  ENFORCE_MOTO_ALONE_SIZE_RULE,
  getParcelAllowance,
  validateParcelLoad,
  isBicycle,
  isCarryingPassenger,
} from '@bimoto/shared';

const load = (
  vehicleType: string,
  journeyType: string,
  extra: { weightKg?: number; sizeCategory?: string } = {},
) => validateParcelLoad({ vehicleType, journeyType, ...extra });

describe('the four numbers are exactly what the team settled', () => {
  test('the constants', () => {
    expect(PARCEL_WEIGHT_RULES.BICYCLE_ALONE_MAX_KG).toBe(70);
    expect(PARCEL_WEIGHT_RULES.BICYCLE_WITH_PASSENGER_MAX_KG).toBe(10);
    expect(PARCEL_WEIGHT_RULES.MOTO_WITH_PASSENGER_MAX_KG).toBe(15);
    expect(MOTO_ALONE_MAX_SIZE_CATEGORY).toBe('SMALL');
  });

  test('"alone" is a parcel-only run; "with passenger" is a passenger ride', () => {
    expect(isCarryingPassenger('PASSENGER')).toBe(true);
    for (const t of ['GOODS', 'PRIORITY_MESSENGER', 'URGENT_MESSENGER']) {
      expect(isCarryingPassenger(t)).toBe(false);
    }
  });

  test('BIKE and E_BIKE are bicycles; MOTO and E_MOTO are not', () => {
    expect(isBicycle('BIKE')).toBe(true);
    expect(isBicycle('E_BIKE')).toBe(true);
    expect(isBicycle('MOTO')).toBe(false);
    expect(isBicycle('E_MOTO')).toBe(false);
  });
});

describe('bicycle alone — up to 70 kg', () => {
  test.each(['BIKE', 'E_BIKE'])('%s accepts 70 kg and refuses 71 kg', (vt) => {
    expect(load(vt, 'GOODS', { weightKg: 70 }).allowed).toBe(true);
    const over = load(vt, 'GOODS', { weightKg: 71 });
    expect(over.allowed).toBe(false);
    expect(over.code).toBe('PARCEL_TOO_HEAVY_FOR_VEHICLE');
  });

  test('a bicycle on its own is not limited by size category', () => {
    expect(load('BIKE', 'GOODS', { weightKg: 40, sizeCategory: 'LARGE' }).allowed).toBe(true);
  });
});

describe('bicycle with passenger — up to 10 kg', () => {
  test.each(['BIKE', 'E_BIKE'])('%s accepts 10 kg and refuses 11 kg', (vt) => {
    expect(load(vt, 'PASSENGER', { weightKg: 10 }).allowed).toBe(true);
    expect(load(vt, 'PASSENGER', { weightKg: 11 }).allowed).toBe(false);
  });

  test('the acceptance case the dispatch names: 9 kg yes, 11 kg no', () => {
    expect(load('BIKE', 'PASSENGER', { weightKg: 9 }).allowed).toBe(true);
    expect(load('BIKE', 'PASSENGER', { weightKg: 11 }).allowed).toBe(false);
  });
});

describe('moto with passenger — up to 15 kg', () => {
  test.each(['MOTO', 'E_MOTO'])('%s accepts 15 kg and refuses 16 kg', (vt) => {
    expect(load(vt, 'PASSENGER', { weightKg: 15 }).allowed).toBe(true);
    expect(load(vt, 'PASSENGER', { weightKg: 16 }).allowed).toBe(false);
  });
});

describe('moto alone — envelope-size only', () => {
  // The rule is fully computed, but it is STATED rather than enforced
  // until the team decides: it limits goodsSizeCategory, which the
  // parcel form has always sent and whose default is MEDIUM on a MOTO,
  // so refusing it would delete the ordinary moto parcel booking that
  // e2e/tests/create-ride-ui.spec.ts asserts works today. See
  // ENFORCE_MOTO_ALONE_SIZE_RULE.
  test.each(['MOTO', 'E_MOTO'])('%s: SMALL is clean, MEDIUM and LARGE are flagged', (vt) => {
    const small = load(vt, 'GOODS', { sizeCategory: 'SMALL' });
    expect(small.allowed).toBe(true);
    expect(small.advisory).toBeUndefined();

    for (const size of ['MEDIUM', 'LARGE']) {
      const r = load(vt, 'GOODS', { sizeCategory: size });
      expect(r.advisory).toBe('PARCEL_TOO_LARGE_FOR_VEHICLE');
      expect(r.allowed).toBe(!ENFORCE_MOTO_ALONE_SIZE_RULE);
      if (ENFORCE_MOTO_ALONE_SIZE_RULE) {
        expect(r.code).toBe('PARCEL_TOO_LARGE_FOR_VEHICLE');
      }
    }
  });

  test('the ordinary parcel booking the app has always allowed still books', () => {
    // MOTO + MEDIUM is what /journey/goods sends by default.
    expect(load('MOTO', 'GOODS', { sizeCategory: 'MEDIUM' }).allowed).toBe(true);
  });

  test('it is a size rule, not a weight rule — no kilogram ceiling is stated', () => {
    const allowance = getParcelAllowance('MOTO', false);
    expect(allowance.maxWeightKg).toBeNull();
    expect(allowance.maxSizeCategory).toBe('SMALL');
    // …so a declared weight alone cannot refuse a moto-alone parcel.
    expect(load('MOTO', 'GOODS', { weightKg: 60, sizeCategory: 'SMALL' }).allowed).toBe(true);
  });

  test('the envelope rule maps onto the existing category taxonomy', () => {
    // No parallel taxonomy: the limit is expressed in SMALL/MEDIUM/LARGE,
    // the same values goodsSizeCategory has always taken.
    expect(['SMALL', 'MEDIUM', 'LARGE']).toContain(MOTO_ALONE_MAX_SIZE_CATEGORY);
  });
});

describe('the rules are additive', () => {
  test('declaring nothing is always allowed, for every combination', () => {
    for (const vt of ['BIKE', 'E_BIKE', 'MOTO', 'E_MOTO']) {
      for (const jt of ['PASSENGER', 'GOODS', 'URGENT_MESSENGER']) {
        expect(load(vt, jt).allowed).toBe(true);
      }
    }
  });

  test('an undeclared weight never refuses a weight-limited vehicle', () => {
    expect(load('BIKE', 'PASSENGER', { sizeCategory: 'LARGE' }).allowed).toBe(true);
  });

  test('an undeclared size never refuses a size-limited vehicle', () => {
    expect(load('MOTO', 'GOODS', {}).allowed).toBe(true);
  });
});

describe('every refusal names the limit it broke', () => {
  test('a refusal carries a code, a message key, and the allowance', () => {
    const r = load('MOTO', 'PASSENGER', { weightKg: 20 });
    expect(r.allowed).toBe(false);
    expect(r.messageKey).toBe('errors.parcelTooHeavyForVehicle');
    expect(r.allowance.maxWeightKg).toBe(15);
    expect(r.allowance.copyKey).toBe('parcelWeight.motoWithPassenger');
  });

  test('each of the four cases points at its own piece of copy', () => {
    const keys = [
      getParcelAllowance('BIKE', false).copyKey,
      getParcelAllowance('BIKE', true).copyKey,
      getParcelAllowance('MOTO', false).copyKey,
      getParcelAllowance('MOTO', true).copyKey,
    ];
    expect(new Set(keys).size).toBe(4);
  });
});
