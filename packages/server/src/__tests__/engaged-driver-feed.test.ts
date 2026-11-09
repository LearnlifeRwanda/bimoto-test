// FIELD-FIT G5 — a motari carrying a passenger is not offered another.
//
// The team asked for this, and asked to know how often it happens, so
// the block is counted as well as applied. Enforced in the discovery
// feed rather than at bid time: the point is that the second request
// never appears.

jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    journey: { findFirst: jest.fn(), findMany: jest.fn() },
    driverProfile: { findUnique: jest.fn() },
    adminAction: { findMany: jest.fn() },
  },
}));

import prisma from '../prisma';
import {
  getJourneys,
  getEngagedDriverFeedBlockCounts,
  _resetEngagedDriverFeedBlockCounts,
} from '../services/journey.service';

const mockPrisma = prisma as any;
const KIGALI = { lat: -1.9536, lng: 30.0606 };

function engagedOn(status: string) {
  mockPrisma.journey.findFirst.mockResolvedValue({ id: 'j-active', status });
}
function notEngaged() {
  mockPrisma.journey.findFirst.mockResolvedValue(null);
}

beforeEach(() => {
  jest.clearAllMocks();
  _resetEngagedDriverFeedBlockCounts();
  mockPrisma.driverProfile.findUnique.mockResolvedValue({
    userId: 'd1',
    vehicleType: 'MOTO',
    lastLat: KIGALI.lat,
    lastLng: KIGALI.lng,
    lastLocationAt: new Date(),
  });
  // The driver feed queries three priority buckets (urgent, priority,
  // everything else) and concatenates them. Answer only the last, so an
  // unblocked feed holds exactly one request.
  mockPrisma.journey.findMany.mockImplementation(async (args: any) =>
    args?.where?.type?.notIn
      ? [
          {
            id: 'open-1',
            status: 'REQUESTED',
            type: 'PASSENGER',
            pickupLat: KIGALI.lat,
            pickupLng: KIGALI.lng,
            vehiclePreference: 'MOTO',
            createdAt: new Date(),
            bids: [],
          },
        ]
      : [],
  );
});

const feed = (status?: string) =>
  getJourneys('d1', 'DRIVER', status, KIGALI.lat, KIGALI.lng, 'driver');

describe('an engaged driver gets no new requests', () => {
  test.each(['MATCHED', 'IN_PROGRESS', 'AWAITING_CONFIRMATION'])(
    'a driver on a %s journey sees an empty feed',
    async (status) => {
      engagedOn(status);
      await expect(feed()).resolves.toEqual([]);
      // No feed query was even issued.
      expect(mockPrisma.journey.findMany).not.toHaveBeenCalled();
    },
  );

  test('a free driver still sees the open requests', async () => {
    notEngaged();
    const result = await feed();
    expect(result).toHaveLength(1);
    expect(mockPrisma.journey.findMany).toHaveBeenCalled();
  });

  test('only the states that mean "carrying someone" block', async () => {
    notEngaged();
    await feed();
    const where = mockPrisma.journey.findFirst.mock.calls[0][0].where;
    expect(where.driverId).toBe('d1');
    expect(where.status.in).toEqual([
      'MATCHED',
      'IN_PROGRESS',
      'AWAITING_CONFIRMATION',
    ]);
  });

  test('a driver asking for a specific non-discovery status is unaffected', async () => {
    engagedOn('IN_PROGRESS');
    // RIDES-REACH G1 — a non-discovery query no longer goes through the
    // three type buckets, so the `type.notIn` mock above would answer it
    // with nothing. It is his OWN rides now: one findMany, `where:
    // { driverId, status }`. Answered here so the assertion below still
    // measures the engaged block rather than the mock's shape.
    mockPrisma.journey.findMany.mockImplementation(async (args: any) =>
      args?.where?.driverId === 'd1'
        ? [{ id: 'mine-1', status: 'COMPLETED', driverId: 'd1', bids: [] }]
        : [],
    );
    const result = await feed('COMPLETED');
    // The block is a discovery-feed rule, not a gag on every query.
    expect(result).toHaveLength(1);
    expect(mockPrisma.journey.findMany).toHaveBeenCalled();
    // And what it asked for was his, which is the half the `where` never
    // used to carry: before RIDES-REACH this same call returned every
    // COMPLETED journey in radius, whoever drove it.
    expect(mockPrisma.journey.findMany.mock.calls[0][0].where).toEqual({
      driverId: 'd1',
      status: 'COMPLETED',
    });
  });
});

describe('blocked attempts are counted', () => {
  test('each blocked poll increments the driver’s count', async () => {
    engagedOn('MATCHED');
    await feed();
    await feed();
    await feed();
    expect(getEngagedDriverFeedBlockCounts()).toEqual({ d1: 3 });
  });

  test('counts are per driver', async () => {
    engagedOn('IN_PROGRESS');
    await feed();
    await getJourneys('d2', 'DRIVER', undefined, KIGALI.lat, KIGALI.lng, 'driver');
    await getJourneys('d2', 'DRIVER', undefined, KIGALI.lat, KIGALI.lng, 'driver');
    expect(getEngagedDriverFeedBlockCounts()).toEqual({ d1: 1, d2: 2 });
  });

  test('a free driver is never counted', async () => {
    notEngaged();
    await feed();
    expect(getEngagedDriverFeedBlockCounts()).toEqual({});
  });

  test('each block emits one parseable log line naming the journey', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    engagedOn('MATCHED');
    await feed();
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('[FEED-BLOCKED] driver=d1 engagedOn=j-active status=MATCHED count=1'),
    );
    log.mockRestore();
  });
});
