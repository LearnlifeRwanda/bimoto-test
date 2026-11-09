// __TESTS__/URGENT-JOURNEY.TEST.TS
//
// R3-T — verifies the URGENT_MESSENGER trip type wires up the
// cascade bypass on createJourney and the 30-min target window stamp
// on acceptBid. These tests gate the smallest-wrongness condition:
// without them, an URGENT_MESSENGER value on the enum could ship
// while still suffering K1's slow-roll cascade — defeating the
// entire point of an urgent dispatch.

import { JourneyStatus, BidStatus, JourneyType } from '@bimoto/shared';

jest.mock('../prisma', () => {
  const journeyCreate = jest.fn();
  return {
    __esModule: true,
    default: {
      journey: {
        create: journeyCreate,
        findUnique: jest.fn(),
        update: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
      bid: {
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      leg: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      driverProfile: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      user: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      // LAUNCH-TRUTH G3 — acceptBid resolves the driver's fee waiver;
      // default to no waiver (behaviour identical to before).
      feeWaiver: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      // R3-LEGS — createJourney wraps journey.create + legs.createMany in
      // $transaction. Without invoking the callback the wrapping returns
      // undefined and the subsequent journey.status access throws.
      $transaction: jest.fn(async (cb: any) => {
        const tx = {
          // SETTLE-UP G2 — acceptBidCore reads the journey's escrow inside
          // the claim transaction before deciding create-vs-adopt. These
          // journeys have no surviving escrow, so the lookup answers null
          // and the create branch runs exactly as before.
          escrow: { findUnique: jest.fn().mockResolvedValue(null) },
          journey: { create: journeyCreate },
          leg: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
        };
        return cb(tx);
      }),
    },
  };
});

jest.mock('../services/discovery/supply-broadcast', () => ({
  scheduleCascadeBroadcasts: jest.fn(),
}));

jest.mock('../services/discovery/urgent-broadcast', () => ({
  broadcastUrgentImmediately: jest.fn().mockResolvedValue([]),
}));

jest.mock('../services/customer-modes/suggest-up-scheduler', () => ({
  scheduleSuggestUpEmits: jest.fn(),
}));

jest.mock('../socket', () => ({
  emitToJourney: jest.fn(),
  getIO: () => {
    throw new Error('not initialized');
  },
}));

jest.mock('../services/escrow.service', () => ({
  createEscrow: jest.fn().mockResolvedValue({}),
  // BID-ATOMICITY G1 — escrow creation moved inside the accept transaction.
  createEscrowTx: jest.fn().mockResolvedValue({}),
}));

jest.mock('../config', () => ({
  config: {
    SKIP_DRIVER_VERIFICATION: true,
    DATABASE_URL: 'test',
    JWT_SECRET: 'test-jwt-secret-at-least-16-chars',
    JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-16-chars',
    ENCRYPTION_KEY: 'a'.repeat(64),
    PORT: 3000,
    CLIENT_URL: 'http://localhost:5173',
    NODE_ENV: 'test',
  },
}));

import prisma from '../prisma';
import * as journeyService from '../services/journey.service';
import * as bidService from '../services/bid.service';
import * as urgentBroadcast from '../services/discovery/urgent-broadcast';
import * as supplyBroadcast from '../services/discovery/supply-broadcast';
// CUTGUARD v2 G4 — the actor is now a TYPE (services/session-actor.ts).
// A test stands in for a session, so it says so with an explicit cast at
// the call rather than passing a bare string, which is what made the
// tautology writable in the first place.
import { customerActor, type SessionUserId } from '../services/session-actor';

const mockPrisma = prisma as any;
const mockUrgentBroadcast = urgentBroadcast.broadcastUrgentImmediately as jest.Mock;
const mockScheduleCascade = supplyBroadcast.scheduleCascadeBroadcasts as jest.Mock;

const baseInput = {
  pickupLat: -1.95,
  pickupLng: 30.06,
  pickupName: 'Pickup',
  destinationLat: -1.96,
  destinationLng: 30.07,
  destinationName: 'Drop',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.user.findUnique.mockResolvedValue({ id: 'c1', isFlagged: false });
  mockPrisma.journey.create.mockImplementation(({ data }: any) =>
    Promise.resolve({
      id: 'j1',
      ...data,
      pickupLat: data.pickupLat,
      pickupLng: data.pickupLng,
      discoveryStartedAt: new Date(),
      createdAt: new Date(),
    }),
  );
});

describe('R3-T — createJourney with URGENT_MESSENGER', () => {
  it('calls broadcastUrgentImmediately and NOT scheduleCascadeBroadcasts for URGENT_MESSENGER', async () => {
    await journeyService.createJourney('c1', {
      ...baseInput,
      type: JourneyType.URGENT_MESSENGER,
    } as any);

    expect(mockUrgentBroadcast).toHaveBeenCalledTimes(1);
    expect(mockUrgentBroadcast).toHaveBeenCalledWith(
      expect.objectContaining({
        journeyId: 'j1',
        pickup: { lat: -1.95, lng: 30.06 },
      }),
    );
    expect(mockScheduleCascade).not.toHaveBeenCalled();
  });

  it('calls scheduleCascadeBroadcasts (NOT urgent broadcast) for GOODS — regression check', async () => {
    await journeyService.createJourney('c1', {
      ...baseInput,
      type: JourneyType.GOODS,
    } as any);

    expect(mockScheduleCascade).toHaveBeenCalledTimes(1);
    expect(mockUrgentBroadcast).not.toHaveBeenCalled();
  });

  it('calls scheduleCascadeBroadcasts (NOT urgent broadcast) for PASSENGER — regression check', async () => {
    await journeyService.createJourney('c1', {
      ...baseInput,
      type: JourneyType.PASSENGER,
    } as any);

    expect(mockScheduleCascade).toHaveBeenCalledTimes(1);
    expect(mockUrgentBroadcast).not.toHaveBeenCalled();
  });
});

describe('R3-T — acceptBid stamps targetCompletionAt for URGENT_MESSENGER', () => {
  function setupCommonAcceptMocks(journeyType: string) {
    mockPrisma.journey.findUnique.mockResolvedValue({
      id: 'j1',
      customerId: 'c1',
      status: JourneyStatus.REQUESTED,
      type: journeyType,
    });
    mockPrisma.bid.findUnique.mockResolvedValue({
      id: 'b1',
      journeyId: 'j1',
      driverId: 'd1',
      price: 2000,
      status: BidStatus.PENDING,
    });
    mockPrisma.driverProfile.findUnique.mockResolvedValue({
      userId: 'd1',
      totalRides: 20,
    });
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'c1',
      completedRides: 5,
    });
  }

  it('URGENT_MESSENGER acceptBid sets targetCompletionAt = matchedAt + 30 min', async () => {
    setupCommonAcceptMocks(JourneyType.URGENT_MESSENGER);

    // BID-ATOMICITY G1 — the MATCHED flip is a status-predicated
    // updateMany claim; the stamps travel in its data.
    const journeyClaim = jest.fn().mockResolvedValue({ count: 1 });
    (mockPrisma.$transaction as jest.Mock).mockImplementation(async (fn: Function) => {
      const tx = {
        // SETTLE-UP G2 — acceptBidCore reads the journey's escrow inside
        // the claim transaction before deciding create-vs-adopt. These
        // journeys have no surviving escrow, so the lookup answers null
        // and the create branch runs exactly as before.
        escrow: { findUnique: jest.fn().mockResolvedValue(null) },
        bid: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          findUnique: jest.fn().mockResolvedValue({ id: 'b1', status: BidStatus.ACCEPTED }),
          // LIVE-WIRE G2 — acceptBidCore reads the losing bids inside the
          // claim transaction so the drivers it declined can be told.
          findMany: jest.fn().mockResolvedValue([]),
        },
        journey: {
          updateMany: journeyClaim,
          findUnique: jest.fn().mockResolvedValue({ id: 'j1', status: JourneyStatus.MATCHED }),
        },
      };
      return fn(tx);
    });

    await bidService.acceptBid('j1', customerActor('c1' as SessionUserId), 'b1');

    expect(journeyClaim).toHaveBeenCalledTimes(1);
    const data = journeyClaim.mock.calls[0][0].data;
    expect(data.matchedAt).toBeInstanceOf(Date);
    expect(data.targetCompletionAt).toBeInstanceOf(Date);
    const delta = data.targetCompletionAt.getTime() - data.matchedAt.getTime();
    expect(delta).toBe(30 * 60 * 1000);
  });

  it('GOODS acceptBid leaves targetCompletionAt as null', async () => {
    setupCommonAcceptMocks(JourneyType.GOODS);

    const journeyClaim = jest.fn().mockResolvedValue({ count: 1 });
    (mockPrisma.$transaction as jest.Mock).mockImplementation(async (fn: Function) => {
      const tx = {
        // SETTLE-UP G2 — acceptBidCore reads the journey's escrow inside
        // the claim transaction before deciding create-vs-adopt. These
        // journeys have no surviving escrow, so the lookup answers null
        // and the create branch runs exactly as before.
        escrow: { findUnique: jest.fn().mockResolvedValue(null) },
        bid: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          findUnique: jest.fn().mockResolvedValue({ id: 'b1', status: BidStatus.ACCEPTED }),
          // LIVE-WIRE G2 — acceptBidCore reads the losing bids inside the
          // claim transaction so the drivers it declined can be told.
          findMany: jest.fn().mockResolvedValue([]),
        },
        journey: {
          updateMany: journeyClaim,
          findUnique: jest.fn().mockResolvedValue({ id: 'j1', status: JourneyStatus.MATCHED }),
        },
      };
      return fn(tx);
    });

    await bidService.acceptBid('j1', customerActor('c1' as SessionUserId), 'b1');

    const data = journeyClaim.mock.calls[0][0].data;
    expect(data.matchedAt).toBeInstanceOf(Date);
    expect(data.targetCompletionAt).toBeNull();
  });
});

describe('R3-T — broadcastUrgentImmediately graceful degradation', () => {
  // Reset the mock so we exercise the real implementation here.
  // jest.unmock doesn't work after the auto-mock; instead, import the
  // real module directly.
  const realUrgentBroadcast = jest.requireActual(
    '../services/discovery/urgent-broadcast',
  ) as typeof import('../services/discovery/urgent-broadcast');

  it('returns an empty list when no candidates are online (io=null is safe)', async () => {
    mockPrisma.driverProfile.findMany.mockResolvedValue([]);
    const notified = await realUrgentBroadcast.broadcastUrgentImmediately({
      prisma: mockPrisma,
      io: null,
      journeyId: 'j1',
      pickup: { lat: -1.95, lng: 30.06 },
    });
    expect(notified).toEqual([]);
  });
});
