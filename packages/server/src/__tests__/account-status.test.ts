// R3-N-5 — getDriverAccountStatus tests. Covers the four observable
// branches: ACTIVE, SUSPENDED (suspendedUntil > now), FLAGGED (most
// severe), and the recent-disputes resolution mapping joined to
// AdminAction.

jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    user: { findUnique: jest.fn() },
    journey: { findMany: jest.fn() },
    adminAction: { findMany: jest.fn() },
  },
}));

import prisma from '../prisma';
import { getDriverAccountStatus } from '../services/user.service';

const mockUser = (overrides: Partial<any> = {}) => ({
  id: 'd1',
  noShowCount: 0,
  cancellationCount: 0,
  lateMarkCount: 0,
  wrongVehicleCount: 0,
  driverInitiatedCancellationCount: 0,
  completedRides: 10,
  isFlagged: false,
  suspendedUntil: null,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  (prisma.journey.findMany as jest.Mock).mockResolvedValue([]);
  (prisma.adminAction.findMany as jest.Mock).mockResolvedValue([]);
});

describe('getDriverAccountStatus — R3-N-5', () => {
  test('returns ACTIVE when not flagged and not suspended', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser());
    const out = await getDriverAccountStatus('d1');
    expect(out.status).toBe('ACTIVE');
    expect(out.suspendedUntil).toBeNull();
    expect(out.thresholds).toEqual({
      noShowWarning: 3,
      noShowSuspension24h: 5,
      noShowFlag: 10,
    });
  });

  test('returns SUSPENDED when suspendedUntil is in the future', async () => {
    const until = new Date(Date.now() + 24 * 60 * 60 * 1000);
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(
      mockUser({ suspendedUntil: until, noShowCount: 5 }),
    );
    const out = await getDriverAccountStatus('d1');
    expect(out.status).toBe('SUSPENDED');
    expect(out.suspendedUntil).toBe(until.toISOString());
    expect(out.counters.noShowCount).toBe(5);
  });

  test('returns FLAGGED even when suspension would otherwise apply (FLAGGED is most severe)', async () => {
    const until = new Date(Date.now() + 24 * 60 * 60 * 1000);
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(
      mockUser({ isFlagged: true, suspendedUntil: until, noShowCount: 11 }),
    );
    const out = await getDriverAccountStatus('d1');
    expect(out.status).toBe('FLAGGED');
    expect(out.isFlagged).toBe(true);
  });

  test('joins recent disputes to AdminAction by targetId, mapping decisions and pending entries', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser());
    const filed = new Date('2026-05-01T08:00:00Z');
    const cancelled = new Date('2026-05-01T07:00:00Z');
    (prisma.journey.findMany as jest.Mock).mockResolvedValue([
      { id: 'j-resolved', cancelledAt: cancelled, driverDisputedAt: filed },
      { id: 'j-pending', cancelledAt: cancelled, driverDisputedAt: filed },
    ]);
    const decidedAt = new Date('2026-05-02T10:00:00Z');
    (prisma.adminAction.findMany as jest.Mock).mockResolvedValue([
      {
        targetId: 'j-resolved',
        conflictDecision: 'OVERTURN_FLAG',
        createdAt: decidedAt,
        reason: 'GPS shows driver was at pickup',
      },
    ]);
    const out = await getDriverAccountStatus('d1');
    expect(out.recentDisputes).toHaveLength(2);
    expect(out.recentDisputes[0]).toEqual({
      journeyId: 'j-resolved',
      cancelledAt: cancelled.toISOString(),
      driverDisputedAt: filed.toISOString(),
      resolution: {
        decision: 'OVERTURN_FLAG',
        decidedAt: decidedAt.toISOString(),
        reason: 'GPS shows driver was at pickup',
      },
    });
    expect(out.recentDisputes[1].resolution).toEqual({
      decision: null,
      decidedAt: null,
      reason: null,
    });
  });
});
