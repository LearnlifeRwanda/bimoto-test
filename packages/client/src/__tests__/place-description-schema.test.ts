// LANDMARKS G4 — widening a schema that an offline outbox replays.
//
// createJourneySchema also types CreateJourneyInput, which useJourney
// enqueues into the offline outbox. A payload written before an app update
// can be replayed after it, and a payload written after the update can
// reach a server that has not deployed it yet. Both directions have to
// survive, so both directions are asserted here rather than reasoned about.
//
// The mechanism is that the two new fields are pure optional with no
// default: absent stays absent, and an unknown key is stripped rather than
// rejected. If either of those ever changes, this file goes red before an
// upgrade drops somebody's queued ride.

import { describe, test, expect } from 'vitest';
import { createJourneySchema } from '@bimoto/shared';

const BASE = {
  type: 'PASSENGER' as const,
  pickupLat: -1.94,
  pickupLng: 30.06,
  pickupName: 'Sonatubes',
  destinationLat: -1.95,
  destinationLng: 30.1,
  destinationName: 'Kwa Jules',
};

describe('the outbox replays in both directions', () => {
  test('an old payload, queued before the update, still validates after it', () => {
    // Exactly what the outbox held yesterday: no description keys at all.
    const parsed = createJourneySchema.safeParse(BASE);
    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(parsed.success).toBe(true);
    // Absent stays absent — no default materialises a key the customer
    // never filled in, so nothing downstream starts rendering an empty row.
    expect('pickupDescription' in (parsed as { data: object }).data).toBe(false);
    expect('destinationDescription' in (parsed as { data: object }).data).toBe(false);
  });

  test('a new payload still validates against a server that never heard of the fields', () => {
    const body = { ...BASE, pickupDescription: 'Kuwa Mudugudu', destinationDescription: 'blue gate' };
    expect(createJourneySchema.safeParse(body).success).toBe(true);
    // An old server validates the same body with the same schema object
    // minus these two keys. A zod object is not strict: a key it has never
    // heard of is dropped, not rejected — which is why a phone that
    // updated ahead of the server does not start failing to book. Proven
    // against the live schema with a key no version of it has ever had.
    const withUnknownKey = createJourneySchema.safeParse({
      ...BASE,
      aFieldNoServerHasEverSeen: 'whatever',
    });
    expect(withUnknownKey.success).toBe(true);
    expect('aFieldNoServerHasEverSeen' in (withUnknownKey as { data: object }).data).toBe(false);
  });

  test('the fields are optional, not nullable-with-a-default', () => {
    const withEmpty = createJourneySchema.safeParse({ ...BASE, pickupDescription: '' });
    expect(withEmpty.success).toBe(true);
  });
});

describe('the cap the column and the input agree on', () => {
  test('200 characters are accepted and 201 are not', () => {
    expect(
      createJourneySchema.safeParse({ ...BASE, pickupDescription: 'x'.repeat(200) }).success,
    ).toBe(true);
    expect(
      createJourneySchema.safeParse({ ...BASE, pickupDescription: 'x'.repeat(201) }).success,
    ).toBe(false);
    expect(
      createJourneySchema.safeParse({ ...BASE, destinationDescription: 'x'.repeat(201) }).success,
    ).toBe(false);
  });
});
