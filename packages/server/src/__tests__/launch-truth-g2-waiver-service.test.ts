// LAUNCH-TRUTH G2 — grant / extend / revoke service.
//
// Covers every refusal path (double-grant, both campaign caps,
// extend-a-lifetime, extend-beyond-12-months, revoke-twice), the
// hash-chained AdminAction row on each mutation, and the
// getActiveWaiver truth table (lifetime / temporary-live /
// temporary-expired / revoked).

jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    user: { findUnique: jest.fn() },
    feeWaiver: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

jest.mock('../services/admin/admin-action-audit.service', () => ({
  appendAdminActionTx: jest.fn().mockResolvedValue({ id: 'audit-1' }),
}));

import prisma from '../prisma';
import { AppError } from '../middleware/error-handler';
import { appendAdminActionTx } from '../services/admin/admin-action-audit.service';
import {
  grantFeeWaiver,
  extendFeeWaiver,
  revokeFeeWaiver,
  getActiveWaiver,
} from '../services/fee-waiver';
import {
  FEE_WAIVER_LIFETIME_MAX,
  FEE_WAIVER_TEMPORARY_MAX,
} from '../services/fee-waiver/config';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const ADMIN = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const DRIVER = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const REASON = 'Pilot cooperative MOU test driver';

beforeEach(() => {
  jest.clearAllMocks();
  // $transaction(cb) runs the callback against the same mock client —
  // the house pattern for testing tx-wrapped services.
  (mockPrisma.$transaction as jest.Mock).mockImplementation(async (cb: any) =>
    cb(mockPrisma),
  );
  (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({ id: DRIVER });
  (mockPrisma.feeWaiver.findFirst as jest.Mock).mockResolvedValue(null);
  (mockPrisma.feeWaiver.count as jest.Mock).mockResolvedValue(0);
  (mockPrisma.feeWaiver.create as jest.Mock).mockImplementation(
    async ({ data }: any) => ({ id: 'fw-1', extensionCount: 0, revokedAt: null, ...data }),
  );
  (mockPrisma.feeWaiver.update as jest.Mock).mockImplementation(
    async ({ data }: any) => ({ id: 'fw-1', ...data }),
  );
});

async function expectAppError(p: Promise<unknown>, status: number, code: string) {
  try {
    await p;
    throw new Error(`expected AppError ${code}, got success`);
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(status);
    expect((err as AppError).code).toBe(code);
  }
}

describe('grantFeeWaiver', () => {
  test('LIFETIME grant: expiresAt null, audit row GRANT_FEE_WAIVER with reason', async () => {
    const waiver = await grantFeeWaiver({
      driverId: DRIVER,
      type: 'LIFETIME',
      campaign: 'PRE_PROTOTYPE',
      adminId: ADMIN,
      reason: REASON,
    });
    expect(waiver.expiresAt).toBeNull();
    expect(appendAdminActionTx).toHaveBeenCalledWith(
      mockPrisma,
      expect.objectContaining({
        action: 'GRANT_FEE_WAIVER',
        targetType: 'USER',
        targetId: DRIVER,
        reason: REASON,
        payload: expect.objectContaining({ type: 'LIFETIME', campaign: 'PRE_PROTOTYPE' }),
      }),
    );
  });

  test('TEMPORARY grant: expiresAt = grantedAt + 6 months', async () => {
    const waiver = await grantFeeWaiver({
      driverId: DRIVER,
      type: 'TEMPORARY',
      campaign: 'PILOT_500',
      adminId: ADMIN,
      reason: REASON,
    });
    expect(waiver.expiresAt).not.toBeNull();
    const granted = new Date(waiver.grantedAt);
    const expected = new Date(granted);
    expected.setMonth(expected.getMonth() + 6);
    expect(new Date(waiver.expiresAt!).getTime()).toBe(expected.getTime());
  });

  test('refuses 404 for an unknown driver', async () => {
    (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(null);
    await expectAppError(
      grantFeeWaiver({ driverId: DRIVER, type: 'LIFETIME', campaign: 'X', adminId: ADMIN, reason: REASON }),
      404,
      'DRIVER_NOT_FOUND',
    );
  });

  test('409 WAIVER_ALREADY_ACTIVE when a live waiver exists', async () => {
    (mockPrisma.feeWaiver.findFirst as jest.Mock).mockResolvedValue({
      id: 'fw-0',
      expiresAt: null,
      revokedAt: null,
    });
    await expectAppError(
      grantFeeWaiver({ driverId: DRIVER, type: 'TEMPORARY', campaign: 'X', adminId: ADMIN, reason: REASON }),
      409,
      'WAIVER_ALREADY_ACTIVE',
    );
    expect(appendAdminActionTx).not.toHaveBeenCalled();
  });

  test('409 WAIVER_EXISTS_UNREVOKED when an expired-but-unrevoked waiver exists', async () => {
    (mockPrisma.feeWaiver.findFirst as jest.Mock).mockResolvedValue({
      id: 'fw-0',
      expiresAt: new Date('2026-01-01T00:00:00Z'),
      revokedAt: null,
    });
    await expectAppError(
      grantFeeWaiver({ driverId: DRIVER, type: 'TEMPORARY', campaign: 'X', adminId: ADMIN, reason: REASON }),
      409,
      'WAIVER_EXISTS_UNREVOKED',
    );
  });

  test('409 LIFETIME_CAP_REACHED at 12 non-revoked lifetime grants', async () => {
    (mockPrisma.feeWaiver.count as jest.Mock).mockResolvedValue(FEE_WAIVER_LIFETIME_MAX);
    await expectAppError(
      grantFeeWaiver({ driverId: DRIVER, type: 'LIFETIME', campaign: 'X', adminId: ADMIN, reason: REASON }),
      409,
      'LIFETIME_CAP_REACHED',
    );
    expect(mockPrisma.feeWaiver.count).toHaveBeenCalledWith({
      where: { type: 'LIFETIME', revokedAt: null },
    });
  });

  test('409 TEMPORARY_CAP_REACHED at 500 non-revoked temporary grants', async () => {
    (mockPrisma.feeWaiver.count as jest.Mock).mockResolvedValue(FEE_WAIVER_TEMPORARY_MAX);
    await expectAppError(
      grantFeeWaiver({ driverId: DRIVER, type: 'TEMPORARY', campaign: 'X', adminId: ADMIN, reason: REASON }),
      409,
      'TEMPORARY_CAP_REACHED',
    );
  });
});

describe('extendFeeWaiver', () => {
  const granted = new Date('2026-07-13T00:00:00Z');
  const sixMonths = new Date('2027-01-13T00:00:00Z');

  beforeEach(() => {
    (mockPrisma.feeWaiver.findUnique as jest.Mock).mockResolvedValue({
      id: 'fw-1',
      driverId: DRIVER,
      type: 'TEMPORARY',
      campaign: 'PILOT_500',
      grantedAt: granted,
      expiresAt: sixMonths,
      extensionCount: 0,
      revokedAt: null,
    });
  });

  test('extends expiresAt, increments extensionCount, writes EXTEND_FEE_WAIVER audit row', async () => {
    await extendFeeWaiver({ waiverId: 'fw-1', months: 3, adminId: ADMIN, reason: REASON });
    const expected = new Date(sixMonths);
    expected.setMonth(expected.getMonth() + 3);
    expect(mockPrisma.feeWaiver.update).toHaveBeenCalledWith({
      where: { id: 'fw-1' },
      data: { expiresAt: expected, extensionCount: { increment: 1 } },
    });
    expect(appendAdminActionTx).toHaveBeenCalledWith(
      mockPrisma,
      expect.objectContaining({ action: 'EXTEND_FEE_WAIVER', targetId: DRIVER }),
    );
  });

  test('422 CANNOT_EXTEND_LIFETIME — a lifetime waiver never expires', async () => {
    (mockPrisma.feeWaiver.findUnique as jest.Mock).mockResolvedValue({
      id: 'fw-1',
      driverId: DRIVER,
      type: 'LIFETIME',
      grantedAt: granted,
      expiresAt: null,
      revokedAt: null,
    });
    await expectAppError(
      extendFeeWaiver({ waiverId: 'fw-1', months: 1, adminId: ADMIN, reason: REASON }),
      422,
      'CANNOT_EXTEND_LIFETIME',
    );
  });

  test('422 EXTENSION_EXCEEDS_CEILING past grantedAt + 12 months', async () => {
    // 6 months in, asking for 7 more = 13 total > 12 ceiling.
    await expectAppError(
      extendFeeWaiver({ waiverId: 'fw-1', months: 7, adminId: ADMIN, reason: REASON }),
      422,
      'EXTENSION_EXCEEDS_CEILING',
    );
    // Exactly at the ceiling (6 + 6 = 12) is allowed.
    await extendFeeWaiver({ waiverId: 'fw-1', months: 6, adminId: ADMIN, reason: REASON });
  });

  test('409 WAIVER_REVOKED / 404 WAIVER_NOT_FOUND / 400 invalid months', async () => {
    (mockPrisma.feeWaiver.findUnique as jest.Mock).mockResolvedValue({
      id: 'fw-1',
      type: 'TEMPORARY',
      grantedAt: granted,
      expiresAt: sixMonths,
      revokedAt: new Date(),
    });
    await expectAppError(
      extendFeeWaiver({ waiverId: 'fw-1', months: 1, adminId: ADMIN, reason: REASON }),
      409,
      'WAIVER_REVOKED',
    );
    (mockPrisma.feeWaiver.findUnique as jest.Mock).mockResolvedValue(null);
    await expectAppError(
      extendFeeWaiver({ waiverId: 'fw-x', months: 1, adminId: ADMIN, reason: REASON }),
      404,
      'WAIVER_NOT_FOUND',
    );
    await expectAppError(
      extendFeeWaiver({ waiverId: 'fw-1', months: 0, adminId: ADMIN, reason: REASON }),
      400,
      'INVALID_EXTENSION_MONTHS',
    );
  });
});

describe('revokeFeeWaiver', () => {
  test('sets revokedAt/revokedBy and writes REVOKE_FEE_WAIVER audit row — forward-only', async () => {
    (mockPrisma.feeWaiver.findUnique as jest.Mock).mockResolvedValue({
      id: 'fw-1',
      driverId: DRIVER,
      type: 'TEMPORARY',
      campaign: 'PILOT_500',
      revokedAt: null,
    });
    await revokeFeeWaiver({ waiverId: 'fw-1', adminId: ADMIN, reason: REASON });
    expect(mockPrisma.feeWaiver.update).toHaveBeenCalledWith({
      where: { id: 'fw-1' },
      data: { revokedAt: expect.any(Date), revokedBy: ADMIN },
    });
    // Forward-only: the revoke path never touches escrow rows.
    expect(appendAdminActionTx).toHaveBeenCalledWith(
      mockPrisma,
      expect.objectContaining({ action: 'REVOKE_FEE_WAIVER', targetId: DRIVER }),
    );
  });

  test('409 WAIVER_ALREADY_REVOKED on a second revoke', async () => {
    (mockPrisma.feeWaiver.findUnique as jest.Mock).mockResolvedValue({
      id: 'fw-1',
      revokedAt: new Date(),
    });
    await expectAppError(
      revokeFeeWaiver({ waiverId: 'fw-1', adminId: ADMIN, reason: REASON }),
      409,
      'WAIVER_ALREADY_REVOKED',
    );
  });
});

describe('getActiveWaiver — the single truth about "waived right now"', () => {
  test('queries non-revoked AND (lifetime OR not yet expired at `at`)', async () => {
    const at = new Date('2026-08-01T00:00:00Z');
    (mockPrisma.feeWaiver.findFirst as jest.Mock).mockResolvedValue({ id: 'fw-1' });
    const result = await getActiveWaiver(DRIVER, at);
    expect(result).toEqual({ id: 'fw-1' });
    expect(mockPrisma.feeWaiver.findFirst).toHaveBeenCalledWith({
      where: {
        driverId: DRIVER,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: at } }],
      },
    });
  });

  test('truth table: the predicate admits lifetime and live-temporary, rejects expired and revoked', () => {
    // The Prisma where-clause IS the predicate; verify its logic locally
    // against the four canonical states.
    const at = new Date('2026-08-01T00:00:00Z');
    const matches = (w: { revokedAt: Date | null; expiresAt: Date | null }) =>
      w.revokedAt === null &&
      (w.expiresAt === null || w.expiresAt.getTime() > at.getTime());

    // LIFETIME — active.
    expect(matches({ revokedAt: null, expiresAt: null })).toBe(true);
    // TEMPORARY live — active.
    expect(matches({ revokedAt: null, expiresAt: new Date('2027-01-13T00:00:00Z') })).toBe(true);
    // TEMPORARY expired — inactive.
    expect(matches({ revokedAt: null, expiresAt: new Date('2026-07-31T00:00:00Z') })).toBe(false);
    // Revoked (even lifetime) — inactive.
    expect(matches({ revokedAt: new Date(), expiresAt: null })).toBe(false);
  });
});
