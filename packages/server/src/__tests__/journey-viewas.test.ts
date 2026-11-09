import { JourneyStatus, UserRole } from '@bimoto/shared';

jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    journey: {
      findMany: jest.fn(),
      // FIELD-FIT G5 — the feed asks whether this driver is already
      // carrying someone before building a feed; null = not engaged.
      findFirst: jest.fn().mockResolvedValue(null),
    },
    driverProfile: {
      findUnique: jest.fn(),
    },
  },
}));

jest.mock('../utils/geo', () => ({
  haversineDistance: jest.fn().mockReturnValue(2.0), // 2km, within 5km radius
}));

jest.mock('../services/escrow.service', () => ({
  releaseEscrow: jest.fn().mockResolvedValue({}),
  refundEscrow: jest.fn().mockResolvedValue({}),
  freezeEscrow: jest.fn().mockResolvedValue({}),
}));

jest.mock('../services/escrow-audit.service', () => ({
  appendAuditEntry: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../services/journey-validation.service', () => ({
  validateJourneyPlausibility: jest.fn().mockResolvedValue({ valid: true, flags: [] }),
}));

import prisma from '../prisma';
import * as journeyService from '../services/journey.service';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getJourneys with viewAs parameter', () => {
  test('BOTH user sees customer journeys with viewAs=customer', async () => {
    const customerJourneys = [
      {
        id: 'j1',
        customerId: 'both-user',
        status: JourneyStatus.REQUESTED,
        bids: [],
        escrow: null,
      },
    ];
    (mockPrisma.journey.findMany as jest.Mock).mockResolvedValue(customerJourneys);

    const result = await journeyService.getJourneys(
      'both-user',
      UserRole.BOTH,
      undefined,
      undefined,
      undefined,
      'customer',
    );

    expect(result).toEqual(customerJourneys);
    expect(mockPrisma.journey.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ customerId: 'both-user' }),
      }),
    );
  });

  test('BOTH user sees driver feed with viewAs=driver', async () => {
    (mockPrisma.driverProfile.findUnique as jest.Mock).mockResolvedValue({
      userId: 'both-user',
      vehicleType: 'MOTO',
      // K1 cascade reads driver's last known location for ring filter.
      lastLat: -1.95,
      lastLng: 29.87,
      lastLocationAt: new Date(),
    });

    const driverJourneys = [
      {
        id: 'j2',
        customerId: 'other-customer',
        status: JourneyStatus.REQUESTED,
        type: 'PASSENGER',
        pickupLat: -1.95,
        pickupLng: 29.87,
        vehiclePreference: null,
        bids: [],
        customer: { id: 'other-customer', nickname: 'Other', completedRides: 5 },
        // K1 cascade computes ring from discoveryStartedAt|createdAt.
        createdAt: new Date(),
        discoveryStartedAt: new Date(),
      },
    ];
    // R3-EXPRESS / R3-PRIORITY — driver branch issues three findMany
    // calls (urgent asc + priority asc + other desc). Mock per-where
    // to return the fixture only for the "other" bucket; urgent and
    // priority buckets are empty.
    (mockPrisma.journey.findMany as jest.Mock).mockImplementation(
      ({ where }: any) => {
        if (where?.type === 'URGENT_MESSENGER') return Promise.resolve([]);
        if (where?.type === 'PRIORITY_MESSENGER') return Promise.resolve([]);
        return Promise.resolve(driverJourneys);
      },
    );

    const result = await journeyService.getJourneys(
      'both-user',
      UserRole.BOTH,
      undefined,
      -1.95,
      29.87,
      'driver',
    );

    // LIVE-WIRE G5 — the driver feed derives `reopenedUnpaid` per row
    // from the surviving escrow. These fixtures have no escrow, which is
    // the first-time-request case: false.
    //
    // MONEY-VIEW v2 G2 — and the raw `bids` array is GONE from the row,
    // replaced by a count and this motari's own bid. It was every rival's
    // price, on every card, to every motari in radius. The fixtures carry
    // `bids: []` and no `_count`, so the count is 0 and `myBid` is null;
    // the seal itself is asserted in money-view-bids-scope.test.ts and
    // pinned at the wire in journey-read-authorization.spec.
    expect(result).toEqual(
      driverJourneys.map(({ bids: _bids, ...j }) => ({
        ...j,
        reopenedUnpaid: false,
        bidCount: 0,
        myBid: null,
      })),
    );
    expect(mockPrisma.driverProfile.findUnique).toHaveBeenCalledWith({
      where: { userId: 'both-user' },
    });
  });

  // RIDES-REACH G1 — RECONCILED, with a stronger fact than this file
  // used to carry.
  //
  // When these tests were written, "the driver feed" and "the driver
  // arm" were the same thing: one `where`, one shape, and every driver
  // query — feed or not — went through it. That is what made
  // `?history=true` (no coordinates) 400 and what made `?status=X`
  // return other people's journeys.
  //
  // The arm now forks. The three cases above are all DISCOVERY reads,
  // and they are pinned here precisely because they must not move: same
  // three priority buckets, same radius gate, same row shape. The other
  // half of the fork — own-rides, `where: { driverId }`, no coordinate —
  // is pinned in rides-reach-driver-arm.test.ts against a `findMany`
  // fake that honours its `where`, which is the only kind of mock that
  // can tell a scoped read from an unscoped one.
  test('the driver feed still refuses a coordinate-less DISCOVERY query', async () => {
    await expect(
      journeyService.getJourneys('both-user', UserRole.BOTH, undefined, undefined, undefined, 'driver'),
    ).rejects.toMatchObject({ code: 'LOCATION_REQUIRED' });
    // The fork did not move the gate off the feed — it moved the feed
    // under the gate.
    expect(mockPrisma.journey.findMany).not.toHaveBeenCalled();
  });

  test('BOTH user defaults to customer view without viewAs parameter', async () => {
    const customerJourneys = [
      {
        id: 'j3',
        customerId: 'both-user',
        status: JourneyStatus.COMPLETED,
        bids: [],
        escrow: null,
      },
    ];
    (mockPrisma.journey.findMany as jest.Mock).mockResolvedValue(customerJourneys);

    const result = await journeyService.getJourneys(
      'both-user',
      UserRole.BOTH,
    );

    expect(result).toEqual(customerJourneys);
    expect(mockPrisma.journey.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ customerId: 'both-user' }),
      }),
    );
  });
});
