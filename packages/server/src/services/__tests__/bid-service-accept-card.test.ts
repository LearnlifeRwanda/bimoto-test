// R3-PAYMENT-CARD-ACCEPT-BID — service tests for the card-payment bid
// acceptance flow. Verifies the extracted `acceptBidCore` does not
// regress the MoMo `acceptBid` path and that `acceptBidForCard`:
//   - returns the escrow's txRef/amount for the client widget,
//   - leaves the escrow PENDING,
//   - NEVER charges MoMo (smallest-wrongness gate),
//   - honours the scheduled-ride conflict gate identically.

import { JourneyStatus, BidStatus, BookingMode } from '@bimoto/shared';
import { encrypt } from '../../utils/crypto';

jest.mock('../../prisma', () => ({
  __esModule: true,
  default: {
    journey: {
      findUnique: jest.fn(),
      update: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    bid: {
      findUnique: jest.fn(),
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
    // LAUNCH-TRUTH G3 — acceptBid resolves the driver's fee waiver;
    // default to no waiver (behaviour identical to before).
    feeWaiver: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
    $transaction: jest.fn(),
  },
}));

jest.mock('../escrow.service', () => ({
  createEscrow: jest.fn(),
  // BID-ATOMICITY G1 — escrow creation moved inside the accept transaction.
  createEscrowTx: jest.fn(),
  markEscrowChargeSucceeded: jest.fn(),
  markEscrowChargeFailed: jest.fn(),
}));

// chargeMomo is mocked so we can assert it is (acceptBid) / is NOT
// (acceptBidForCard) invoked. FlutterwaveError must stay a real class so
// `err instanceof FlutterwaveError` checks in acceptBid behave correctly.
jest.mock('../payment', () => {
  class FlutterwaveError extends Error {
    code: string;
    retryable: boolean;
    constructor(code: string, retryable = false) {
      super(code);
      this.code = code;
      this.retryable = retryable;
    }
  }
  return {
    __esModule: true,
    chargeMomo: jest.fn(),
    FlutterwaveError,
  };
});

jest.mock('../scheduled-rides', () => ({
  assertBidWindowOpen: jest.fn(),
  assertNoBlockingConflict: jest.fn(),
  recordConflictOverride: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../sms.service', () => ({
  sendSms: jest.fn().mockResolvedValue({ success: true }),
}));

jest.mock('../../config', () => ({
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

import prisma from '../../prisma';
import * as bidService from '../bid.service';
import * as escrowService from '../escrow.service';
import { chargeMomo } from '../payment';
import { assertNoBlockingConflict } from '../scheduled-rides';
// CUTGUARD v2 G4 — the actor is now a TYPE (services/session-actor.ts).
// A test stands in for a session, so it says so with an explicit cast at
// the call rather than passing a bare string, which is what made the
// tautology writable in the first place.
import { customerActor, type SessionUserId } from '../../services/session-actor';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const mockedChargeMomo = chargeMomo as jest.MockedFunction<typeof chargeMomo>;
const mockedCreateEscrow = (escrowService as any).createEscrowTx as jest.Mock;
const mockedConflict = assertNoBlockingConflict as jest.MockedFunction<
  typeof assertNoBlockingConflict
>;

function setupHappyPathMocks(escrowOverrides: Record<string, unknown> = {}) {
  (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue({
    id: 'j1',
    customerId: 'c1',
    status: JourneyStatus.REQUESTED,
    bookingMode: BookingMode.IMMEDIATE,
    type: 'PASSENGER',
  });
  (mockPrisma.bid.findUnique as jest.Mock).mockResolvedValue({
    id: 'b1',
    journeyId: 'j1',
    driverId: 'd1',
    price: 2000,
    etaMinutes: 8,
    status: BidStatus.PENDING,
  });
  (mockPrisma.driverProfile.findUnique as jest.Mock).mockResolvedValue({
    userId: 'd1',
    totalRides: 20,
  });
  (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
    id: 'c1',
    nickname: 'Aljo',
    phoneEncrypted: encrypt('+250788111111'),
    language: 'rw',
    completedRides: 5,
  });
  // BID-ATOMICITY G1 — claims are status-predicated updateMany calls;
  // the rows come back from in-tx findUniques.
  (mockPrisma.$transaction as jest.Mock).mockImplementation(async (fn: any) => {
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
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({
          id: 'j1',
          status: JourneyStatus.MATCHED,
          driverId: 'd1',
          agreedPrice: 2000,
        }),
      },
    };
    return fn(tx);
  });
  mockedCreateEscrow.mockResolvedValue({
    id: 'esc1',
    status: 'PENDING',
    txRef: 'bimoto-j1abc-123456',
    amount: 2000,
    ...escrowOverrides,
  } as any);
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('acceptBid (MoMo) regression after acceptBidCore extraction', () => {
  test('returns the journey/bid pair, commission breakdown + escrowStatus, and charges MoMo once', async () => {
    setupHappyPathMocks();
    mockedChargeMomo.mockResolvedValue({ status: 'PENDING' } as any);

    // CUTGUARD v2 amendment 2 — as a CURRENT client. The breakdown is
    // version-gated now (B-2's fourth surface), and this test is about
    // the acceptBidCore extraction, not about the gate: asking as v14
    // keeps it measuring the refactor.
    const result = (await bidService.acceptBid('j1', customerActor('c1' as SessionUserId), 'b1', {
      customerSavingsPreview: true,
    })) as any;

    // Same observable shape as before the refactor.
    expect(result.journey.status).toBe(JourneyStatus.MATCHED);
    expect(result.bid.status).toBe(BidStatus.ACCEPTED);
    expect(result.escrowStatus).toBe('PENDING');
    expect(result.commissionBreakdown.bidPrice).toBe(2000);
    // No card-specific fields leak into the MoMo response.
    expect(result.cardCheckout).toBeUndefined();
    expect(result.paymentMethod).toBeUndefined();

    // chargeMomo fired exactly once with the escrow's txRef.
    expect(mockedChargeMomo).toHaveBeenCalledTimes(1);
    expect(mockedChargeMomo.mock.calls[0][0]).toMatchObject({
      txRef: 'bimoto-j1abc-123456',
      escrowId: 'esc1',
      amount: 2000,
    });
  });
});

describe('acceptBidForCard', () => {
  test('happy path: returns matched journey/bid + cardCheckout { escrowId, txRef, amount }', async () => {
    setupHappyPathMocks();

    const result = (await bidService.acceptBidForCard('j1', customerActor('c1' as SessionUserId), 'b1')) as any;

    expect(result.journey.status).toBe(JourneyStatus.MATCHED);
    expect(result.bid.status).toBe(BidStatus.ACCEPTED);
    expect(result.paymentMethod).toBe('card');
    expect(result.cardCheckout).toEqual({
      escrowId: 'esc1',
      txRef: 'bimoto-j1abc-123456',
      amount: 2000,
    });
  });

  test('creates the escrow in PENDING with txRef populated', async () => {
    setupHappyPathMocks();

    const result = (await bidService.acceptBidForCard('j1', customerActor('c1' as SessionUserId), 'b1')) as any;

    expect(mockedCreateEscrow).toHaveBeenCalledTimes(1);
    expect(result.escrowStatus).toBe('PENDING');
    expect(result.cardCheckout.txRef).toBe('bimoto-j1abc-123456');
  });

  test('does NOT call chargeMomo (smallest-wrongness gate)', async () => {
    setupHappyPathMocks();

    await bidService.acceptBidForCard('j1', customerActor('c1' as SessionUserId), 'b1');

    expect(mockedChargeMomo).not.toHaveBeenCalled();
  });

  test('honours the scheduled-ride conflict gate: returns the same warning shape as acceptBid', async () => {
    setupHappyPathMocks();
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue({
      id: 'j1',
      customerId: 'c1',
      status: JourneyStatus.REQUESTED,
      bookingMode: BookingMode.SCHEDULED,
      scheduledFor: new Date('2030-01-01T10:00:00Z'),
      type: 'PASSENGER',
    });
    mockedConflict.mockResolvedValue({
      conflictingRides: [
        {
          id: 'other-journey',
          scheduledFor: new Date('2030-01-01T10:15:00Z'),
          pickupName: 'A',
          destinationName: 'B',
        },
      ],
    } as any);

    const result = (await bidService.acceptBidForCard('j1', customerActor('c1' as SessionUserId), 'b1')) as any;

    expect(result.matched).toBe(false);
    expect(result.conflictWarning.conflictingRides[0].id).toBe('other-journey');
    expect(result.cardCheckout).toBeUndefined();
    // No escrow created, no charge, when blocked by the conflict gate.
    expect(mockedCreateEscrow).not.toHaveBeenCalled();
    expect(mockedChargeMomo).not.toHaveBeenCalled();
  });

  test('acknowledgeConflict: true overrides the conflict and proceeds to cardCheckout', async () => {
    setupHappyPathMocks();
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue({
      id: 'j1',
      customerId: 'c1',
      status: JourneyStatus.REQUESTED,
      bookingMode: BookingMode.SCHEDULED,
      scheduledFor: new Date('2030-01-01T10:00:00Z'),
      type: 'PASSENGER',
    });
    mockedConflict.mockResolvedValue({
      conflictingRides: [
        {
          id: 'other-journey',
          scheduledFor: new Date('2030-01-01T10:15:00Z'),
          pickupName: 'A',
          destinationName: 'B',
        },
      ],
    } as any);

    const result = (await bidService.acceptBidForCard('j1', customerActor('c1' as SessionUserId), 'b1', {
      acknowledgeConflict: true,
    })) as any;

    expect(result.matched).not.toBe(false);
    expect(result.cardCheckout.escrowId).toBe('esc1');
    expect(mockedChargeMomo).not.toHaveBeenCalled();
  });

  test('non-PENDING bid throws BID_NOT_PENDING', async () => {
    setupHappyPathMocks();
    (mockPrisma.bid.findUnique as jest.Mock).mockResolvedValue({
      id: 'b1',
      journeyId: 'j1',
      driverId: 'd1',
      price: 2000,
      status: BidStatus.ACCEPTED,
    });

    await expect(bidService.acceptBidForCard('j1', customerActor('c1' as SessionUserId), 'b1')).rejects.toThrow(
      'errors.bidNotPending',
    );
  });

  test('bid belonging to a different journey throws BID_JOURNEY_MISMATCH', async () => {
    setupHappyPathMocks();
    (mockPrisma.bid.findUnique as jest.Mock).mockResolvedValue({
      id: 'b1',
      journeyId: 'other-journey',
      driverId: 'd1',
      price: 2000,
      status: BidStatus.PENDING,
    });

    await expect(bidService.acceptBidForCard('j1', customerActor('c1' as SessionUserId), 'b1')).rejects.toThrow(
      'errors.bidJourneyMismatch',
    );
  });
});
