// INTEL-DECK G3 — the grain gate's contract.
//
// The failure this closes is concrete: a Kigali hex clears k=20 and
// then ships `{ MOTO: 19, E_BIKE: 1 }`. Twenty movements, one person
// identifiable by the vehicle they rode. Every case below is a variant
// of that.

import {
  attributeMinimum,
  coalesceCategories,
  sanitizeAttributes,
  sanitizeRows,
  OTHER_KEY,
  MARGINAL_KEYS,
} from '../attribute-suppression';

const originalMin = process.env.MOBILITY_ATTR_MIN;

afterEach(() => {
  if (originalMin === undefined) delete process.env.MOBILITY_ATTR_MIN;
  else process.env.MOBILITY_ATTR_MIN = originalMin;
});

describe('mobility/attribute-suppression — the rule', () => {
  it('defaults to a minimum of 5 and honours MOBILITY_ATTR_MIN', () => {
    expect(attributeMinimum()).toBe(5);
    process.env.MOBILITY_ATTR_MIN = '8';
    expect(attributeMinimum()).toBe(8);
    process.env.MOBILITY_ATTR_MIN = 'nonsense';
    expect(attributeMinimum()).toBe(5);
    process.env.MOBILITY_ATTR_MIN = '0';
    expect(attributeMinimum()).toBe(5);
  });

  it('the motivating case: a category of one takes the lone survivor down with it', () => {
    // { MOTO: 19, E_BIKE: 1 } — folding E_BIKE alone would produce
    // { MOTO: 19, other: 1 }, which names the hidden count exactly.
    expect(coalesceCategories({ MOTO: 19, E_BIKE: 1 })).toEqual({ [OTHER_KEY]: 20 });
  });

  it('folds every below-minimum category into `other`', () => {
    expect(coalesceCategories({ MOTO: 30, BIKE: 20, E_BIKE: 2, E_MOTO: 3 })).toEqual({
      BIKE: 20,
      MOTO: 30,
      [OTHER_KEY]: 5,
    });
  });

  it('a lone fold takes the next-smallest survivor with it (complementary guard)', () => {
    // E_BIKE:2 is the only fold, so BIKE:20 — the smallest survivor —
    // joins it. MOTO:30 stands.
    expect(coalesceCategories({ MOTO: 30, BIKE: 20, E_BIKE: 2 })).toEqual({
      MOTO: 30,
      [OTHER_KEY]: 22,
    });
  });

  it('drops `other` entirely when it is itself below the minimum', () => {
    // A single category of one with nothing to fold alongside it.
    expect(coalesceCategories({ E_BIKE: 1 })).toEqual({});
    // Two tiny categories that still do not reach 5 between them.
    expect(coalesceCategories({ E_BIKE: 1, E_MOTO: 2 })).toEqual({});
  });

  it('leaves a map whose every category clears the minimum untouched', () => {
    expect(coalesceCategories({ MOTO: 30, BIKE: 20, E_BIKE: 9 })).toEqual({
      BIKE: 20,
      E_BIKE: 9,
      MOTO: 30,
    });
  });

  it('a single category above the minimum is not a disclosure and stands', () => {
    expect(coalesceCategories({ MOTO: 25 })).toEqual({ MOTO: 25 });
  });

  it('is idempotent — running it on its own output changes nothing', () => {
    const cases: Record<string, number>[] = [
      { MOTO: 19, E_BIKE: 1 },
      { MOTO: 30, BIKE: 20, E_BIKE: 2, E_MOTO: 3 },
      { E_BIKE: 1 },
      { MOTO: 25 },
      {},
    ];
    for (const input of cases) {
      const once = coalesceCategories(input);
      expect(coalesceCategories(once)).toEqual(once);
    }
  });

  it('absorbs a carried-over `other` rather than double-counting it', () => {
    expect(
      coalesceCategories({ MOTO: 30, BIKE: 20, [OTHER_KEY]: 7, E_BIKE: 1, E_MOTO: 2 }),
    ).toEqual({ BIKE: 20, MOTO: 30, [OTHER_KEY]: 10 });
  });

  it('the complementary guard still fires when an `other` is already present', () => {
    // Conservative on purpose: `other` having mass already might hide
    // the lone fold, but the gate does not reason about what an
    // observer may or may not have seen before. One fold, one companion.
    expect(coalesceCategories({ MOTO: 30, [OTHER_KEY]: 7, E_BIKE: 1 })).toEqual({
      [OTHER_KEY]: 38,
    });
  });

  it('never invents, drops or inflates a total beyond what folding accounts for', () => {
    const input = { MOTO: 30, BIKE: 20, E_BIKE: 2, E_MOTO: 3 };
    const sumIn = Object.values(input).reduce((a, b) => a + b, 0);
    const sumOut = Object.values(coalesceCategories(input)).reduce((a, b) => a + b, 0);
    expect(sumOut).toBe(sumIn);
  });

  it('output key order is stable regardless of input order', () => {
    const a = coalesceCategories({ E_BIKE: 9, MOTO: 30, BIKE: 20 });
    const b = coalesceCategories({ BIKE: 20, E_BIKE: 9, MOTO: 30 });
    expect(Object.keys(a)).toEqual(Object.keys(b));
  });
});

describe('mobility/attribute-suppression — sanitizeAttributes', () => {
  it('applies the rule to all three marginal maps', () => {
    expect(MARGINAL_KEYS).toEqual(['vehicleTypes', 'hourBuckets', 'fareDecileCounts']);
    const out = sanitizeAttributes({
      vehicleTypes: { MOTO: 19, E_BIKE: 1 },
      hourBuckets: { 7: 14, 8: 5, 3: 1 },
      fareDecileCounts: { 0: 12, 1: 7, 9: 1 },
    }) as Record<string, Record<string, number>>;
    expect(out.vehicleTypes).toEqual({ [OTHER_KEY]: 20 });
    expect(out.hourBuckets).toEqual({ '7': 14, [OTHER_KEY]: 6 });
    expect(out.fareDecileCounts).toEqual({ '0': 12, [OTHER_KEY]: 8 });
  });

  it('carries non-marginal keys through untouched (the OD row keeps its endpoints)', () => {
    const out = sanitizeAttributes({
      originCellId: 'abc',
      destCellId: 'def',
      originCenterLat: -1.95,
      destCenterLng: 30.09,
      destTier: 'DENSE',
      vehicleTypes: { MOTO: 19, E_BIKE: 1 },
    }) as Record<string, unknown>;
    expect(out.originCellId).toBe('abc');
    expect(out.destCellId).toBe('def');
    expect(out.originCenterLat).toBe(-1.95);
    expect(out.destCenterLng).toBe(30.09);
    expect(out.destTier).toBe('DENSE');
    expect(out.vehicleTypes).toEqual({ [OTHER_KEY]: 20 });
  });

  it('null / undefined / non-object attributes yield undefined, not a crash', () => {
    expect(sanitizeAttributes(null)).toBeUndefined();
    expect(sanitizeAttributes(undefined)).toBeUndefined();
    expect(sanitizeAttributes([] as unknown as Record<string, unknown>)).toBeUndefined();
  });

  it('a marginal key holding something that is not a count map is left alone', () => {
    const out = sanitizeAttributes({ vehicleTypes: 'not-a-map' }) as Record<string, unknown>;
    expect(out.vehicleTypes).toBe('not-a-map');
  });

  it('does not mutate its input', () => {
    const input = { vehicleTypes: { MOTO: 19, E_BIKE: 1 } };
    sanitizeAttributes(input);
    expect(input.vehicleTypes).toEqual({ MOTO: 19, E_BIKE: 1 });
  });

  it('sanitizeRows normalises a legacy row written before this gate existed', () => {
    const legacy = [
      { id: 'r1', count: 20, attributesJson: { vehicleTypes: { MOTO: 19, E_BIKE: 1 } } },
      { id: 'r2', count: 10, attributesJson: null },
    ];
    const out = sanitizeRows(legacy);
    expect((out[0].attributesJson as any).vehicleTypes).toEqual({ [OTHER_KEY]: 20 });
    expect(out[0].id).toBe('r1');
    expect(out[0].count).toBe(20);
    expect(out[1].attributesJson).toBeNull();
  });
});
