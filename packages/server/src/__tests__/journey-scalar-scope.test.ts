// PARCEL-VISIBLE G2 — the SCALARS, per viewer.
//
// #185 (INCLUDE-REACH) scoped the RELATIONS a pre-match reader may ask for,
// and journey-viewer-scope.test.ts pins that decision. What neither covered
// is that the bidder/outsider read is an `include`: it narrows relations and
// returns every COLUMN the row has. Three of those columns are people —
// `recipientName`, `recipientPhone` (an ordinary GoodsRequestPage parcel
// booking writes them onto the JOURNEY, not onto a leg) and
// `childGuardianPhone`.
//
// What THIS file pins is the strip and its scope boundary. What it CANNOT
// pin is that the query narrows on real Postgres — that is
// packages/e2e/tests/journey-read-authorization.spec.ts, which reads the raw
// response text.

import { JourneyStatus } from '@bimoto/shared';

jest.mock('../prisma', () => {
  const db: any = {
    journey: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    driverProfile: { findUnique: jest.fn(), update: jest.fn() },
    rating: { findUnique: jest.fn() },
    feeWaiver: { findMany: jest.fn(), findFirst: jest.fn() },
    escrow: { findUnique: jest.fn() },
    gpsPoint: { findMany: jest.fn(), findFirst: jest.fn() },
    user: { update: jest.fn() },
    $transaction: jest.fn(async (cb: any) => cb(db)),
  };
  return { __esModule: true, default: db };
});

jest.mock('../services/escrow.service', () => ({
  releaseEscrow: jest.fn().mockResolvedValue({}),
  freezeEscrow: jest.fn().mockResolvedValue({}),
}));

jest.mock('../services/escrow-audit.service', () => ({
  appendAuditEntry: jest.fn().mockResolvedValue(undefined),
  appendAuditEntryTx: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../services/journey-validation.service', () => ({
  validateJourneyPlausibility: jest.fn().mockResolvedValue({ valid: true, flags: [] }),
}));

jest.mock('../services/sms.service', () => ({
  __esModule: true,
  sendSms: jest.fn().mockResolvedValue(undefined),
}));

import mockPrisma from '../prisma';
import * as smsService from '../services/sms.service';
import {
  PROTECTED_JOURNEY_FIELDS_PRE_MATCH,
  stripJourneyForScope,
  getJourneyById,
  getJourneys,
  endJourney,
} from '../services/journey.service';

const CUSTOMER_ID = 'cust-1';
const DRIVER_ID = 'drv-1';
const BIDDER_ID = 'bidder-1';

const RECIPIENT_NAME = 'Mukamana Alphonsine';
const RECIPIENT_PHONE = '+250788555001';
const GUARDIAN_PHONE = '+250788555002';

const journeyFindUnique = (mockPrisma as any).journey.findUnique as jest.Mock;
const journeyFindFirst = (mockPrisma as any).journey.findFirst as jest.Mock;
const journeyFindMany = (mockPrisma as any).journey.findMany as jest.Mock;
const journeyUpdate = (mockPrisma as any).journey.update as jest.Mock;
const driverProfileFindUnique = (mockPrisma as any).driverProfile.findUnique as jest.Mock;
const ratingFindUnique = (mockPrisma as any).rating.findUnique as jest.Mock;
const feeWaiverFindMany = (mockPrisma as any).feeWaiver.findMany as jest.Mock;
const gpsPointFindFirst = (mockPrisma as any).gpsPoint.findFirst as jest.Mock;
const sendSms = (smsService as any).sendSms as jest.Mock;

/** The parcel row as the database actually holds it: people and cargo both. */
function parcelRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'j1',
    customerId: CUSTOMER_ID,
    driverId: null,
    status: JourneyStatus.REQUESTED,
    type: 'GOODS',
    pickupLat: -1.9536,
    pickupLng: 30.0606,
    pickupName: 'Kimironko Market',
    destinationLat: -1.9706,
    destinationLng: 30.1044,
    destinationName: 'Kigali Convention Centre',
    estimatedDistance: 6.1,
    vehiclePreference: null,
    wishPrice: 2000,
    goodsDescription: 'A wrapped box of medicine',
    goodsSizeCategory: 'MEDIUM',
    // PARCEL-CATEGORY — what the parcel CONTAINS. Content, not identity:
    // it belongs with the cargo the bidder must see, never with the
    // three people-columns the strip deletes.
    parcelCategory: 'ELECTRONICS',
    goodsWeightKg: 4.5,
    goodsFragile: true,
    deliverySpeed: 'STANDARD',
    standardDeliveryHours: 2,
    hasChildPassenger: false,
    travellingWithChild: null,
    createdAt: new Date('2026-08-22T08:00:00Z'),
    // The three that must not travel pre-match.
    recipientName: RECIPIENT_NAME,
    recipientPhone: RECIPIENT_PHONE,
    childGuardianPhone: GUARDIAN_PHONE,
    customer: { id: CUSTOMER_ID, nickname: 'Passenger', completedRides: 3 },
    legs: [],
    ...overrides,
  };
}

/**
 * Key ABSENCE, not an undefined value. A payload carrying
 * `recipientPhone: undefined` still names the field on the wire in some
 * serialisers and still reads as "we have no recipient" to a consumer; the
 * strip deletes.
 */
function expectProtectedKeysAbsent(payload: object, label: string) {
  for (const field of PROTECTED_JOURNEY_FIELDS_PRE_MATCH) {
    expect(Object.prototype.hasOwnProperty.call(payload, field)).toBe(false);
    expect(Object.keys(payload)).not.toContain(field);
  }
  // And nothing smuggled through in a nested or renamed shape.
  const wire = `${label}: ${JSON.stringify(payload)}`;
  expect(wire).not.toContain(RECIPIENT_PHONE);
  expect(wire).not.toContain(RECIPIENT_NAME);
  expect(wire).not.toContain(GUARDIAN_PHONE);
}

beforeEach(() => {
  jest.clearAllMocks();
  ratingFindUnique.mockResolvedValue(null);
  driverProfileFindUnique.mockResolvedValue({
    totalRides: 12,
    vehicleType: 'MOTO',
    lastLat: -1.9536,
    lastLng: 30.0606,
    lastLocationAt: new Date(),
  });
  feeWaiverFindMany.mockResolvedValue([]);
});

describe('PROTECTED_JOURNEY_FIELDS_PRE_MATCH', () => {
  test('is the floor the dispatch names, and names the recipient AND the guardian', () => {
    expect([...PROTECTED_JOURNEY_FIELDS_PRE_MATCH].sort()).toEqual([
      'childGuardianPhone',
      'recipientName',
      'recipientPhone',
    ]);
  });
});

describe('stripJourneyForScope', () => {
  test.each(['bidder', 'outsider'] as const)('%s loses every protected key', (scope) => {
    const stripped = stripJourneyForScope(parcelRow(), scope);
    expectProtectedKeysAbsent(stripped, scope);
    // And keeps everything that prices the job.
    expect(stripped.goodsSizeCategory).toBe('MEDIUM');
    expect(stripped.parcelCategory).toBe('ELECTRONICS');
    expect(stripped.goodsWeightKg).toBe(4.5);
    expect(stripped.goodsDescription).toBe('A wrapped box of medicine');
    expect(stripped.goodsFragile).toBe(true);
    expect(stripped.estimatedDistance).toBe(6.1);
    expect(stripped.wishPrice).toBe(2000);
    expect(stripped.type).toBe('GOODS');
  });

  test.each(['participant', 'privileged'] as const)(
    '%s is handed back the SAME object — byte-identical, invariant 1',
    (scope) => {
      const row = parcelRow();
      const out = stripJourneyForScope(row, scope);
      expect(out).toBe(row);
      expect(out.recipientName).toBe(RECIPIENT_NAME);
      expect(out.recipientPhone).toBe(RECIPIENT_PHONE);
      expect(out.childGuardianPhone).toBe(GUARDIAN_PHONE);
    },
  );

  test('does not mutate the row it was handed', () => {
    const row = parcelRow();
    stripJourneyForScope(row, 'bidder');
    expect(row.recipientPhone).toBe(RECIPIENT_PHONE);
  });
});

describe('getJourneyById', () => {
  test('a bidder on an open parcel gets the cargo and not the people', async () => {
    journeyFindUnique.mockResolvedValue(parcelRow());

    const payload = await getJourneyById('j1', BIDDER_ID);

    expectProtectedKeysAbsent(payload, 'bidder');
    expect((payload as any).goodsSizeCategory).toBe('MEDIUM');
    expect((payload as any).goodsWeightKg).toBe(4.5);
    // LIVE-WIRE G4's exact-net context is untouched by the strip.
    expect((payload as any).payoutContext).toBeTruthy();
  });

  test('an outsider gets the same strip', async () => {
    journeyFindUnique.mockResolvedValue(
      parcelRow({ status: JourneyStatus.MATCHED, driverId: DRIVER_ID }),
    );

    const payload = await getJourneyById('j1', 'nobody-at-all');

    expectProtectedKeysAbsent(payload, 'outsider');
  });

  test('the customer keeps every protected key', async () => {
    journeyFindUnique.mockResolvedValue(parcelRow());

    const payload: any = await getJourneyById('j1', CUSTOMER_ID);

    expect(payload.recipientName).toBe(RECIPIENT_NAME);
    expect(payload.recipientPhone).toBe(RECIPIENT_PHONE);
    expect(payload.childGuardianPhone).toBe(GUARDIAN_PHONE);
  });

  test('the matched driver keeps every protected key — GoodsPickupPage intact', async () => {
    journeyFindUnique.mockResolvedValue(
      parcelRow({ status: JourneyStatus.IN_PROGRESS, driverId: DRIVER_ID }),
    );

    const payload: any = await getJourneyById('j1', DRIVER_ID);

    expect(payload.recipientName).toBe(RECIPIENT_NAME);
    expect(payload.recipientPhone).toBe(RECIPIENT_PHONE);
    expect(payload.childGuardianPhone).toBe(GUARDIAN_PHONE);
  });
});

describe('getJourneys — the driver feed', () => {
  /** The three type-bucket findMany calls, in the order the service makes them. */
  function feedReturns(rows: object[]) {
    journeyFindFirst.mockResolvedValue(null); // not engaged on another ride
    journeyFindMany
      .mockResolvedValueOnce([]) // URGENT_MESSENGER
      .mockResolvedValueOnce([]) // PRIORITY_MESSENGER
      .mockResolvedValueOnce(rows); // everything else
  }

  /**
   * RIDES-REACH G1 — the OTHER branch of this arm. An own-rides query
   * issues ONE findMany (`where: { driverId }`), not the three priority
   * buckets: the urgent-first queue is a rule about which OPEN work to
   * offer next, and it has nothing to order on rides he is already on.
   */
  function ownRidesReturn(rows: object[]) {
    journeyFindMany.mockResolvedValue(rows);
  }

  test('an open parcel reaches the pool without its people', async () => {
    feedReturns([parcelRow({ escrow: null, discoveryStartedAt: new Date() })]);

    const feed = await getJourneys(BIDDER_ID, 'DRIVER', undefined, -1.9536, 30.0606, 'driver');

    expect(feed).toHaveLength(1);
    expectProtectedKeysAbsent(feed[0], 'feed');
    expect(feed[0].goodsSizeCategory).toBe('MEDIUM');
    expect(feed[0].goodsWeightKg).toBe(4.5);
    expect(feed[0].goodsFragile).toBe(true);
    // The mapper's own contribution is preserved.
    expect(feed[0].reopenedUnpaid).toBe(false);
  });

  test("a driver's own journey, read through the same mapper, keeps everything", async () => {
    // The driver branch also answers a status query, and on those rows the
    // requesting driver IS the participant.
    //
    // RIDES-REACH G1 — and now he is the participant BY THE QUERY, not
    // merely by how the fixture was written: an own-rides read is
    // `where: { driverId: userId, status }`, so `journeyViewerScope`
    // cannot be handed a row he is not on. The strip is still asserted
    // here because the mapper is shared with the feed, where it can be.
    ownRidesReturn([
      parcelRow({
        status: JourneyStatus.IN_PROGRESS,
        driverId: DRIVER_ID,
        escrow: null,
        discoveryStartedAt: new Date(),
      }),
    ]);

    const feed = await getJourneys(
      DRIVER_ID,
      'DRIVER',
      JourneyStatus.IN_PROGRESS,
      -1.9536,
      30.0606,
      'driver',
    );

    expect(feed).toHaveLength(1);
    expect(feed[0].recipientName).toBe(RECIPIENT_NAME);
    expect(feed[0].recipientPhone).toBe(RECIPIENT_PHONE);
    expect(feed[0].childGuardianPhone).toBe(GUARDIAN_PHONE);
    // And the query that fetched him it was scoped to him.
    expect(journeyFindMany).toHaveBeenCalledTimes(1);
    expect(journeyFindMany.mock.calls[0][0].where).toEqual({
      driverId: DRIVER_ID,
      status: JourneyStatus.IN_PROGRESS,
    });
  });
});

describe('the delivered-SMS path', () => {
  test('still reads recipientPhone server-internally — invariant 5', async () => {
    const inProgress = {
      id: 'j1',
      driverId: DRIVER_ID,
      customerId: CUSTOMER_ID,
      status: JourneyStatus.IN_PROGRESS,
      type: 'GOODS',
      pickupLat: -1.9536,
      pickupLng: 30.0606,
      destinationLat: -1.9706,
      destinationLng: 30.1044,
      recipientPhone: RECIPIENT_PHONE,
    };
    journeyFindUnique.mockResolvedValue(inProgress);
    gpsPointFindFirst.mockResolvedValue({ id: 'gp1' });
    journeyUpdate.mockResolvedValue({
      ...inProgress,
      status: JourneyStatus.AWAITING_CONFIRMATION,
      endedAt: new Date(),
    });

    await endJourney('j1', DRIVER_ID, -1.9706, 30.1044);

    expect(sendSms).toHaveBeenCalledTimes(1);
    expect(sendSms.mock.calls[0][0]).toBe(RECIPIENT_PHONE);
  });
});
