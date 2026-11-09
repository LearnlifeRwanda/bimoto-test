jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    escrow: { findMany: jest.fn() },
    escrowAuditLog: { findFirst: jest.fn() },
  },
}));

jest.mock('../services/escrow-audit.service', () => ({
  appendAuditEntry: jest.fn().mockResolvedValue(undefined),
}));

import prisma from '../prisma';
import { appendAuditEntry } from '../services/escrow-audit.service';
import { runBackfill } from '../services/audit-backfill';

const findEscrows = (prisma as any).escrow.findMany as jest.Mock;
const findExisting = (prisma as any).escrowAuditLog.findFirst as jest.Mock;
const append = appendAuditEntry as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('runBackfill', () => {
  test('backfills HELD escrow with 2 entries (CREATED_PENDING + CHARGE_CONFIRMED)', async () => {
    findEscrows.mockResolvedValue([
      {
        id: 'e1',
        customerId: 'c1',
        driverId: 'd1',
        amount: 2000,
        status: 'HELD',
        createdAt: new Date('2026-04-01'),
        releasedAt: null,
        lastChargeAttemptAt: new Date('2026-04-01'),
        flwTxId: 'flw-1',
        txRef: 'r1',
      },
    ]);
    findExisting.mockResolvedValue(null);
    const r = await runBackfill();
    expect(r.entriesCreated).toBe(2);
    expect(r.backfilled).toBe(1);
    const actions = append.mock.calls.map((c) => c[1]);
    expect(actions).toEqual(['CREATED_PENDING', 'CHARGE_CONFIRMED']);
  });

  test('backfills RELEASED escrow with 3 entries', async () => {
    findEscrows.mockResolvedValue([
      {
        id: 'e2',
        customerId: 'c1',
        driverId: 'd1',
        amount: 3000,
        status: 'RELEASED',
        createdAt: new Date('2026-04-01'),
        releasedAt: new Date('2026-04-01T12:00:00Z'),
        lastChargeAttemptAt: new Date('2026-04-01'),
        flwTxId: 'flw-2',
        txRef: 'r2',
      },
    ]);
    findExisting.mockResolvedValue(null);
    const r = await runBackfill();
    expect(r.entriesCreated).toBe(3);
    const actions = append.mock.calls.map((c) => c[1]);
    expect(actions).toEqual(['CREATED_PENDING', 'CHARGE_CONFIRMED', 'RELEASED']);
  });

  test('skips escrows that already have audit entries (idempotent)', async () => {
    findEscrows.mockResolvedValue([
      {
        id: 'e3',
        customerId: 'c1',
        driverId: 'd1',
        amount: 1000,
        status: 'HELD',
        createdAt: new Date(),
        releasedAt: null,
        lastChargeAttemptAt: new Date(),
        flwTxId: null,
        txRef: 'r3',
      },
    ]);
    findExisting.mockResolvedValue({ id: 'log-1' });
    const r = await runBackfill();
    expect(r.skipped).toBe(1);
    expect(r.backfilled).toBe(0);
    expect(append).not.toHaveBeenCalled();
  });

  test('marks metadata.backfilled = true for every synthetic entry', async () => {
    findEscrows.mockResolvedValue([
      {
        id: 'e4',
        customerId: 'c1',
        driverId: 'd1',
        amount: 1000,
        status: 'RELEASED',
        createdAt: new Date(),
        releasedAt: new Date(),
        lastChargeAttemptAt: new Date(),
        flwTxId: 'x',
        txRef: 'r4',
      },
    ]);
    findExisting.mockResolvedValue(null);
    await runBackfill();
    for (const call of append.mock.calls) {
      const metadata = call[4];
      expect(metadata.backfilled).toBe(true);
      expect(typeof metadata.backfilledAt).toBe('string');
    }
  });

  test('skips PENDING escrows from creating CHARGE_CONFIRMED entry', async () => {
    findEscrows.mockResolvedValue([
      {
        id: 'e5',
        customerId: 'c1',
        driverId: 'd1',
        amount: 1000,
        status: 'PENDING',
        createdAt: new Date(),
        releasedAt: null,
        lastChargeAttemptAt: null,
        flwTxId: null,
        txRef: 'r5',
      },
    ]);
    findExisting.mockResolvedValue(null);
    const r = await runBackfill();
    expect(r.entriesCreated).toBe(1);
    const actions = append.mock.calls.map((c) => c[1]);
    expect(actions).toEqual(['CREATED_PENDING']);
  });
});
