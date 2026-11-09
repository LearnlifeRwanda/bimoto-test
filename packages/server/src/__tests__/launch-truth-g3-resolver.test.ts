// LAUNCH-TRUTH G3 — the commission resolver, wired at every call site.
//
// Covers: the pure compute-then-zero rule; applyWaiver passthrough for
// unwaived/expired drivers; the accept-bid path persisting charged=0 /
// driverPayout=fare / waivedCommissionAmount / feeWaiverId; escrow
// persistence of the waived record; the settlement-record-wins rule in
// getJourneyById; the per-bid preview agreeing with settlement; and the
// panel invariant that a waived ride still increments totalRides (tier
// progress) and completedShifts.

import { JourneyStatus, BidStatus, calculateCommission } from '@bimoto/shared';

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
    vehicleChangeLog: {
      findMany: jest.fn().mockResolvedValue([]),
    },
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
import * as bidService from '../services/bid.service';
import * as escrowService from '../services/escrow.service';
import {
  applyWaiver,
  resolveWaiverCommission,
} from '../services/fee-waiver/apply';
// CUTGUARD v2 G4 — the actor is now a TYPE (services/session-actor.ts).
// A test stands in for a session, so it says so with an explicit cast at
// the call rather than passing a bare string, which is what made the
// tautology writable in the first place.
import { customerActor, type SessionUserId } from '../services/session-actor';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const mockCreateEscrow = escrowService.createEscrow as jest.Mock;
const mockCreateEscrowTx = (escrowService as any).createEscrowTx as jest.Mock;

const WAIVER = { id: 'fw-1', driverId: 'd1', type: 'LIFETIME', revokedAt: null, expiresAt: null };

beforeEach(() => {
  jest.clearAllMocks();
  (mockPrisma.journey.count as jest.Mock).mockResolvedValue(0);
  (mockPrisma.leg.findMany as jest.Mock).mockResolvedValue([]);
  ((mockPrisma as any).vehicleChangeLog.findMany as jest.Mock).mockResolvedValue([]);
  ((mockPrisma as any).feeWaiver.findFirst as jest.Mock).mockResolvedValue(null);
  ((mockPrisma as any).feeWaiver.findMany as jest.Mock).mockResolvedValue([]);
  mockCreateEscrow.mockResolvedValue({});
});

describe('resolveWaiverCommission — the pure compute-then-zero rule', () => {
  const commission = calculateCommission(2000, 0, 0); // NEW + REGULAR: 10% = 200

  test('no waiver: passthrough, nothing changes by one franc', () => {
    expect(resolveWaiverCommission(null, commission)).toEqual({
      charged: 200,
      waived: 0,
      waiverId: null,
      effectiveDriverPayout: 1800,
    });
  });

  test('waiver: charged zeroed, nominal recorded, driver keeps the whole fare', () => {
    expect(resolveWaiverCommission({ id: 'fw-1' }, commission)).toEqual({
      charged: 0,
      waived: 200,
      waiverId: 'fw-1',
      effectiveDriverPayout: 2000,
    });
  });
});

describe('applyWaiver', () => {
  test('expired/absent waiver behaves exactly as unwaived (predicate returns null)', async () => {
    const commission = calculateCommission(3000, 200, 50);
    const res = await applyWaiver('d1', commission);
    expect(res.charged).toBe(commission.totalCommissionAmount);
    expect(res.waived).toBe(0);
    expect(res.waiverId).toBeNull();
    expect(res.effectiveDriverPayout).toBe(commission.driverPayout);
  });

  test('active waiver zeroes the charge', async () => {
    ((mockPrisma as any).feeWaiver.findFirst as jest.Mock).mockResolvedValue(WAIVER);
    const commission = calculateCommission(3000, 200, 50);
    const res = await applyWaiver('d1', commission);
    expect(res.charged).toBe(0);
    expect(res.waived).toBe(commission.totalCommissionAmount);
    expect(res.effectiveDriverPayout).toBe(3000);
  });
});

describe('acceptBid — settlement path', () => {
  function fixtureAcceptBid() {
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
      totalRides: 0, // NEW driver — the pilot cohort
    });
    (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: 'c1',
      completedRides: 0, // REGULAR customer -> 10% stacked nominal
    });
    // BID-ATOMICITY G1 — the MATCHED flip is a status-predicated
    // updateMany claim; commissionAmount travels in its data.
    const journeyUpdate = jest.fn().mockResolvedValue({ count: 1 });
    (mockPrisma.$transaction as jest.Mock).mockImplementation(async (fn: Function) =>
      fn({
        // SETTLE-UP G2 — acceptBidCore reads the journey's escrow inside
        // the claim transaction before deciding create-vs-adopt. This
        // journey has no surviving escrow, so the lookup answers null and
        // the create branch runs exactly as before.
        escrow: { findUnique: jest.fn().mockResolvedValue(null) },
        bid: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          findUnique: jest.fn().mockResolvedValue({ id: 'b1', status: BidStatus.ACCEPTED }),
          // LIVE-WIRE G2 — acceptBidCore reads the losing bids inside the
          // claim transaction so the drivers it declined can be told.
          findMany: jest.fn().mockResolvedValue([]),
        },
        journey: {
          updateMany: journeyUpdate,
          findUnique: jest.fn().mockResolvedValue({
            id: 'j1', status: JourneyStatus.MATCHED, driverId: 'd1', agreedPrice: 2000,
          }),
        },
      }),
    );
    return { journeyUpdate };
  }

  test('waived driver: journey charges 0, escrow gets fare payout + waived record', async () => {
    ((mockPrisma as any).feeWaiver.findFirst as jest.Mock).mockResolvedValue(WAIVER);
    const { journeyUpdate } = fixtureAcceptBid();

    // CUTGUARD v2 amendment 2 — asked as a CURRENT client, because the
    // claims below are about what her breakdown CONTAINS. A breakdown the
    // version gate withheld would satisfy `not.toHaveProperty` for the
    // wrong reason; the gate's own directions are pinned in
    // cutguard-accept-bid-customer-money.
    const result = (await bidService.acceptBid('j1', customerActor('c1' as SessionUserId), 'b1', {
      customerSavingsPreview: true,
    })) as any;

    // Journey row records the CHARGED commission: zero.
    expect(journeyUpdate.mock.calls[0][0].data.commissionAmount).toBe(0);

    // Escrow receives charged=0, payout=fare, the nominal amount as the
    // waived record, and the audited grant id.
    expect(mockCreateEscrowTx).toHaveBeenCalledWith(
      expect.anything(), 'j1', 'c1', 'd1', 2000,
      expect.objectContaining({
        totalCommissionAmount: 0,
        driverPayout: 2000,
        waivedCommissionAmount: 200,
        feeWaiverId: 'fw-1',
      }),
    );

    // CUTGUARD v2 G3 — the nominal-vs-charged truth is asserted where it
    // is actually recorded: the escrow write above. It used to be read
    // off `acceptBid`'s returned breakdown, which is a CUSTOMER payload —
    // and a customer payload carrying `totalCommissionAmount` and
    // `driverPayout` was U-4, the defect this dispatch closed. Reading
    // the ladder there proved the leak rather than the ledger.
    //
    // The escrow assertion is the stronger oracle anyway: it is what the
    // motari is actually paid from, and it survives any change to what
    // the API answers. The driver's VIEW of the same ladder is asserted
    // in transparency.test.ts (the bid list's driver arm) and in
    // cutguard-accept-bid-customer-money.test.ts.
    //
    // What the CUSTOMER is entitled to know about the waiver — that one
    // applied to her ride — is still asserted, on her own payload:
    expect(result.commissionBreakdown.feeWaiverApplied).toBe(true);
    expect(result.commissionBreakdown.bidPrice).toBe(2000);
    expect(result.commissionBreakdown).not.toHaveProperty('driverPayout');
    expect(result.commissionBreakdown).not.toHaveProperty('totalCommissionAmount');
  });

  test('unwaived driver: byte-identical to today, waiver fields inert', async () => {
    const { journeyUpdate } = fixtureAcceptBid();

    // CUTGUARD v2 amendment 2 — asked as a CURRENT client, because the
    // claims below are about what her breakdown CONTAINS. A breakdown the
    // version gate withheld would satisfy `not.toHaveProperty` for the
    // wrong reason; the gate's own directions are pinned in
    // cutguard-accept-bid-customer-money.
    const result = (await bidService.acceptBid('j1', customerActor('c1' as SessionUserId), 'b1', {
      customerSavingsPreview: true,
    })) as any;

    expect(journeyUpdate.mock.calls[0][0].data.commissionAmount).toBe(200);
    expect(mockCreateEscrowTx).toHaveBeenCalledWith(
      expect.anything(), 'j1', 'c1', 'd1', 2000,
      expect.objectContaining({
        totalCommissionAmount: 200,
        driverPayout: 1800,
        waivedCommissionAmount: 0,
        feeWaiverId: null,
      }),
    );
    // CUTGUARD v2 G3 — same move as the waived case above: the ladder is
    // asserted on the escrow write (which is byte-identical to before),
    // and the customer payload is asserted to be the customer payload.
    expect(result.commissionBreakdown.feeWaiverApplied).toBe(false);
    expect(result.commissionBreakdown.bidPrice).toBe(2000);
    expect(result.commissionBreakdown).not.toHaveProperty('driverPayout');
    expect(result.commissionBreakdown).not.toHaveProperty('totalCommissionAmount');
  });
});

describe('getBidsForJourney — preview path agrees with settlement', () => {
  test('waived bidder previews the full fare; unwaived bidder unchanged', async () => {
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue({
      id: 'j1', customerId: 'c1', status: 'REQUESTED',
    });
    (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: 'c1', completedRides: 0,
    });
    const mkBid = (id: string, driverId: string) => ({
      id, journeyId: 'j1', driverId, price: 2000, etaMinutes: 5,
      status: 'PENDING', createdAt: new Date(), updatedAt: new Date(),
      driver: {
        nickname: driverId,
        driverProfile: {
          avgRating: 4.5, totalRides: 0, vehicleType: 'MOTO',
          vehicleDescription: 'Honda', verificationStatus: 'VERIFIED',
        },
      },
    });
    (mockPrisma.bid.findMany as jest.Mock).mockResolvedValue([
      mkBid('b1', 'd-waived'),
      mkBid('b2', 'd-normal'),
    ]);
    ((mockPrisma as any).feeWaiver.findMany as jest.Mock).mockResolvedValue([
      { ...WAIVER, driverId: 'd-waived' },
    ]);

    // LIVE-WIRE G4 — read WITHOUT a viewer: this test compares two
    // different bidders' previews against settlement, which no single
    // role can see (a driver sees only his own bid, the customer sees
    // none). The no-viewer call is the privileged/service-level read.
    const result = await bidService.getBidsForJourney('j1');

    const waived = result.find((b: any) => b.driverId === 'd-waived') as any;
    const normal = result.find((b: any) => b.driverId === 'd-normal') as any;

    expect(waived.commissionBreakdown.driverPayout).toBe(2000);
    expect(waived.commissionBreakdown.feeWaiverApplied).toBe(true);
    expect(waived.commissionBreakdown.totalCommissionAmount).toBe(200); // nominal, shown
    expect(waived.commissionBreakdown.chargedCommissionAmount).toBe(0);

    expect(normal.commissionBreakdown.driverPayout).toBe(1800);
    expect(normal.commissionBreakdown.feeWaiverApplied).toBe(false);
    expect(normal.commissionBreakdown.chargedCommissionAmount).toBe(200);
  });
});

describe('getJourneyById — the settlement record wins', () => {
  test('escrow with feeWaiverId renders waived even if the waiver has since expired', async () => {
    // Live lookup would say "unwaived" (findFirst -> null); the escrow
    // row recorded the waiver at settlement, and that record wins — a
    // waiver expiring after the ride must not un-waive the receipt.
    ((mockPrisma as any).feeWaiver.findFirst as jest.Mock).mockResolvedValue(null);
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue({
      id: 'j1',
      customerId: 'c1',
      driverId: 'd1',
      agreedPrice: 2000,
      status: 'COMPLETED',
      bids: [],
      messages: [],
      legs: [],
      customer: { id: 'c1', nickname: 'C', completedRides: 0 },
      driver: { id: 'd1', nickname: 'D', driverProfile: { totalRides: 0 } },
      escrow: {
        id: 'e1',
        commission: 0,
        driverPayout: 2000,
        waivedCommissionAmount: 200,
        feeWaiverId: 'fw-1',
      },
    });

    const journeyService = await import('../services/journey.service');
    const journey = (await journeyService.getJourneyById('j1')) as any;

    expect(journey.commissionBreakdown.feeWaiverApplied).toBe(true);
    expect(journey.commissionBreakdown.chargedCommissionAmount).toBe(0);
    expect(journey.commissionBreakdown.waivedCommissionAmount).toBe(200);
    expect(journey.commissionBreakdown.driverPayout).toBe(2000);
    // Nominal stays visible for the "normally {amount}" rendering.
    expect(journey.commissionBreakdown.totalCommissionAmount).toBe(200);
    // And the live predicate was never needed.
    expect((mockPrisma as any).feeWaiver.findFirst).not.toHaveBeenCalled();
  });

  test('unwaived journey with escrow: breakdown byte-identical to today', async () => {
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue({
      id: 'j1',
      customerId: 'c1',
      driverId: 'd1',
      agreedPrice: 2000,
      status: 'COMPLETED',
      bids: [],
      messages: [],
      legs: [],
      customer: { id: 'c1', nickname: 'C', completedRides: 0 },
      driver: { id: 'd1', nickname: 'D', driverProfile: { totalRides: 0 } },
      escrow: {
        id: 'e1',
        commission: 200,
        driverPayout: 1800,
        waivedCommissionAmount: null,
        feeWaiverId: null,
      },
    });

    const journeyService = await import('../services/journey.service');
    const journey = (await journeyService.getJourneyById('j1')) as any;

    expect(journey.commissionBreakdown.totalCommissionAmount).toBe(200);
    expect(journey.commissionBreakdown.driverPayout).toBe(1800);
    expect(journey.commissionBreakdown.feeWaiverApplied).toBe(false);
    expect(journey.commissionBreakdown.chargedCommissionAmount).toBe(200);
    expect(journey.commissionBreakdown.waivedCommissionAmount).toBe(0);
  });
});

describe('escrow persistence of the waived record', () => {
  test('createEscrow (unmocked) writes waivedCommissionAmount + feeWaiverId', async () => {
    const realEscrowService = jest.requireActual('../services/escrow.service');
    const escrowCreate = jest.fn().mockResolvedValue({ id: 'e1' });
    (mockPrisma.$transaction as jest.Mock).mockImplementation(async (fn: Function) =>
      fn({
        escrow: { create: escrowCreate },
        escrowAuditLog: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({}),
        },
      }),
    );

    await realEscrowService.createEscrow('j1', 'c1', 'd1', 2000, {
      totalCommissionAmount: 0,
      driverPayout: 2000,
      driverTier: { tier: 'NEW', commissionRate: 0.05 },
      customerTier: { tier: 'REGULAR', commissionRate: 0.05 },
      waivedCommissionAmount: 200,
      feeWaiverId: 'fw-1',
    });

    const data = escrowCreate.mock.calls[0][0].data;
    expect(data.commission).toBe(0);
    expect(data.driverPayout).toBe(2000);
    expect(data.waivedCommissionAmount).toBe(200);
    expect(data.feeWaiverId).toBe('fw-1');
    // Nominal tier rates stay on the row — they describe the ladder.
    expect(data.driverCommissionRate).toBe(0.05);
    expect(data.customerCommissionRate).toBe(0.05);
  });

  test('createEscrow without a waiver writes nulls (pre-waiver rows indistinguishable)', async () => {
    const realEscrowService = jest.requireActual('../services/escrow.service');
    const escrowCreate = jest.fn().mockResolvedValue({ id: 'e1' });
    (mockPrisma.$transaction as jest.Mock).mockImplementation(async (fn: Function) =>
      fn({
        escrow: { create: escrowCreate },
        escrowAuditLog: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({}),
        },
      }),
    );

    await realEscrowService.createEscrow('j1', 'c1', 'd1', 2000, {
      totalCommissionAmount: 200,
      driverPayout: 1800,
      driverTier: { tier: 'NEW', commissionRate: 0.05 },
      customerTier: { tier: 'REGULAR', commissionRate: 0.05 },
      waivedCommissionAmount: 0,
      feeWaiverId: null,
    });

    const data = escrowCreate.mock.calls[0][0].data;
    expect(data.commission).toBe(200);
    expect(data.waivedCommissionAmount).toBeNull();
    expect(data.feeWaiverId).toBeNull();
  });
});

describe('panel invariant — waived rides are still rides', () => {
  test('releasing a waived escrow increments totalRides + completedShifts and credits the full fare', async () => {
    const realEscrowService = jest.requireActual('../services/escrow.service');
    const driverProfileUpdate = jest.fn().mockResolvedValue({});
    const userUpdate = jest.fn().mockResolvedValue({});
    const balanceUpsert = jest.fn().mockResolvedValue({});
    const tx = {
      escrow: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({ id: 'e1' }),
      },
      escrowAuditLog: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
      driverProfile: { update: driverProfileUpdate },
      user: { update: userUpdate },
      driverBalance: { upsert: balanceUpsert },
    };

    // A waived escrow: commission 0, payout = the whole fare.
    await realEscrowService.releaseEscrowTx(
      tx,
      {
        id: 'e1',
        journeyId: 'j1',
        status: 'HELD',
        amount: 2000,
        driverId: 'd1',
        driverPayout: 2000,
      },
      'system',
    );

    // Tier progress: the waived ride counts.
    expect(driverProfileUpdate).toHaveBeenCalledWith({
      where: { userId: 'd1' },
      data: { totalRides: { increment: 1 } },
    });
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: 'd1' },
      data: { completedShifts: { increment: 1 } },
    });
    // The driver is credited the FULL fare.
    expect(balanceUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { driverId: 'd1' },
        create: expect.objectContaining({ pendingAmount: 2000 }),
        update: expect.objectContaining({
          pendingAmount: { increment: 2000 },
        }),
      }),
    );
  });
});
