import { JourneyStatus, BidStatus } from '@bimoto/shared';

jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    journey: {
      findUnique: jest.fn(),
      update: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    bid: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    driverProfile: {
      findUnique: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    leg: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    // LAUNCH-TRUTH G3 — acceptBid/getBidsForJourney resolve fee waivers;
    // default to no waiver (behaviour identical to before).
    feeWaiver: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
    $transaction: jest.fn(),
  },
}));

jest.mock('../services/escrow.service', () => ({
  createEscrow: jest.fn().mockResolvedValue({}),
  // BID-ATOMICITY G1 — escrow creation moved inside the accept transaction.
  createEscrowTx: jest.fn().mockResolvedValue({ id: 'esc-1', txRef: 'ref-1', status: 'PENDING' }),
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
import * as bidService from '../services/bid.service';
// CUTGUARD v2 G4 — the actor is now a TYPE (services/session-actor.ts).
// A test stands in for a session, so it says so with an explicit cast at
// the call rather than passing a bare string, which is what made the
// tautology writable in the first place.
import { customerActor, type SessionUserId } from '../services/session-actor';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Bid Service', () => {
  describe('createBid', () => {
    test('creates a bid when journey is REQUESTED', async () => {
      (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue({
        id: 'j1',
        status: JourneyStatus.REQUESTED,
        vehiclePreference: null,
      });
      (mockPrisma.bid.findUnique as jest.Mock).mockResolvedValue(null);
      (mockPrisma.driverProfile.findUnique as jest.Mock).mockResolvedValue({
        userId: 'd1',
        vehicleType: 'MOTO',
        totalRides: 5,
        verificationStatus: 'VERIFIED',
      });
      (mockPrisma.bid.create as jest.Mock).mockResolvedValue({
        id: 'b1',
        journeyId: 'j1',
        driverId: 'd1',
        price: 1500,
        etaMinutes: 5,
        status: BidStatus.PENDING,
      });

      const result = await bidService.createBid('j1', 'd1', 1500, 5);

      expect(result.status).toBe(BidStatus.PENDING);
      expect(result.price).toBe(1500);
    });

    test('rejects bid when journey is not REQUESTED', async () => {
      (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue({
        id: 'j1',
        status: JourneyStatus.MATCHED,
      });

      await expect(bidService.createBid('j1', 'd1', 1500, 5))
        .rejects.toThrow('errors.journeyNotAcceptingBids');
    });

    test('rejects bid when journey not found', async () => {
      (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(bidService.createBid('j1', 'd1', 1500, 5))
        .rejects.toThrow('errors.journeyNotFound');
    });

    test('rejects duplicate bid from same driver', async () => {
      (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue({
        id: 'j1',
        status: JourneyStatus.REQUESTED,
      });
      (mockPrisma.bid.findUnique as jest.Mock).mockResolvedValue({
        id: 'existing-bid',
        journeyId: 'j1',
        driverId: 'd1',
      });

      await expect(bidService.createBid('j1', 'd1', 1500, 5))
        .rejects.toThrow('errors.alreadyBid');
    });
  });

  describe('acceptBid', () => {
    test('accepts bid, transitions journey to MATCHED, declines other bids', async () => {
      (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue({
        id: 'j1',
        customerId: 'c1',
        status: JourneyStatus.REQUESTED,
      });
      (mockPrisma.bid.findUnique as jest.Mock).mockResolvedValue({
        id: 'b1',
        journeyId: 'j1',
        driverId: 'd1',
        price: 2000,
        status: BidStatus.PENDING,
      });
      (mockPrisma.driverProfile.findUnique as jest.Mock).mockResolvedValue({
        userId: 'd1',
        totalRides: 20,
      });
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'c1',
        completedRides: 5,
      });

      const txResult = {
        journey: { id: 'j1', status: JourneyStatus.MATCHED, driverId: 'd1', agreedPrice: 2000 },
        bid: { id: 'b1', status: BidStatus.ACCEPTED },
      };
      (mockPrisma.$transaction as jest.Mock).mockImplementation(async (fn: Function) => {
        const tx = {
          // SETTLE-UP G2 — acceptBidCore reads the journey's escrow inside
          // the claim transaction before deciding create-vs-adopt. These
          // journeys have no surviving escrow, so the lookup answers null
          // and the create branch runs exactly as before.
          escrow: { findUnique: jest.fn().mockResolvedValue(null) },
          bid: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            findUnique: jest.fn().mockResolvedValue(txResult.bid),
            // LIVE-WIRE G2 — acceptBidCore reads the losing bids inside
            // the claim transaction so their drivers can be told.
            findMany: jest.fn().mockResolvedValue([]),
          },
          journey: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            findUnique: jest.fn().mockResolvedValue(txResult.journey),
          },
        };
        return fn(tx);
      });

      const result = await bidService.acceptBid('j1', customerActor('c1' as SessionUserId), 'b1') as any;

      expect(result.journey.status).toBe(JourneyStatus.MATCHED);
      expect(result.bid.status).toBe(BidStatus.ACCEPTED);
    });

    // BID-ATOMICITY G1 — the in-transaction claims are predicated on the
    // status the stale guards saw; a claim matching zero rows means a rival
    // accept won the race. The loser gets the same BID_NOT_PENDING a
    // sequential second accept gets — never a 500 — and the transaction
    // rolls back so it mutates nothing.
    test('losing the journey claim throws BID_NOT_PENDING and never touches the bid', async () => {
      (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue({
        id: 'j1',
        customerId: 'c1',
        status: JourneyStatus.REQUESTED,
      });
      (mockPrisma.bid.findUnique as jest.Mock).mockResolvedValue({
        id: 'b1',
        journeyId: 'j1',
        driverId: 'd1',
        price: 2000,
        status: BidStatus.PENDING,
      });
      (mockPrisma.driverProfile.findUnique as jest.Mock).mockResolvedValue({
        userId: 'd1',
        totalRides: 20,
      });
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'c1',
        completedRides: 5,
      });

      const bidUpdateMany = jest.fn();
      (mockPrisma.$transaction as jest.Mock).mockImplementation(async (fn: Function) => {
        const tx = {
          // SETTLE-UP G2 — acceptBidCore reads the journey's escrow inside
          // the claim transaction before deciding create-vs-adopt. These
          // journeys have no surviving escrow, so the lookup answers null
          // and the create branch runs exactly as before.
          escrow: { findUnique: jest.fn().mockResolvedValue(null) },
          // A rival accept already MATCHED the journey: the predicated
          // claim matches zero rows.
          journey: {
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
            findUnique: jest.fn(),
          },
          bid: { updateMany: bidUpdateMany, findUnique: jest.fn() },
        };
        return fn(tx);
      });

      await expect(bidService.acceptBid('j1', customerActor('c1' as SessionUserId), 'b1'))
        .rejects.toThrow('errors.bidNotPending');
      expect(bidUpdateMany).not.toHaveBeenCalled();
    });

    test('losing the bid claim (bid already declined by a rival accept) throws BID_NOT_PENDING', async () => {
      (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue({
        id: 'j1',
        customerId: 'c1',
        status: JourneyStatus.REQUESTED,
      });
      (mockPrisma.bid.findUnique as jest.Mock).mockResolvedValue({
        id: 'b1',
        journeyId: 'j1',
        driverId: 'd1',
        price: 2000,
        status: BidStatus.PENDING,
      });
      (mockPrisma.driverProfile.findUnique as jest.Mock).mockResolvedValue({
        userId: 'd1',
        totalRides: 20,
      });
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'c1',
        completedRides: 5,
      });

      (mockPrisma.$transaction as jest.Mock).mockImplementation(async (fn: Function) => {
        const tx = {
          // SETTLE-UP G2 — acceptBidCore reads the journey's escrow inside
          // the claim transaction before deciding create-vs-adopt. These
          // journeys have no surviving escrow, so the lookup answers null
          // and the create branch runs exactly as before.
          escrow: { findUnique: jest.fn().mockResolvedValue(null) },
          journey: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            findUnique: jest.fn(),
          },
          bid: {
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
            findUnique: jest.fn(),
          },
        };
        return fn(tx);
      });

      await expect(bidService.acceptBid('j1', customerActor('c1' as SessionUserId), 'b1'))
        .rejects.toThrow('errors.bidNotPending');
    });

    test('rejects if user is not the journey customer', async () => {
      (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue({
        id: 'j1',
        customerId: 'c1',
        status: JourneyStatus.REQUESTED,
      });

      await expect(bidService.acceptBid('j1', customerActor('wrong-user' as SessionUserId), 'b1'))
        .rejects.toThrow('errors.notJourneyCustomer');
    });

    // R3-N-1 — matchedAt is set in the same tx as the REQUESTED→MATCHED
    // transition so cancel-flow elapsed-time gates have an authoritative
    // timestamp. Without this, every cancel after a fresh match would
    // fail TOO_EARLY_FOR_NO_SHOW with elapsedSinceMatched=0.
    test('acceptBid sets journey.matchedAt to a fresh timestamp in the MATCHED update', async () => {
      (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue({
        id: 'j1',
        customerId: 'c1',
        status: JourneyStatus.REQUESTED,
      });
      (mockPrisma.bid.findUnique as jest.Mock).mockResolvedValue({
        id: 'b1',
        journeyId: 'j1',
        driverId: 'd1',
        price: 2000,
        status: BidStatus.PENDING,
      });
      (mockPrisma.driverProfile.findUnique as jest.Mock).mockResolvedValue({
        userId: 'd1',
        totalRides: 20,
      });
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'c1',
        completedRides: 5,
      });

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
            // LIVE-WIRE G2 — the losing-bid read inside the claim.
            findMany: jest.fn().mockResolvedValue([]),
          },
          journey: {
            updateMany: journeyClaim,
            findUnique: jest.fn().mockResolvedValue({ id: 'j1', status: JourneyStatus.MATCHED }),
          },
        };
        return fn(tx);
      });

      const before = Date.now();
      await bidService.acceptBid('j1', customerActor('c1' as SessionUserId), 'b1');
      const after = Date.now();

      expect(journeyClaim).toHaveBeenCalledTimes(1);
      const callArgs = journeyClaim.mock.calls[0][0];
      expect(callArgs.data.status).toBe(JourneyStatus.MATCHED);
      expect(callArgs.data.matchedAt).toBeInstanceOf(Date);
      expect(callArgs.data.matchedAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(callArgs.data.matchedAt.getTime()).toBeLessThanOrEqual(after);
    });
  });

  describe('withdrawBid', () => {
    test('withdraws a PENDING bid', async () => {
      (mockPrisma.bid.findUnique as jest.Mock).mockResolvedValue({
        id: 'b1',
        driverId: 'd1',
        status: BidStatus.PENDING,
      });
      (mockPrisma.bid.update as jest.Mock).mockResolvedValue({
        id: 'b1',
        status: BidStatus.WITHDRAWN,
      });

      const result = await bidService.withdrawBid('b1', 'd1', 'USER');

      expect(result.status).toBe(BidStatus.WITHDRAWN);
      const updateArgs = (mockPrisma.bid.update as jest.Mock).mock.calls[0][0];
      expect(updateArgs.data.withdrawnSource).toBe('USER');
    });

    test('rejects if driver does not own the bid', async () => {
      (mockPrisma.bid.findUnique as jest.Mock).mockResolvedValue({
        id: 'b1',
        driverId: 'd1',
        status: BidStatus.PENDING,
      });

      await expect(bidService.withdrawBid('b1', 'wrong-driver', 'USER'))
        .rejects.toThrow('errors.notBidOwner');
    });
  });
});
