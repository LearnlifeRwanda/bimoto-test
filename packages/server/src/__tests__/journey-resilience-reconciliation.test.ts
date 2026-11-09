jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    journey: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    journeyReconciliationResponse: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
  },
}));

jest.mock('../socket', () => ({
  emitToJourney: jest.fn(),
}));

import prisma from '../prisma';
import { emitToJourney } from '../socket';
import {
  recordReconciliationResponse,
  getReconciliationStatus,
  triggerReconciliationOpening,
} from '../services/journey-resilience/reconciliation';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('recordReconciliationResponse', () => {
  const journey = { id: 'j1', customerId: 'c1', driverId: 'd1' };

  beforeEach(() => {
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue(journey);
  });

  test('first response: bothPartiesResponded=false, no verdict', async () => {
    (mockPrisma.journeyReconciliationResponse.upsert as jest.Mock).mockResolvedValue({
      id: 'r1',
      response: 'ARRIVED_SAFELY',
    });
    (mockPrisma.journeyReconciliationResponse.findUnique as jest.Mock).mockResolvedValue(null);

    const result = await recordReconciliationResponse({
      journeyId: 'j1',
      respondingUserId: 'c1',
      response: 'ARRIVED_SAFELY' as any,
    });
    expect(result.bothPartiesResponded).toBe(false);
    expect(result.verdict).toBeUndefined();
  });

  test('both ARRIVED_SAFELY → BOTH_ARRIVED', async () => {
    (mockPrisma.journeyReconciliationResponse.upsert as jest.Mock).mockResolvedValue({
      id: 'r2',
      response: 'ARRIVED_SAFELY',
    });
    (mockPrisma.journeyReconciliationResponse.findUnique as jest.Mock).mockResolvedValue({
      id: 'r1',
      respondingUserId: 'c1',
      response: 'ARRIVED_SAFELY',
    });

    const result = await recordReconciliationResponse({
      journeyId: 'j1',
      respondingUserId: 'd1',
      response: 'ARRIVED_SAFELY' as any,
    });
    expect(result.verdict).toBe('BOTH_ARRIVED');
  });

  test('asymmetric (NEVER_ARRIVED + ARRIVED_SAFELY) → CONFLICT', async () => {
    (mockPrisma.journeyReconciliationResponse.upsert as jest.Mock).mockResolvedValue({
      id: 'r2',
      response: 'NEVER_ARRIVED',
    });
    (mockPrisma.journeyReconciliationResponse.findUnique as jest.Mock).mockResolvedValue({
      id: 'r1',
      respondingUserId: 'c1',
      response: 'ARRIVED_SAFELY',
    });

    const result = await recordReconciliationResponse({
      journeyId: 'j1',
      respondingUserId: 'd1',
      response: 'NEVER_ARRIVED' as any,
    });
    expect(result.verdict).toBe('CONFLICT');
  });

  test('both NEED_HELP → CONFLICT (not BOTH_ARRIVED)', async () => {
    (mockPrisma.journeyReconciliationResponse.upsert as jest.Mock).mockResolvedValue({
      id: 'r2',
      response: 'NEED_HELP',
    });
    (mockPrisma.journeyReconciliationResponse.findUnique as jest.Mock).mockResolvedValue({
      id: 'r1',
      respondingUserId: 'c1',
      response: 'NEED_HELP',
    });

    const result = await recordReconciliationResponse({
      journeyId: 'j1',
      respondingUserId: 'd1',
      response: 'NEED_HELP' as any,
    });
    expect(result.verdict).toBe('CONFLICT');
  });

  test('idempotent: same user re-submitting uses upsert (replaces row)', async () => {
    (mockPrisma.journeyReconciliationResponse.upsert as jest.Mock).mockResolvedValue({
      id: 'r1',
      response: 'NEVER_ARRIVED',
    });
    (mockPrisma.journeyReconciliationResponse.findUnique as jest.Mock).mockResolvedValue(null);

    await recordReconciliationResponse({
      journeyId: 'j1',
      respondingUserId: 'c1',
      response: 'NEVER_ARRIVED' as any,
    });
    const call = (mockPrisma.journeyReconciliationResponse.upsert as jest.Mock).mock.calls[0][0];
    expect(call.where.journeyId_respondingUserId).toEqual({
      journeyId: 'j1',
      respondingUserId: 'c1',
    });
    expect(call.update.response).toBe('NEVER_ARRIVED');
  });

  test('simultaneous responses produce consistent verdict (verdict computed against current OTHER party row)', async () => {
    (mockPrisma.journeyReconciliationResponse.upsert as jest.Mock).mockResolvedValue({
      id: 'r-driver',
      response: 'ARRIVED_SAFELY',
    });
    (mockPrisma.journeyReconciliationResponse.findUnique as jest.Mock).mockResolvedValue({
      id: 'r-customer',
      respondingUserId: 'c1',
      response: 'ARRIVED_SAFELY',
    });

    const result = await recordReconciliationResponse({
      journeyId: 'j1',
      respondingUserId: 'd1',
      response: 'ARRIVED_SAFELY' as any,
    });
    expect(result.bothPartiesResponded).toBe(true);
    expect(result.verdict).toBe('BOTH_ARRIVED');
  });
});

describe('getReconciliationStatus', () => {
  test('returns own + other-party shape with verdict when both responded', async () => {
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue({
      id: 'j1',
      status: 'INTERRUPTED',
      customerId: 'c1',
      driverId: 'd1',
      destinationName: 'Kacyiru',
      reconciliationOpenedAt: new Date(),
      lateCompletion: false,
      customerInitiatedCompletion: false,
    });
    (mockPrisma.journeyReconciliationResponse.findMany as jest.Mock).mockResolvedValue([
      { respondingUserId: 'c1', response: 'ARRIVED_SAFELY' },
      { respondingUserId: 'd1', response: 'ARRIVED_SAFELY' },
    ]);

    const status = await getReconciliationStatus('j1', 'c1');
    expect(status.ownResponse?.respondingUserId).toBe('c1');
    expect(status.otherPartyResponse?.respondingUserId).toBe('d1');
    expect(status.verdict).toBe('BOTH_ARRIVED');
  });
});

describe('triggerReconciliationOpening', () => {
  test('sets reconciliationOpenedAt and emits socket event', async () => {
    (mockPrisma.journey.update as jest.Mock).mockResolvedValue({});
    await triggerReconciliationOpening('j1');
    expect(mockPrisma.journey.update).toHaveBeenCalledWith({
      where: { id: 'j1' },
      data: expect.objectContaining({ reconciliationOpenedAt: expect.any(Date) }),
    });
    expect(emitToJourney).toHaveBeenCalledWith(
      'j1',
      'journey-reconciliation-required',
      expect.objectContaining({ journeyId: 'j1' }),
    );
  });
});
