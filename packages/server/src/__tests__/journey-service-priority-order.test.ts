// __TESTS__/JOURNEY-SERVICE-PRIORITY-ORDER.TEST.TS
//
// R3-EXPRESS / R3-PRIORITY — verifies driver-view priority queue ordering.
//
// URGENT_MESSENGER journeys (R3-T) surface BEFORE PRIORITY_MESSENGER
// journeys (R3-PRIORITY), which surface BEFORE other journey types
// in the driver feed. Within the urgent and priority buckets the
// longest-waiting journey wins (oldest createdAt asc). Within the
// other bucket newest-first ordering is preserved. Customer view is
// unaffected by either dispatch.
//
// Smallest-wrongness gate (per R3-EXPRESS §8): the within-urgent
// test case catches the silent-swap bug where a bucket is
// concatenated correctly but ordered desc instead of asc — drivers
// would see urgent trips on top, but a 12-minute-old trip would
// languish behind a 30-second-old one.

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
  haversineDistance: jest.fn().mockReturnValue(2.0), // within 5km radius
}));

jest.mock('../services/discovery/feed-filter', () => ({
  // Passthrough so the test can assert on prisma's returned order
  // directly without the cascade ring filter masking the result.
  filterJourneysByCascade: jest.fn((_driver: any, candidates: any[]) => candidates),
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

const mockPrisma = prisma as any;

// Fixed timestamps: T0 < T1 < T2 < T3 < T4 < T5.
const T0 = new Date('2026-05-08T08:00:00.000Z'); // oldest urgent
const T1 = new Date('2026-05-08T08:05:00.000Z'); // newer urgent
const T2 = new Date('2026-05-08T08:10:00.000Z'); // oldest priority
const T3 = new Date('2026-05-08T08:15:00.000Z'); // newer priority
const T4 = new Date('2026-05-08T08:20:00.000Z'); // older standard
const T5 = new Date('2026-05-08T08:25:00.000Z'); // newest standard

const urgentOldId = 'j-urgent-old';
const urgentNewId = 'j-urgent-new';
const priorityOldId = 'j-priority-old';
const priorityNewId = 'j-priority-new';
const standardOldId = 'j-standard-old';
const standardNewId = 'j-standard-new';

const baseDriverProfile = {
  userId: 'driver-1',
  vehicleType: 'MOTO',
  lastLat: -1.95,
  lastLng: 29.87,
  lastLocationAt: new Date(),
};

function makeJourney(id: string, type: string, createdAt: Date) {
  return {
    id,
    customerId: 'customer-x',
    status: JourneyStatus.REQUESTED,
    type,
    pickupLat: -1.95,
    pickupLng: 29.87,
    vehiclePreference: null,
    bids: [],
    customer: { id: 'customer-x', nickname: 'X', completedRides: 1 },
    createdAt,
    discoveryStartedAt: createdAt,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (mockPrisma.driverProfile.findUnique as jest.Mock).mockResolvedValue(
    baseDriverProfile,
  );
});

describe('R3-EXPRESS / R3-PRIORITY — driver-view priority queue', () => {
  function wireDriverFeedMocks() {
    // Three findMany calls: urgent bucket (asc), priority bucket
    // (asc), other bucket (desc). The service concatenates
    // urgent ++ priority ++ other.
    (mockPrisma.journey.findMany as jest.Mock).mockImplementation(
      ({ where, orderBy }: any) => {
        if (where?.type === 'URGENT_MESSENGER') {
          expect(orderBy).toEqual({ createdAt: 'asc' });
          return Promise.resolve([
            makeJourney(urgentOldId, 'URGENT_MESSENGER', T0),
            makeJourney(urgentNewId, 'URGENT_MESSENGER', T1),
          ]);
        }
        if (where?.type === 'PRIORITY_MESSENGER') {
          expect(orderBy).toEqual({ createdAt: 'asc' });
          return Promise.resolve([
            makeJourney(priorityOldId, 'PRIORITY_MESSENGER', T2),
            makeJourney(priorityNewId, 'PRIORITY_MESSENGER', T3),
          ]);
        }
        // Other bucket
        expect(where?.type).toEqual({
          notIn: ['URGENT_MESSENGER', 'PRIORITY_MESSENGER'],
        });
        expect(orderBy).toEqual({ createdAt: 'desc' });
        return Promise.resolve([
          makeJourney(standardNewId, 'PASSENGER', T5),
          makeJourney(standardOldId, 'PASSENGER', T4),
        ]);
      },
    );
  }

  it('urgent journeys appear before priority and other journeys', async () => {
    wireDriverFeedMocks();
    const result = await journeyService.getJourneys(
      'driver-1',
      UserRole.DRIVER,
      JourneyStatus.REQUESTED,
      -1.95,
      29.87,
      'driver',
    );
    const ids = result.map((j: any) => j.id);
    expect(ids.length).toBe(6);
    expect(ids.slice(0, 2)).toEqual(
      expect.arrayContaining([urgentOldId, urgentNewId]),
    );
    expect(ids.slice(2, 4)).toEqual(
      expect.arrayContaining([priorityOldId, priorityNewId]),
    );
    expect(ids.slice(4)).toEqual(
      expect.arrayContaining([standardOldId, standardNewId]),
    );
  });

  it('within urgent bucket, oldest-first (longest-waiting wins)', async () => {
    wireDriverFeedMocks();
    const result = await journeyService.getJourneys(
      'driver-1',
      UserRole.DRIVER,
      JourneyStatus.REQUESTED,
      -1.95,
      29.87,
      'driver',
    );
    expect(result[0].id).toBe(urgentOldId); // T0
    expect(result[1].id).toBe(urgentNewId); // T1
  });

  it('within priority bucket, oldest-first (longest-waiting wins)', async () => {
    wireDriverFeedMocks();
    const result = await journeyService.getJourneys(
      'driver-1',
      UserRole.DRIVER,
      JourneyStatus.REQUESTED,
      -1.95,
      29.87,
      'driver',
    );
    expect(result[2].id).toBe(priorityOldId); // T2
    expect(result[3].id).toBe(priorityNewId); // T3
  });

  it('within other bucket, newest-first preserved', async () => {
    wireDriverFeedMocks();
    const result = await journeyService.getJourneys(
      'driver-1',
      UserRole.DRIVER,
      JourneyStatus.REQUESTED,
      -1.95,
      29.87,
      'driver',
    );
    expect(result[4].id).toBe(standardNewId); // T5
    expect(result[5].id).toBe(standardOldId); // T4
  });

  it('customer view unaffected (single findMany, newest-first across all types)', async () => {
    // Customer branch issues exactly one findMany without a type filter.
    const customerJourneys = [
      makeJourney(urgentNewId, 'URGENT_MESSENGER', T3),
      makeJourney(standardOldId, 'PASSENGER', T2),
      makeJourney(urgentOldId, 'URGENT_MESSENGER', T1),
      makeJourney(standardNewId, 'PASSENGER', T0),
    ].map((j) => ({ ...j, customerId: 'customer-1', escrow: null }));
    (mockPrisma.journey.findMany as jest.Mock).mockResolvedValue(
      customerJourneys,
    );

    const result = await journeyService.getJourneys(
      'customer-1',
      UserRole.CUSTOMER,
      undefined,
      undefined,
      undefined,
      'customer',
    );

    // Service returns whatever prisma yielded — no urgent re-ordering.
    expect(result.map((j: any) => j.id)).toEqual([
      urgentNewId,
      standardOldId,
      urgentOldId,
      standardNewId,
    ]);
    // Customer branch should issue exactly one findMany (no bucket split).
    expect((mockPrisma.journey.findMany as jest.Mock).mock.calls.length).toBe(1);
    const call = (mockPrisma.journey.findMany as jest.Mock).mock.calls[0][0];
    expect(call.orderBy).toEqual({ createdAt: 'desc' });
    expect(call.where).toEqual(
      expect.objectContaining({ customerId: 'customer-1' }),
    );
    // Customer where-clause must NOT carry a type filter — that's the
    // marker of the driver-only bucket-merge path.
    expect(call.where.type).toBeUndefined();
  });
});
