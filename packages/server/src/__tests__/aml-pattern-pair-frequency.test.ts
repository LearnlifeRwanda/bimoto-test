jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    journey: {
      groupBy: jest.fn(),
      count: jest.fn(),
    },
    user: { update: jest.fn().mockResolvedValue({}) },
    amlFlag: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'f' }),
      update: jest.fn(),
    },
  },
}));

import prisma from '../prisma';
import { detect } from '../services/aml/patterns/pair-frequency';

const j = (prisma as any).journey;
const flag = (prisma as any).amlFlag;

beforeEach(() => {
  jest.clearAllMocks();
  flag.findFirst.mockResolvedValue(null);
});

describe('pair-frequency detector', () => {
  test('flags pair with >5 rides in 24h (HIGH severity, triggerWindow=24h)', async () => {
    j.groupBy.mockResolvedValue([{ customerId: 'c1', driverId: 'd1', _count: { _all: 6 } }]);
    j.count.mockResolvedValue(6); // 24h count also 6 — only 24h trips, 7d (>15) does not
    const n = await detect();
    expect(n).toBe(1);
    expect(flag.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'PAIR_FREQUENCY',
          severity: 'HIGH',
          metadata: expect.objectContaining({ triggerWindow: '24h' }),
        }),
      }),
    );
  });

  test('flags pair with >15 in 7d but only 4 in 24h (triggerWindow=7d)', async () => {
    j.groupBy.mockResolvedValue([{ customerId: 'c1', driverId: 'd1', _count: { _all: 16 } }]);
    j.count.mockResolvedValue(4);
    await detect();
    expect(flag.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: expect.objectContaining({ triggerWindow: '7d', count24h: 4, count7d: 16 }),
        }),
      }),
    );
  });

  test('does NOT flag at threshold-equals (>5 means strictly greater than 5)', async () => {
    j.groupBy.mockResolvedValue([{ customerId: 'c1', driverId: 'd1', _count: { _all: 5 } }]);
    j.count.mockResolvedValue(5);
    const n = await detect();
    expect(n).toBe(0);
    expect(flag.create).not.toHaveBeenCalled();
  });

  test('does NOT flag pair with null driverId', async () => {
    j.groupBy.mockResolvedValue([{ customerId: 'c1', driverId: null, _count: { _all: 100 } }]);
    const n = await detect();
    expect(n).toBe(0);
  });
});
