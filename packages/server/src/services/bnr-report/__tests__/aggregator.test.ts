jest.mock('../../../prisma', () => ({
  __esModule: true,
  default: {},
}));

import { aggregateAll } from '../aggregator';
import { windowFor } from '../date-window';
import type { PrismaClient } from '@prisma/client';

function makePrisma(): PrismaClient {
  return {
    journey: {
      findMany: jest.fn().mockResolvedValue([
        { status: 'COMPLETED', agreedPrice: 800_000, escrow: { amount: 800_000, status: 'RELEASED' } },
        { status: 'COMPLETED', agreedPrice: 2_000_000, escrow: { amount: 2_000_000, status: 'RELEASED' } },
        { status: 'CANCELLED', agreedPrice: 50_000, escrow: { amount: 50_000, status: 'FAILED' } },
        { status: 'IN_PROGRESS', agreedPrice: 6_000_000, escrow: null },
      ]),
      count: jest.fn().mockResolvedValue(2),
    },
    journeyReconciliationResponse: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    amlFlag: {
      findMany: jest.fn().mockResolvedValue([
        { type: 'VELOCITY_EXCEEDED', severity: 'HIGH', status: 'OPEN', resolvedAt: null },
        { type: 'VELOCITY_EXCEEDED', severity: 'CRITICAL', status: 'OPEN', resolvedAt: null },
        { type: 'NEW_ACCOUNT_HIGH_VALUE', severity: 'MEDIUM', status: 'DISMISSED', resolvedAt: new Date('2026-04-15T10:00:00Z') },
      ]),
      count: jest.fn().mockResolvedValue(0),
    },
    user: {
      count: jest.fn().mockResolvedValue(100),
      groupBy: jest.fn().mockResolvedValue([
        { role: 'CUSTOMER', _count: { _all: 70 } },
        { role: 'DRIVER', _count: { _all: 30 } },
      ]),
    },
    driverPayoutBatch: {
      findMany: jest.fn().mockResolvedValue([
        { amount: 1_500_000 },
        { amount: 2_100_000 },
      ]),
    },
    escrowAuditLog: {
      findFirst: jest.fn().mockResolvedValue({ entryHash: 'hash-abc' }),
      count: jest.fn().mockResolvedValue(42),
    },
  } as unknown as PrismaClient;
}

describe('aggregateAll', () => {
  test('produces a fully-populated ReportData from mocked prisma', async () => {
    const period = windowFor('2026-04');
    const prisma = makePrisma();
    const data = await aggregateAll(period, prisma);

    expect(data.period.period).toBe('2026-04');

    expect(data.transactions.totalCount).toBe(4);
    expect(data.transactions.totalAmountRwf).toBe(800_000 + 2_000_000 + 50_000 + 6_000_000);
    const tiers = Object.fromEntries(data.transactions.byTier.map((r) => [r.tier, r.count]));
    expect(tiers.micro).toBe(2);
    expect(tiers.standard).toBe(1);
    expect(tiers.large).toBe(1);
    expect(data.transactions.failedCount).toBe(1);
    expect(data.transactions.successRate).toBeCloseTo(2 / 4, 5);

    expect(data.amlFlags.totalCount).toBe(3);
    const sevMap = Object.fromEntries(data.amlFlags.bySeverity.map((s) => [s.severity, s.count]));
    expect(sevMap.HIGH).toBe(1);
    expect(sevMap.CRITICAL).toBe(1);
    expect(sevMap.MEDIUM).toBe(1);
    expect(sevMap.LOW).toBe(0);

    expect(data.userGrowth.totalUsers).toBe(100);
    expect(data.userGrowth.byRole.length).toBe(2);

    expect(data.driverMetrics.totalPayoutsRwf).toBe(1_500_000 + 2_100_000);
    expect(data.driverMetrics.payoutBatchCount).toBe(2);

    expect(data.compliance.hashChainHead).toBe('hash-abc');
    expect(data.compliance.hashChainEntries).toBe(42);
    expect(data.compliance.attestations.length).toBeGreaterThan(0);
  });
});
