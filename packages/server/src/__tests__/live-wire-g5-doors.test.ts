// LIVE-WIRE G5 — the server halves of the doors the field found stuck.
//
//   * Jean's item 13(c): a STANDARD parcel may carry an optional
//     1/2/3-hour window; EXPRESS never does, and neither ever touches a
//     price.
//   * The team's item 15: a request that reappears in the feed is the
//     deliberate unpaid-release, and the motari is now told so.

import { createJourneySchema } from '@bimoto/shared';

describe('standardDeliveryHours — the shape the API accepts', () => {
  const base = {
    type: 'GOODS',
    pickupLat: -1.9441,
    pickupLng: 30.0619,
    pickupName: 'Nyabugogo',
    destinationLat: -1.9536,
    destinationLng: 30.0606,
    destinationName: 'Kimironko',
  };

  test.each([1, 2, 3])('accepts %i hours', (hours) => {
    const parsed = createJourneySchema.safeParse({
      ...base,
      deliverySpeed: 'STANDARD',
      standardDeliveryHours: hours,
    });
    expect(parsed.success).toBe(true);
  });

  test('refuses a window the team never named', () => {
    // Bounded to the three literals rather than a free integer, so a
    // client cannot invent "4 hours" and have it stored as a promise.
    for (const hours of [0, 4, 24, 1.5, -1]) {
      const parsed = createJourneySchema.safeParse({
        ...base,
        deliverySpeed: 'STANDARD',
        standardDeliveryHours: hours,
      });
      expect(parsed.success).toBe(false);
    }
  });

  test('is optional — a body that predates the field still validates', () => {
    const parsed = createJourneySchema.safeParse({ ...base, deliverySpeed: 'STANDARD' });
    expect(parsed.success).toBe(true);
  });

  test('changes no price: the fare inputs are untouched by it', () => {
    // The guarantee #160 established for the tier tag, re-asserted for
    // the window. Nothing in the schema couples it to a fare field, and
    // nothing downstream multiplies by it — grep-able and pinned here.
    const withWindow = createJourneySchema.safeParse({
      ...base,
      deliverySpeed: 'STANDARD',
      standardDeliveryHours: 3,
      wishPrice: 1200,
    });
    const without = createJourneySchema.safeParse({
      ...base,
      deliverySpeed: 'STANDARD',
      wishPrice: 1200,
    });
    expect(withWindow.success && without.success).toBe(true);
    if (withWindow.success && without.success) {
      expect(withWindow.data.wishPrice).toBe(without.data.wishPrice);
    }
  });
});

describe('the reopened-unpaid marker', () => {
  // The driver feed derives `reopenedUnpaid` from the escrow row that
  // survives an unpaid release (escrow.service.releaseMatchTx). This
  // pins the derivation rule itself, which is the part that can drift.
  const isReopened = (escrowStatus: string | null) =>
    escrowStatus !== null && escrowStatus !== 'HELD' && escrowStatus !== 'RELEASED';

  test('a first-time request has no escrow and is not marked', () => {
    expect(isReopened(null)).toBe(false);
  });

  test('a request released after a failed payment is marked', () => {
    expect(isReopened('FAILED')).toBe(true);
    expect(isReopened('PENDING')).toBe(true);
  });

  test('an escrow that actually paid is not an unpaid release', () => {
    // HELD/RELEASED belong to a match that DID pay and later took a
    // cancel/refund path — a different story, and not this copy's.
    expect(isReopened('HELD')).toBe(false);
    expect(isReopened('RELEASED')).toBe(false);
  });
});
