// ANY-VEHICLE G5 — the pin under the whole feature.
//
// The client half of any-vehicle (G1) rests entirely on one server
// behaviour that already existed: a journey with a NULL
// vehiclePreference passes the driver feed's vehicle prefilter for
// EVERY motari, whatever he rides. Nothing in this dispatch changes
// that filter — this file exists so nothing can change it by accident
// either.
//
// It was load-bearing but unpinned. The E2E suites relied on it
// implicitly (driver-feed.spec.ts creates preference-less journeys so
// its E_BIKE driver can see them) and the driver dashboard states it
// in a comment, but no test asserted it, and a one-character edit to
// journey.service.ts:660 would have quietly closed every any-vehicle
// request to every motari with the wrong machine.
//
// Both directions are pinned: null reaches drivers of DIFFERENT
// vehicle types, and a stated preference still reaches only the
// motari who rides that kind.

import { JourneyStatus, UserRole } from '@bimoto/shared';

jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    journey: {
      findMany: jest.fn(),
      // FIELD-FIT G5 — the feed asks whether this driver is already
      // carrying someone; null = not engaged.
      findFirst: jest.fn().mockResolvedValue(null),
    },
    driverProfile: {
      findUnique: jest.fn(),
    },
  },
}));

jest.mock('../utils/geo', () => ({
  haversineDistance: jest.fn().mockReturnValue(2.0), // inside the radius
}));

jest.mock('../services/discovery/feed-filter', () => ({
  // Passthrough, so the cascade ring cannot mask what the vehicle
  // prefilter did or did not do.
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

const KIGALI = { lat: -1.95, lng: 29.87 };

const ANY_VEHICLE_JOURNEY = 'j-any-vehicle';
const MOTO_ONLY_JOURNEY = 'j-moto-only';

function makeJourney(id: string, vehiclePreference: string | null) {
  return {
    id,
    customerId: 'customer-x',
    status: JourneyStatus.REQUESTED,
    type: 'PASSENGER',
    pickupLat: KIGALI.lat,
    pickupLng: KIGALI.lng,
    vehiclePreference,
    bids: [],
    customer: { id: 'customer-x', nickname: 'X', completedRides: 1 },
    createdAt: new Date('2026-08-24T08:00:00.000Z'),
    discoveryStartedAt: new Date('2026-08-24T08:00:00.000Z'),
  };
}

/** Both journeys are open; only the prefilter decides who sees which. */
function wireFeed() {
  (mockPrisma.journey.findMany as jest.Mock).mockImplementation(({ where }: any) => {
    if (where?.type === 'URGENT_MESSENGER' || where?.type === 'PRIORITY_MESSENGER') {
      return Promise.resolve([]);
    }
    return Promise.resolve([
      makeJourney(ANY_VEHICLE_JOURNEY, null),
      makeJourney(MOTO_ONLY_JOURNEY, 'MOTO'),
    ]);
  });
}

function asDriverRiding(vehicleType: string) {
  (mockPrisma.driverProfile.findUnique as jest.Mock).mockResolvedValue({
    userId: `driver-${vehicleType}`,
    vehicleType,
    lastLat: KIGALI.lat,
    lastLng: KIGALI.lng,
    lastLocationAt: new Date(),
  });
}

function feedFor(vehicleType: string, status?: JourneyStatus) {
  asDriverRiding(vehicleType);
  return journeyService.getJourneys(
    `driver-${vehicleType}`,
    UserRole.DRIVER,
    status,
    KIGALI.lat,
    KIGALI.lng,
    'driver',
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  (mockPrisma.journey.findFirst as jest.Mock).mockResolvedValue(null);
  wireFeed();
});

describe('ANY-VEHICLE G5 — a null-preference journey reaches every kind of motari', () => {
  // The heart of it: drivers of at least two DIFFERENT vehicle types
  // both see the same any-vehicle request.
  it.each(['BIKE', 'MOTO', 'E_MOTO', 'E_BIKE'])(
    'a %s driver sees the any-vehicle request',
    async (vehicleType) => {
      const ids = (await feedFor(vehicleType)).map((j: any) => j.id);
      expect(ids).toContain(ANY_VEHICLE_JOURNEY);
    },
  );

  it('two drivers on different machines see the SAME request', async () => {
    const bikeFeed = (await feedFor('BIKE')).map((j: any) => j.id);
    const eMotoFeed = (await feedFor('E_MOTO')).map((j: any) => j.id);

    expect(bikeFeed).toContain(ANY_VEHICLE_JOURNEY);
    expect(eMotoFeed).toContain(ANY_VEHICLE_JOURNEY);
    // ...and it is the only one they agree on, because the other
    // journey states MOTO.
    expect(bikeFeed).not.toContain(MOTO_ONLY_JOURNEY);
    expect(eMotoFeed).not.toContain(MOTO_ONLY_JOURNEY);
  });
});

describe('a stated preference still narrows the feed', () => {
  it('the MOTO-only request reaches the MOTO driver', async () => {
    const ids = (await feedFor('MOTO')).map((j: any) => j.id);
    expect(ids).toContain(MOTO_ONLY_JOURNEY);
    // ...alongside the any-vehicle one, which suits him too.
    expect(ids).toContain(ANY_VEHICLE_JOURNEY);
  });

  it('and reaches nobody else', async () => {
    for (const vehicleType of ['BIKE', 'E_MOTO', 'E_BIKE']) {
      const ids = (await feedFor(vehicleType)).map((j: any) => j.id);
      expect(ids).not.toContain(MOTO_ONLY_JOURNEY);
    }
  });
});

describe('the prefilter is a DISCOVERY rule — RIDES-REACH G1', () => {
  // RECONCILED, and the reconciliation is the point.
  //
  // This block used to assert that an explicitly-queried status went
  // through the same vehicle prefilter as the feed — "the prefilter is
  // not a discovery-phase-only rule". That was a true description of the
  // arm and a false description of the product: it was true only because
  // a status query had no `driverId` in its `where` at all, so it was
  // answering with OTHER PEOPLE'S journeys, which a vehicle prefilter is
  // exactly the right thing to narrow. The prefilter was doing sensible
  // work on rows that should never have been in the result.
  //
  // With the own-rides branch, a non-discovery query returns the rides HE
  // IS THE DRIVER OF. On those the prefilter would be worse than useless:
  // a motari who took a MOTO-preference job would find it missing from
  // his own list the day his profile said something else. So the two
  // halves are pinned separately now — the prefilter where it belongs,
  // and its ABSENCE where it belongs.
  it('still decides the discovery feed, for every kind of machine', async () => {
    for (const vehicleType of ['BIKE', 'E_MOTO']) {
      const ids = (await feedFor(vehicleType)).map((j: any) => j.id);
      expect(ids).toContain(ANY_VEHICLE_JOURNEY);
      expect(ids).not.toContain(MOTO_ONLY_JOURNEY);
    }
  });

  it('and does not touch a ride he is already the driver of', async () => {
    // His own MATCHED ride, whose customer once asked for a MOTO. He
    // rides a BIKE. It is still his ride.
    (mockPrisma.journey.findMany as jest.Mock).mockResolvedValue([
      {
        ...makeJourney(MOTO_ONLY_JOURNEY, 'MOTO'),
        status: JourneyStatus.MATCHED,
        driverId: 'driver-BIKE',
      },
    ]);

    const rides = await feedFor('BIKE', JourneyStatus.MATCHED);

    expect(rides.map((j: any) => j.id)).toEqual([MOTO_ONLY_JOURNEY]);
    // One query, scoped to him — not three buckets over everyone's rows.
    expect(mockPrisma.journey.findMany).toHaveBeenCalledTimes(1);
    expect((mockPrisma.journey.findMany as jest.Mock).mock.calls[0][0].where).toEqual({
      driverId: 'driver-BIKE',
      status: JourneyStatus.MATCHED,
    });
  });
});
