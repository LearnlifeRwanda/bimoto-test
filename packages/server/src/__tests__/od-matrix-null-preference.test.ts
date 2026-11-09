// ANY-VEHICLE G5 — a null vehicle preference must not break the
// mobility aggregate.
//
// od-matrix buckets completed journeys by their vehiclePreference. G1
// makes null-preference journeys ordinary rather than exotic, so the
// question this dispatch had to answer about the aggregator is narrow
// and factual: does a null land in a bucket, or does it throw, or does
// it silently drop the ride out of the flow counts?
//
// The answer is that it does neither — the row is counted in `count`
// unconditionally, and only the per-vehicle-type breakdown is guarded
// (`if (j.vehiclePreference)`, od-matrix.ts:211). So no code change was
// needed here. This test is that verification, written down: it fails
// if a future edit starts skipping the row, or starts filing nulls
// under a literal "null"/"undefined" key.

import { aggregateOdMatrix } from '../services/mobility/aggregator/od-matrix';

// One busy pair, well above any tier threshold, so nothing is
// suppressed for k-anonymity and the counts are readable.
const PICKUP = { lat: -1.9536, lng: 30.0606 };
const DEST = { lat: -1.9440, lng: 30.0619 };
const RIDE_AT = new Date('2026-08-20T09:00:00.000Z');

function ride(id: string, vehiclePreference: string | null) {
  return {
    id,
    pickupLat: PICKUP.lat,
    pickupLng: PICKUP.lng,
    destinationLat: DEST.lat,
    destinationLng: DEST.lng,
    vehiclePreference,
    startedAt: RIDE_AT,
    endedAt: new Date(RIDE_AT.getTime() + 15 * 60_000),
  };
}

/** A prisma stand-in that answers one page and then stops. */
function fakePrisma(rows: ReturnType<typeof ride>[]) {
  return {
    journey: {
      findMany: jest.fn(async ({ cursor }: any) => (cursor ? [] : rows)),
    },
  } as any;
}

const WINDOW = {
  sinceUtc: new Date('2026-08-20T00:00:00.000Z'),
  untilUtc: new Date('2026-08-21T00:00:00.000Z'),
};

describe('od-matrix — null vehiclePreference', () => {
  it('does not throw', async () => {
    const rows = Array.from({ length: 20 }, (_, i) => ride(`n${i}`, null));
    await expect(aggregateOdMatrix(fakePrisma(rows), WINDOW)).resolves.toBeDefined();
  });

  it('does not drop the ride — it is still counted in the flow', async () => {
    const rows = Array.from({ length: 20 }, (_, i) => ride(`n${i}`, null));
    const result = await aggregateOdMatrix(fakePrisma(rows), WINDOW);

    expect(result.scannedPoints).toBe(20);
    const total = result.aggregated.reduce((sum, r: any) => sum + r.count, 0);
    expect(total).toBe(20);
  });

  it('files no vehicle-type bucket for it — not a "null" key, none at all', async () => {
    const rows = [
      ...Array.from({ length: 14 }, (_, i) => ride(`n${i}`, null)),
      ...Array.from({ length: 6 }, (_, i) => ride(`m${i}`, 'MOTO')),
    ];
    const result = await aggregateOdMatrix(fakePrisma(rows), WINDOW);

    const buckets = Object.assign(
      {},
      ...result.aggregated.map((r: any) => r.attributesJson?.vehicleTypes ?? {}),
    );
    // A literal "null"/"undefined"/"" key here would be a made-up
    // vehicle type leaking into the mobility data product.
    for (const key of Object.keys(buckets)) {
      expect(['BIKE', 'E_BIKE', 'MOTO', 'E_MOTO']).toContain(key);
    }
    expect(buckets.MOTO).toBe(6);

    // ...while the ride count still knows about all twenty.
    const total = result.aggregated.reduce((sum, r: any) => sum + r.count, 0);
    expect(total).toBe(20);
  });

  it('a mixed day counts every ride and breaks down only the stated ones', async () => {
    const rows = [
      ...Array.from({ length: 10 }, (_, i) => ride(`n${i}`, null)),
      ...Array.from({ length: 7 }, (_, i) => ride(`b${i}`, 'BIKE')),
      ...Array.from({ length: 8 }, (_, i) => ride(`e${i}`, 'E_MOTO')),
    ];
    const result = await aggregateOdMatrix(fakePrisma(rows), WINDOW);

    expect(result.scannedPoints).toBe(25);
    const total = result.aggregated.reduce((sum, r: any) => sum + r.count, 0);
    expect(total).toBe(25);

    const buckets = Object.assign(
      {},
      ...result.aggregated.map((r: any) => r.attributesJson?.vehicleTypes ?? {}),
    );
    expect(buckets.BIKE).toBe(7);
    expect(buckets.E_MOTO).toBe(8);
    // The 10 any-vehicle rides are in the count, and in no breakdown.
    expect(Object.values(buckets).reduce((a: any, b: any) => a + b, 0)).toBe(15);
  });
});
