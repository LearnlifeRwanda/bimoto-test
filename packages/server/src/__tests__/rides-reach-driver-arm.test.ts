// RIDES-REACH G1 — the driver arm's two questions, and the `where` that
// finally tells them apart.
//
// Two defects, one function. MONEY-VIEW (#207) reported both:
//
//   A. THE DEAD SCREEN. `/rides` is a DRIVER bottom-nav tab
//      (BottomNav.tsx driverTabs) and HistoryPage fetches
//      `GET /api/journeys?history=true` with no coordinates. The
//      LOCATION_REQUIRED gate stood above every branch of the driver
//      arm, so the request 400'd and the tab rendered an ErrorState —
//      as did `/driver/no-show-disputes`, which asks the same arm for
//      `status=CANCELLED` and also sends no coordinates.
//
//   B. THE IDOR. The arm's `where` was
//      `{ status: REQUESTED, ...(status ? { status } : {}) }` — the
//      `driverId: userId` its own comment promised was never written.
//      A driver querying any non-REQUESTED status therefore received
//      EVERY such journey in radius: a rival's completed ride, its
//      passenger, its route.
//
// The tests below are written against a `findMany` fake that HONOURS the
// `where` it is handed. That is deliberate: a mock that returns its
// fixtures regardless of the query cannot tell a scoped read from an
// unscoped one, which is precisely how B survived a full mocked suite.
// With this fake, restoring the old `where` turns the IDOR test red.

jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    journey: { findMany: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn() },
    driverProfile: { findUnique: jest.fn() },
    adminAction: { findMany: jest.fn().mockResolvedValue([]) },
  },
}));

// In radius, always — so nothing in these tests is excluded by distance.
// A row that does not come back came back out of the `where`.
jest.mock('../utils/geo', () => ({
  haversineDistance: jest.fn().mockReturnValue(1.0),
}));

// Passthrough, so the cascade ring cannot mask what the `where` did.
jest.mock('../services/discovery/feed-filter', () => ({
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

import { JourneyStatus, UserRole } from '@bimoto/shared';
import prisma from '../prisma';
import { getJourneys } from '../services/journey.service';

const mockPrisma = prisma as any;

const MOTARI = 'motari-1';
const RIVAL = 'motari-2';
const CUSTOMER = 'customer-1';
const KIGALI = { lat: -1.9536, lng: 30.0606 };

type Row = Record<string, any>;

function journey(over: Row = {}): Row {
  return {
    id: 'j-x',
    customerId: CUSTOMER,
    driverId: null,
    status: JourneyStatus.REQUESTED,
    type: 'PASSENGER',
    pickupLat: KIGALI.lat,
    pickupLng: KIGALI.lng,
    vehiclePreference: null,
    createdAt: new Date('2026-08-20T09:00:00.000Z'),
    discoveryStartedAt: new Date('2026-08-20T09:00:00.000Z'),
    escrow: null,
    bids: [],
    customer: { id: CUSTOMER, nickname: 'Passenger', completedRides: 3 },
    ...over,
  };
}

/** The rides that exist in this little world. */
const WORLD: Row[] = [
  // An open request nobody owns yet.
  journey({ id: 'open-1' }),
  // HIS completed ride.
  journey({
    id: 'mine-completed',
    driverId: MOTARI,
    status: JourneyStatus.COMPLETED,
    createdAt: new Date('2026-08-19T09:00:00.000Z'),
  }),
  // HIS ride in progress.
  journey({
    id: 'mine-in-progress',
    driverId: MOTARI,
    status: JourneyStatus.IN_PROGRESS,
    createdAt: new Date('2026-08-21T09:00:00.000Z'),
  }),
  // A RIVAL's completed ride — same street, same day, not his.
  journey({
    id: 'rivals-completed',
    driverId: RIVAL,
    status: JourneyStatus.COMPLETED,
    createdAt: new Date('2026-08-19T10:00:00.000Z'),
  }),
  // A rival's cancelled ride, for the no-show-disputes query.
  journey({
    id: 'rivals-cancelled',
    driverId: RIVAL,
    status: JourneyStatus.CANCELLED,
    cancelReason: 'DRIVER_NO_SHOW',
  }),
  // His own cancelled ride.
  journey({
    id: 'mine-cancelled',
    driverId: MOTARI,
    status: JourneyStatus.CANCELLED,
    cancelReason: 'DRIVER_NO_SHOW',
  }),
];

/** The half of Prisma's `where` these queries actually use. */
function matches(row: Row, where: Row = {}): boolean {
  if ('driverId' in where && row.driverId !== where.driverId) return false;
  if ('customerId' in where && row.customerId !== where.customerId) return false;
  if ('status' in where && row.status !== where.status) return false;
  if ('type' in where) {
    const t = where.type;
    if (typeof t === 'string' && row.type !== t) return false;
    if (t && typeof t === 'object' && Array.isArray(t.notIn) && t.notIn.includes(row.type)) {
      return false;
    }
  }
  return true;
}

/** `where` + `orderBy: { createdAt }`, which is all these queries ask for. */
function sorted({ where, orderBy }: any = {}): Row[] {
  const rows = WORLD.filter((r) => matches(r, where)).map((r) => ({ ...r }));
  const dir = orderBy?.createdAt;
  if (dir === 'asc' || dir === 'desc') {
    rows.sort((a, b) =>
      dir === 'asc'
        ? a.createdAt.getTime() - b.createdAt.getTime()
        : b.createdAt.getTime() - a.createdAt.getTime(),
    );
  }
  return rows;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.journey.findMany.mockImplementation(async (args: any) => sorted(args));
  // Not engaged on another ride, unless a test says otherwise.
  mockPrisma.journey.findFirst.mockResolvedValue(null);
  mockPrisma.driverProfile.findUnique.mockResolvedValue({
    userId: MOTARI,
    vehicleType: 'MOTO',
    lastLat: KIGALI.lat,
    lastLng: KIGALI.lng,
    lastLocationAt: new Date(),
  });
});

const ids = (rows: any[]) => rows.map((r: any) => r.id);

describe('finding A — the rides tab reaches an answer without a coordinate', () => {
  test('history=true returns his driven rides, with no lat/lng at all', async () => {
    const rides = await getJourneys(
      MOTARI,
      UserRole.DRIVER,
      undefined,
      undefined, // no lat
      undefined, // no lng
      undefined,
      true,
    );

    // Newest first, and every one of them his.
    expect(ids(rides)).toEqual(['mine-in-progress', 'mine-cancelled', 'mine-completed']);
    expect(rides.every((r: any) => r.driverId === MOTARI)).toBe(true);
  });

  test('the query it makes is scoped to him, with no status pin needed', async () => {
    await getJourneys(MOTARI, UserRole.DRIVER, undefined, undefined, undefined, undefined, true);

    // ONE query, not the three priority buckets.
    expect(mockPrisma.journey.findMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.journey.findMany.mock.calls[0][0].where).toEqual({ driverId: MOTARI });
    // A REQUESTED journey has driverId: null, so `driverId` alone already
    // means MATCHED-or-later. No status list is written, and none is needed.
    expect(ids(await getJourneys(
      MOTARI, UserRole.DRIVER, undefined, undefined, undefined, undefined, true,
    ))).not.toContain('open-1');
  });

  test('the driverProfile is not consulted — a missing one cannot re-kill the screen', async () => {
    mockPrisma.driverProfile.findUnique.mockResolvedValue(null);

    const rides = await getJourneys(
      MOTARI, UserRole.DRIVER, undefined, undefined, undefined, undefined, true,
    );

    expect(ids(rides)).toContain('mine-completed');
    expect(mockPrisma.driverProfile.findUnique).not.toHaveBeenCalled();
  });

  test('an engaged motari still sees his rides — the feed block is not a gag', async () => {
    mockPrisma.journey.findFirst.mockResolvedValue({
      id: 'mine-in-progress',
      status: JourneyStatus.IN_PROGRESS,
    });

    const rides = await getJourneys(
      MOTARI, UserRole.DRIVER, undefined, undefined, undefined, undefined, true,
    );

    expect(ids(rides)).toContain('mine-in-progress');
    // The block never even ran: it is a discovery-feed rule.
    expect(mockPrisma.journey.findFirst).not.toHaveBeenCalled();
  });
});

describe('finding B — a driver query cannot return another person\'s ride', () => {
  // THE IDOR PIN. Under the old `where`
  // (`{ status: REQUESTED, ...(status ? { status } : {}) }`) this query
  // asked the database for every COMPLETED journey, full stop. The
  // `findMany` fake above honours that `where`, so the rival's row was
  // returned, passed the (mocked in-radius) distance filter and the
  // null vehicle preference, and landed in the result. Restore that
  // `where` and this test goes red on `rivals-completed`.
  test('status=COMPLETED returns only his, and never a rival\'s in-radius ride', async () => {
    const rows = await getJourneys(
      MOTARI,
      UserRole.DRIVER,
      JourneyStatus.COMPLETED,
      KIGALI.lat,
      KIGALI.lng,
      'driver',
    );

    expect(ids(rows)).toEqual(['mine-completed']);
    expect(ids(rows)).not.toContain('rivals-completed');
    // Not one byte of the rival's row on the wire.
    expect(JSON.stringify(rows)).not.toContain('rivals-completed');
    expect(JSON.stringify(rows)).not.toContain(RIVAL);
    // And the seal is at the QUERY, where a later edit to the mapper
    // cannot undo it.
    expect(mockPrisma.journey.findMany.mock.calls[0][0].where).toEqual({
      driverId: MOTARI,
      status: JourneyStatus.COMPLETED,
    });
  });

  test('status=CANCELLED — the no-show-disputes query — is his alone, and needs no coordinate', async () => {
    const rows = await getJourneys(
      MOTARI,
      UserRole.DRIVER,
      JourneyStatus.CANCELLED,
      undefined,
      undefined,
      'driver',
    );

    expect(ids(rows)).toEqual(['mine-cancelled']);
    expect(JSON.stringify(rows)).not.toContain('rivals-cancelled');
  });

  test('a status query combines with history rather than fighting it', async () => {
    const rows = await getJourneys(
      MOTARI,
      UserRole.DRIVER,
      JourneyStatus.IN_PROGRESS,
      undefined,
      undefined,
      'driver',
      true,
    );

    expect(ids(rows)).toEqual(['mine-in-progress']);
    expect(mockPrisma.journey.findMany.mock.calls[0][0].where).toEqual({
      driverId: MOTARI,
      status: JourneyStatus.IN_PROGRESS,
    });
  });

  test('a customer who forges viewAs=driver reads nothing — the where is the whole gate', async () => {
    const rows = await getJourneys(
      CUSTOMER,
      UserRole.CUSTOMER,
      JourneyStatus.COMPLETED,
      KIGALI.lat,
      KIGALI.lng,
      'driver',
    );

    expect(rows).toEqual([]);
  });
});

describe('the discovery feed is untouched', () => {
  test('it still refuses to answer without a coordinate', async () => {
    await expect(
      getJourneys(MOTARI, UserRole.DRIVER, undefined, undefined, undefined, 'driver'),
    ).rejects.toMatchObject({ code: 'LOCATION_REQUIRED', statusCode: 400 });

    // history=false is the same request it always was.
    await expect(
      getJourneys(MOTARI, UserRole.DRIVER, undefined, undefined, undefined, 'driver', false),
    ).rejects.toMatchObject({ code: 'LOCATION_REQUIRED' });

    // ...and so is an explicit status=REQUESTED.
    await expect(
      getJourneys(
        MOTARI, UserRole.DRIVER, JourneyStatus.REQUESTED, undefined, undefined, 'driver',
      ),
    ).rejects.toMatchObject({ code: 'LOCATION_REQUIRED' });
  });

  test('it still returns the open request, through the three priority buckets', async () => {
    const feed = await getJourneys(
      MOTARI, UserRole.DRIVER, undefined, KIGALI.lat, KIGALI.lng, 'driver',
    );

    expect(ids(feed)).toEqual(['open-1']);
    expect(mockPrisma.journey.findMany).toHaveBeenCalledTimes(3);
    // Nobody's own rides ride along in the open feed.
    expect(JSON.stringify(feed)).not.toContain('mine-completed');
    expect(mockPrisma.driverProfile.findUnique).toHaveBeenCalledWith({
      where: { userId: MOTARI },
    });
  });

  test('the engaged-driver block still fires, and still returns []', async () => {
    mockPrisma.journey.findFirst.mockResolvedValue({
      id: 'mine-in-progress',
      status: JourneyStatus.IN_PROGRESS,
    });

    const feed = await getJourneys(
      MOTARI, UserRole.DRIVER, undefined, KIGALI.lat, KIGALI.lng, 'driver',
    );

    expect(feed).toEqual([]);
    expect(mockPrisma.journey.findMany).not.toHaveBeenCalled();
  });

  test('an explicit status=REQUESTED is still discovery, not own-rides', async () => {
    const feed = await getJourneys(
      MOTARI, UserRole.DRIVER, JourneyStatus.REQUESTED, KIGALI.lat, KIGALI.lng, 'driver',
    );

    expect(ids(feed)).toEqual(['open-1']);
    expect(mockPrisma.journey.findMany).toHaveBeenCalledTimes(3);
    // The `...(status ? { status } : {})` spread that used to sit on this
    // object could only ever write the value already there.
    expect(mockPrisma.journey.findMany.mock.calls[0][0].where).toEqual({
      status: JourneyStatus.REQUESTED,
      type: 'URGENT_MESSENGER',
    });
  });
});

describe('the customer arm does not move', () => {
  // §3 invariant: customer responses byte-identical. `history` is now a
  // DECLARED key, so it reaches the service instead of being stripped by
  // Zod — and this arm goes on ignoring it, because `customerId: userId`
  // already is her answer.
  test('with and without the newly-declared key, the same rows and the same query', async () => {
    const without = await getJourneys(CUSTOMER, UserRole.CUSTOMER);
    const withoutCall = mockPrisma.journey.findMany.mock.calls[0][0];

    // Call history only — the fake itself must stay identical between
    // the two reads, or this compares two different worlds.
    mockPrisma.journey.findMany.mockClear();

    const withKey = await getJourneys(
      CUSTOMER, UserRole.CUSTOMER, undefined, undefined, undefined, undefined, true,
    );
    const withCall = mockPrisma.journey.findMany.mock.calls[0][0];

    expect(JSON.stringify(withKey)).toEqual(JSON.stringify(without));
    expect(withCall).toEqual(withoutCall);
    expect(withCall.where).toEqual({ customerId: CUSTOMER });
    // Every row hers, none of them narrowed by the flag.
    expect(ids(withKey).sort()).toEqual(ids(WORLD).sort());
  });

  test('a BOTH user with no viewAs is still the customer, flag or no flag', async () => {
    const rows = await getJourneys(
      CUSTOMER, UserRole.BOTH, undefined, undefined, undefined, undefined, true,
    );

    expect(mockPrisma.journey.findMany.mock.calls[0][0].where).toEqual({
      customerId: CUSTOMER,
    });
    expect(rows.length).toBeGreaterThan(0);
  });
});
