// R3-DELIVERY-NOTIFICATIONS — integration test that acceptBid fires
// the recipient en-route SMS exactly once, with the recipient phone
// and a body containing the customer's name. Smallest-wrongness
// gate: catches a forgotten include + a forgotten call site.

import { JourneyStatus, BidStatus } from '@bimoto/shared';

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
  createEscrow: jest.fn().mockResolvedValue({}),
  // BID-ATOMICITY G1 — escrow creation moved inside the accept transaction.
  createEscrowTx: jest.fn().mockResolvedValue({}),
}));

jest.mock('../sms.service', () => ({
  sendSms: jest.fn().mockResolvedValue({ success: true }),
}));

jest.mock('@sentry/node', () => ({
  captureException: jest.fn(),
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
import { sendSms } from '../sms.service';
// CUTGUARD v2 G4 — the actor is now a TYPE (services/session-actor.ts).
// A test stands in for a session, so it says so with an explicit cast at
// the call rather than passing a bare string, which is what made the
// tautology writable in the first place.
import { customerActor, type SessionUserId } from '../../services/session-actor';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const mockedSendSms = sendSms as jest.MockedFunction<typeof sendSms>;

beforeEach(() => {
  jest.clearAllMocks();
  mockedSendSms.mockResolvedValue({ success: true });
});

describe('acceptBid → recipient en-route SMS', () => {
  function setupHappyPathMocks() {
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue({
      id: 'j1',
      customerId: 'c1',
      status: JourneyStatus.REQUESTED,
      type: 'GOODS',
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
      phone: '+250788111111',
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
          }),
        },
      };
      return fn(tx);
    });
  }

  it('fires sendSms once with the recipient phone + customer name when GOODS_DROPOFF leg has contactPhone', async () => {
    setupHappyPathMocks();
    (mockPrisma.leg.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'leg-1',
        type: 'GOODS_DROPOFF',
        status: 'PENDING',
        contactPhone: '+250788000000',
        expectedDurationMinutes: 12,
      },
    ]);

    await bidService.acceptBid('j1', customerActor('c1' as SessionUserId), 'b1');

    expect(mockedSendSms).toHaveBeenCalledTimes(1);
    expect(mockedSendSms.mock.calls[0][0]).toBe('+250788000000');
    expect(mockedSendSms.mock.calls[0][1]).toContain('Aljo');
  });

  it('does not fire sendSms when no leg has contactPhone', async () => {
    setupHappyPathMocks();
    (mockPrisma.leg.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'leg-1',
        type: 'GOODS_DROPOFF',
        status: 'PENDING',
        contactPhone: null,
      },
    ]);

    await bidService.acceptBid('j1', customerActor('c1' as SessionUserId), 'b1');

    expect(mockedSendSms).not.toHaveBeenCalled();
  });

  it('does not fire sendSms when no goods legs exist (passenger-only journey)', async () => {
    setupHappyPathMocks();
    (mockPrisma.leg.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'leg-1',
        type: 'PASSENGER_DROPOFF',
        status: 'PENDING',
        contactPhone: '+250788000000',
      },
    ]);

    await bidService.acceptBid('j1', customerActor('c1' as SessionUserId), 'b1');

    expect(mockedSendSms).not.toHaveBeenCalled();
  });

  // R3-DELIVERY-NOTIFICATIONS-2 — multi-recipient + per-leg language.
  it('fires en-route SMS to ALL GOODS_DROPOFF recipients (multi-recipient)', async () => {
    setupHappyPathMocks();
    (mockPrisma.leg.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'leg-pickup',
        type: 'GOODS_PICKUP',
        status: 'PENDING',
        contactPhone: '+250788000111',
      },
      {
        id: 'leg-drop-1',
        type: 'GOODS_DROPOFF',
        status: 'PENDING',
        contactPhone: '+250788000222',
        expectedDurationMinutes: 10,
      },
      {
        id: 'leg-drop-2',
        type: 'GOODS_DROPOFF',
        status: 'PENDING',
        contactPhone: '+250788000333',
        expectedDurationMinutes: 5,
      },
    ]);

    await bidService.acceptBid('j1', customerActor('c1' as SessionUserId), 'b1');

    // Two recipient SMS — never sends to the sender's phone (the
    // GOODS_PICKUP contactPhone).
    expect(mockedSendSms).toHaveBeenCalledTimes(2);
    const recipientPhones = mockedSendSms.mock.calls.map((c) => c[0]);
    expect(recipientPhones).toEqual(
      expect.arrayContaining(['+250788000222', '+250788000333']),
    );
    expect(recipientPhones).not.toContain('+250788000111');
  });

  it('uses leg.recipientLanguage when set, falls back to customer.language when null', async () => {
    setupHappyPathMocks();
    (mockPrisma.leg.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'leg-drop-fr',
        type: 'GOODS_DROPOFF',
        status: 'PENDING',
        contactPhone: '+250788000222',
        recipientLanguage: 'fr',
        expectedDurationMinutes: 10,
      },
      {
        id: 'leg-drop-default',
        type: 'GOODS_DROPOFF',
        status: 'PENDING',
        contactPhone: '+250788000333',
        recipientLanguage: null,
        expectedDurationMinutes: 5,
      },
    ]);

    await bidService.acceptBid('j1', customerActor('c1' as SessionUserId), 'b1');

    expect(mockedSendSms).toHaveBeenCalledTimes(2);
    // Customer.language is 'rw' (set in setupHappyPathMocks). The first
    // recipient overrides to French ("Bimoto:" + "le moto-taxi"); the
    // second falls back to Kinyarwanda ("moto-taxi").
    const callsByPhone: Record<string, string> = {};
    for (const call of mockedSendSms.mock.calls) {
      callsByPhone[call[0]] = call[1];
    }
    // French body: "Bimoto: un moto-taxi vient livrer un colis…"
    expect(callsByPhone['+250788000222']).toContain('vient livrer un colis');
    // Kinyarwanda fallback: "Bimoto: moto-taxi iraje kuguha ipake…"
    expect(callsByPhone['+250788000333']).toContain('iraje kuguha ipake');
  });
});
