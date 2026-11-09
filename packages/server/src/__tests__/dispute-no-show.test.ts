// R3-N-4 — driver dispute-no-show service tests.
//
// Verifies:
//   - happy path stamps driverDisputedAt
//   - wrong-driver caller returns 403
//   - already-disputed returns 400
//   - 7-day window enforcement
//   - non-no-show cancel reasons rejected

jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    journey: { findUnique: jest.fn(), update: jest.fn() },
  },
}));

jest.mock('../config', () => ({
  config: {
    DATABASE_URL: 'test',
    JWT_SECRET: 'test-jwt-secret-at-least-16-chars',
    JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-16-chars',
    ENCRYPTION_KEY: 'a'.repeat(64),
    PORT: 3000,
    CLIENT_URL: 'http://localhost:5173',
    NODE_ENV: 'test',
    SKIP_DRIVER_VERIFICATION: true,
  },
}));

import prisma from '../prisma';
import { CancelReason } from '@prisma/client';
import { disputeNoShow } from '../services/journey.service';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('disputeNoShow — R3-N-4 driver dispute service', () => {
  test('happy path: stamps driverDisputedAt on a recent DRIVER_NO_SHOW journey', async () => {
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue({
      id: 'j1',
      driverId: 'd1',
      cancelReason: CancelReason.DRIVER_NO_SHOW,
      driverDisputedAt: null,
      cancelledAt: new Date(Date.now() - 60 * 60 * 1000), // 1h ago
    });
    (mockPrisma.journey.update as jest.Mock).mockResolvedValue({
      id: 'j1',
      driverDisputedAt: new Date(),
    });

    const result = await disputeNoShow('j1', 'd1');

    expect(mockPrisma.journey.update).toHaveBeenCalledWith({
      where: { id: 'j1' },
      data: { driverDisputedAt: expect.any(Date) },
    });
    expect(result.driverDisputedAt).toBeInstanceOf(Date);
  });

  test('rejects when caller is not the assigned driver', async () => {
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue({
      id: 'j1',
      driverId: 'd1',
      cancelReason: CancelReason.DRIVER_NO_SHOW,
      driverDisputedAt: null,
      cancelledAt: new Date(Date.now() - 60 * 1000),
    });

    await expect(disputeNoShow('j1', 'someone-else')).rejects.toMatchObject({
      code: 'NOT_ASSIGNED_DRIVER',
      statusCode: 403,
    });
    expect(mockPrisma.journey.update).not.toHaveBeenCalled();
  });

  test('rejects when journey already disputed (idempotency)', async () => {
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue({
      id: 'j1',
      driverId: 'd1',
      cancelReason: CancelReason.DRIVER_NO_SHOW,
      driverDisputedAt: new Date(),
      cancelledAt: new Date(Date.now() - 60 * 1000),
    });

    await expect(disputeNoShow('j1', 'd1')).rejects.toMatchObject({
      code: 'ALREADY_DISPUTED',
      statusCode: 400,
    });
  });

  test('rejects past the 7-day dispute window', async () => {
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue({
      id: 'j1',
      driverId: 'd1',
      cancelReason: CancelReason.DRIVER_NO_SHOW,
      driverDisputedAt: null,
      cancelledAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000), // 8 days
    });

    await expect(disputeNoShow('j1', 'd1')).rejects.toMatchObject({
      code: 'DISPUTE_WINDOW_CLOSED',
      statusCode: 400,
    });
  });

  test('rejects when cancelReason is not DRIVER_NO_SHOW', async () => {
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue({
      id: 'j1',
      driverId: 'd1',
      cancelReason: CancelReason.CUSTOMER_CHANGED_MIND,
      driverDisputedAt: null,
      cancelledAt: new Date(),
    });

    await expect(disputeNoShow('j1', 'd1')).rejects.toMatchObject({
      code: 'NOT_A_NO_SHOW',
      statusCode: 400,
    });
  });

  test('rejects when journey not found', async () => {
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(disputeNoShow('missing', 'd1')).rejects.toMatchObject({
      code: 'JOURNEY_NOT_FOUND',
      statusCode: 404,
    });
  });
});
