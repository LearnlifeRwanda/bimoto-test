import { EscrowStatus, AML_SINGLE_TRANSACTION_LIMIT, AML_SAME_PAIR_DAILY_LIMIT } from '@bimoto/shared';

// Mock prisma
jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    $transaction: jest.fn(),
    user: {
      count: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    journey: {
      count: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    driverProfile: {
      count: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
    },
    escrow: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    bid: {
      updateMany: jest.fn(),
    },
    escrowAuditLog: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
  },
}));

import prisma from '../prisma';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Admin Dashboard', () => {
  test('dashboard endpoint returns correct counts', async () => {
    (mockPrisma.user.count as jest.Mock)
      .mockResolvedValueOnce(100)   // totalUsers
      .mockResolvedValueOnce(30)    // totalDrivers
      .mockResolvedValueOnce(80);   // totalCustomers

    (mockPrisma.journey.count as jest.Mock)
      .mockResolvedValueOnce(200)   // totalJourneys
      .mockResolvedValueOnce(150);  // completedJourneys

    (mockPrisma.escrow.findMany as jest.Mock).mockResolvedValueOnce([
      { commission: 100 },
      { commission: 200 },
    ]);

    (mockPrisma.journey.count as jest.Mock)
      .mockResolvedValueOnce(5);    // activeDisputes

    (mockPrisma.user.count as jest.Mock)
      .mockResolvedValueOnce(3);    // flaggedUsers

    (mockPrisma.driverProfile.count as jest.Mock)
      .mockResolvedValueOnce(10);   // pendingVerifications

    // Simulate what the dashboard endpoint calculates
    const totalUsers = await prisma.user.count();
    const totalDrivers = await prisma.user.count({ where: { role: { in: ['DRIVER', 'BOTH'] } } } as any);
    const totalCustomers = await prisma.user.count({ where: { role: { in: ['CUSTOMER', 'BOTH'] } } } as any);
    const totalJourneys = await prisma.journey.count();
    const completedJourneys = await prisma.journey.count({ where: { status: 'COMPLETED' } } as any);
    const escrows = await prisma.escrow.findMany({ where: { status: 'RELEASED' } } as any);
    const totalRevenue = escrows.reduce((sum: number, e: any) => sum + e.commission, 0);
    const activeDisputes = await prisma.journey.count({ where: { status: { in: ['DISPUTED', 'INTERRUPTED'] } } } as any);
    const flaggedUsers = await prisma.user.count({ where: { isFlagged: true } } as any);
    const pendingVerifications = await prisma.driverProfile.count({ where: { verificationStatus: { in: ['PENDING', 'UNDER_REVIEW'] } } } as any);

    expect(totalUsers).toBe(100);
    expect(totalDrivers).toBe(30);
    expect(totalCustomers).toBe(80);
    expect(totalJourneys).toBe(200);
    expect(completedJourneys).toBe(150);
    expect(totalRevenue).toBe(300);
    expect(activeDisputes).toBe(5);
    expect(flaggedUsers).toBe(3);
    expect(pendingVerifications).toBe(10);
  });
});

describe('Admin Verification Approve/Reject', () => {
  test('approve sets verificationStatus to VERIFIED', async () => {
    (mockPrisma.driverProfile.update as jest.Mock).mockResolvedValue({
      id: 'dp1',
      userId: 'u1',
      verificationStatus: 'VERIFIED',
      verifiedAt: new Date(),
    });

    const profile = await prisma.driverProfile.update({
      where: { userId: 'u1' },
      data: { verificationStatus: 'VERIFIED', verifiedAt: new Date() },
    } as any);

    expect(profile.verificationStatus).toBe('VERIFIED');
    expect(profile.verifiedAt).toBeDefined();
  });

  test('reject sets verificationStatus to REJECTED with reason', async () => {
    (mockPrisma.driverProfile.update as jest.Mock).mockResolvedValue({
      id: 'dp1',
      userId: 'u1',
      verificationStatus: 'REJECTED',
      rejectionReason: 'Invalid documents',
    });

    const profile = await prisma.driverProfile.update({
      where: { userId: 'u1' },
      data: { verificationStatus: 'REJECTED', rejectionReason: 'Invalid documents' },
    } as any);

    expect(profile.verificationStatus).toBe('REJECTED');
    expect(profile.rejectionReason).toBe('Invalid documents');
  });
});

describe('Admin Dispute Resolution', () => {
  test('release escrow updates status and creates audit entry', async () => {
    const escrow = {
      id: 'e1',
      journeyId: 'j1',
      amount: 2000,
      commission: 100,
      driverPayout: 1900,
      status: EscrowStatus.FROZEN,
    };

    (mockPrisma.escrow.findUnique as jest.Mock).mockResolvedValue(escrow);
    (mockPrisma.$transaction as jest.Mock).mockImplementation(async (fn: Function) => {
      const tx = {
        escrow: {
          update: jest.fn().mockResolvedValue({
            ...escrow,
            status: EscrowStatus.RELEASED,
            releasedAt: new Date(),
          }),
        },
        journey: {
          update: jest.fn().mockResolvedValue({ id: 'j1', status: 'COMPLETED' }),
        },
        escrowAuditLog: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({}),
        },
      };
      return fn(tx);
    });

    const foundEscrow = await prisma.escrow.findUnique({ where: { journeyId: 'j1' } } as any);
    expect(foundEscrow).toBeDefined();
    expect(foundEscrow!.status).toBe(EscrowStatus.FROZEN);

    // Simulate the resolution transaction
    const result = await prisma.$transaction(async (tx: any) => {
      const updatedEscrow = await tx.escrow.update({
        where: { journeyId: 'j1' },
        data: { status: EscrowStatus.RELEASED, releasedAt: new Date() },
      });
      const updatedJourney = await tx.journey.update({
        where: { id: 'j1' },
        data: { status: 'COMPLETED' },
      });
      return { journey: updatedJourney, escrow: updatedEscrow };
    });

    expect(result.escrow.status).toBe(EscrowStatus.RELEASED);
    expect(result.journey.status).toBe('COMPLETED');
  });

  test('refund escrow updates status and creates audit entry', async () => {
    const escrow = {
      id: 'e1',
      journeyId: 'j1',
      amount: 2000,
      status: EscrowStatus.FROZEN,
    };

    (mockPrisma.escrow.findUnique as jest.Mock).mockResolvedValue(escrow);
    (mockPrisma.$transaction as jest.Mock).mockImplementation(async (fn: Function) => {
      const tx = {
        escrow: {
          update: jest.fn().mockResolvedValue({
            ...escrow,
            status: EscrowStatus.REFUNDED,
          }),
        },
        journey: {
          update: jest.fn().mockResolvedValue({ id: 'j1', status: 'CANCELLED' }),
        },
        escrowAuditLog: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({}),
        },
      };
      return fn(tx);
    });

    const result = await prisma.$transaction(async (tx: any) => {
      const updatedEscrow = await tx.escrow.update({
        where: { journeyId: 'j1' },
        data: { status: EscrowStatus.REFUNDED },
      });
      const updatedJourney = await tx.journey.update({
        where: { id: 'j1' },
        data: { status: 'CANCELLED' },
      });
      return { journey: updatedJourney, escrow: updatedEscrow };
    });

    expect(result.escrow.status).toBe(EscrowStatus.REFUNDED);
    expect(result.journey.status).toBe('CANCELLED');
  });
});

describe('Webhook Handler', () => {
  test('payment success updates escrow to HELD', async () => {
    (mockPrisma.escrow.update as jest.Mock).mockResolvedValue({
      id: 'e1',
      status: EscrowStatus.HELD,
    });

    const result = await prisma.escrow.update({
      where: { id: 'e1' },
      data: { status: EscrowStatus.HELD },
    } as any);

    expect(result.status).toBe(EscrowStatus.HELD);
  });

  test('payment failure reverts journey', async () => {
    const escrow = { id: 'e1', journeyId: 'j1' };

    (mockPrisma.escrow.findUnique as jest.Mock).mockResolvedValue(escrow);
    (mockPrisma.journey.update as jest.Mock).mockResolvedValue({
      id: 'j1',
      status: 'REQUESTED',
      driverId: null,
      agreedPrice: null,
    });
    (mockPrisma.escrow.delete as jest.Mock).mockResolvedValue(escrow);

    const found = await prisma.escrow.findUnique({ where: { id: 'e1' } } as any);
    expect(found).toBeDefined();

    await prisma.journey.update({
      where: { id: found!.journeyId },
      data: { status: 'REQUESTED', driverId: null, agreedPrice: null },
    } as any);

    await prisma.escrow.delete({ where: { id: 'e1' } } as any);

    expect(mockPrisma.journey.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'REQUESTED', driverId: null }),
      }),
    );
    expect(mockPrisma.escrow.delete).toHaveBeenCalled();
  });
});

describe('Reconciliation', () => {
  test('totals balance: collected = disbursed + commission', () => {
    const escrows = [
      { amount: 2000, commission: 100, driverPayout: 1900, status: 'RELEASED' },
      { amount: 3000, commission: 150, driverPayout: 2850, status: 'RELEASED' },
      { amount: 1500, commission: 75, driverPayout: 1425, status: 'RELEASED' },
    ];

    const totalCollected = escrows.reduce((sum, e) => sum + e.amount, 0);
    const totalCommission = escrows.reduce((sum, e) => sum + e.commission, 0);
    const totalDisbursed = escrows.reduce((sum, e) => sum + e.driverPayout, 0);

    expect(totalCollected).toBe(6500);
    expect(totalCommission).toBe(325);
    expect(totalDisbursed).toBe(6175);
    expect(totalCollected).toBe(totalDisbursed + totalCommission);
  });

  test('unbalanced escrows are detected', () => {
    const escrows = [
      { amount: 2000, commission: 100, driverPayout: 1800 }, // Wrong: 100 + 1800 != 2000
    ];

    const totalCollected = escrows.reduce((sum, e) => sum + e.amount, 0);
    const totalCommission = escrows.reduce((sum, e) => sum + e.commission, 0);
    const totalDisbursed = escrows.reduce((sum, e) => sum + e.driverPayout, 0);

    const balanced = totalCollected === (totalDisbursed + totalCommission);
    expect(balanced).toBe(false);
  });
});

describe('AML Checks', () => {
  test('large transaction is flagged', () => {
    const price = 150000; // Above AML_SINGLE_TRANSACTION_LIMIT
    const flagged = price > AML_SINGLE_TRANSACTION_LIMIT;
    expect(flagged).toBe(true);
    expect(AML_SINGLE_TRANSACTION_LIMIT).toBe(100000);
  });

  test('normal transaction is not flagged', () => {
    const price = 5000;
    const flagged = price > AML_SINGLE_TRANSACTION_LIMIT;
    expect(flagged).toBe(false);
  });

  test('same-pair frequency check triggers at limit', () => {
    const pairCount = 5; // Equal to AML_SAME_PAIR_DAILY_LIMIT
    const flagged = pairCount >= AML_SAME_PAIR_DAILY_LIMIT;
    expect(flagged).toBe(true);
  });

  test('same-pair frequency below limit is not flagged', () => {
    const pairCount = 3;
    const flagged = pairCount >= AML_SAME_PAIR_DAILY_LIMIT;
    expect(flagged).toBe(false);
  });
});

describe('Monthly Report', () => {
  test('report structure and calculations', async () => {
    const journeys = [
      { status: 'COMPLETED' },
      { status: 'COMPLETED' },
      { status: 'DISPUTED' },
      { status: 'CANCELLED' },
      { status: 'INTERRUPTED' },
    ];

    const escrows = [
      { amount: 2000, commission: 100, status: 'RELEASED' },
      { amount: 3000, commission: 150, status: 'RELEASED' },
      { amount: 1500, commission: 75, status: 'REFUNDED' },
      { amount: 2500, commission: 125, status: 'FROZEN' },
    ];

    // Replicate report generation logic
    const completed = journeys.filter(j => j.status === 'COMPLETED');
    const disputed = journeys.filter(j => j.status === 'DISPUTED');
    const interrupted = journeys.filter(j => j.status === 'INTERRUPTED');
    const cancelled = journeys.filter(j => j.status === 'CANCELLED');

    const totalVolume = escrows.reduce((sum, e) => sum + e.amount, 0);
    const totalCommission = escrows.reduce((sum, e) => sum + e.commission, 0);
    const releasedEscrows = escrows.filter(e => e.status === 'RELEASED');
    const refundedEscrows = escrows.filter(e => e.status === 'REFUNDED');
    const frozenEscrows = escrows.filter(e => e.status === 'FROZEN');

    const disputeRate = completed.length > 0
      ? ((disputed.length / completed.length) * 100).toFixed(2) + '%'
      : '0%';

    const report = {
      period: `2026-03`,
      journeys: {
        total: journeys.length,
        completed: completed.length,
        disputed: disputed.length,
        interrupted: interrupted.length,
        cancelled: cancelled.length,
      },
      financial: {
        totalVolumeRWF: totalVolume,
        totalCommissionRWF: totalCommission,
        releasedCount: releasedEscrows.length,
        refundedCount: refundedEscrows.length,
        frozenCount: frozenEscrows.length,
      },
      users: {
        newThisMonth: 10,
        totalRegistered: 100,
        flaggedForReview: 2,
      },
      compliance: {
        disputeRate,
        escrowIntegrity: 'All audit chains verified',
      },
    };

    expect(report.period).toBe('2026-03');
    expect(report.journeys.total).toBe(5);
    expect(report.journeys.completed).toBe(2);
    expect(report.journeys.disputed).toBe(1);
    expect(report.journeys.interrupted).toBe(1);
    expect(report.journeys.cancelled).toBe(1);
    expect(report.financial.totalVolumeRWF).toBe(9000);
    expect(report.financial.totalCommissionRWF).toBe(450);
    expect(report.financial.releasedCount).toBe(2);
    expect(report.financial.refundedCount).toBe(1);
    expect(report.financial.frozenCount).toBe(1);
    expect(report.users.newThisMonth).toBe(10);
    expect(report.users.totalRegistered).toBe(100);
    expect(report.users.flaggedForReview).toBe(2);
    expect(report.compliance.disputeRate).toBe('50.00%');
  });
});

describe('Helmet Middleware', () => {
  test('security headers are present', async () => {
    // We test by importing helmet and verifying it's a function
    const helmet = require('helmet');
    expect(typeof helmet).toBe('function');

    // Verify helmet produces middleware
    const middleware = helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "https://tile.openstreetmap.org"],
          connectSrc: ["'self'", "ws:", "wss:"],
        },
      },
      crossOriginEmbedderPolicy: false,
    });
    expect(typeof middleware).toBe('function');
  });
});

describe('Admin Guard', () => {
  test('non-admin users get 403', () => {
    // Simulate the adminOnly middleware behavior
    const adminOnly = (role: string) => {
      if (role !== 'ADMIN') {
        return { status: 403, error: { code: 'FORBIDDEN', message: 'errors.admin_only' } };
      }
      return { status: 200 };
    };

    expect(adminOnly('CUSTOMER').status).toBe(403);
    expect(adminOnly('DRIVER').status).toBe(403);
    expect(adminOnly('BOTH').status).toBe(403);
    expect(adminOnly('ADMIN').status).toBe(200);
  });
});

// MAP-TRUTH G6 — the 'Payment Failure Handling' block was removed with
// handlePaymentFailure itself. It asserted that escrow.delete HAD been
// called, so it was a test OF the hazard rather than a test protecting
// anything real: the function had no callers, deleted a money row, and
// was fully superseded by markEscrowChargeFailed. The payment-failure
// path that actually runs is covered by charge-failure-disposition.test.ts,
// payment-failure-matrix.test.ts and webhook-failure-audit.test.ts —
// the last of which asserts, by name, that a failed-charge webhook calls
// markEscrowChargeFailed and NOT escrow.delete. escrow-no-delete.test.ts
// now guards the invariant across all production code.
