import { JourneyStatus } from '@bimoto/shared';

jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    journey: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    gpsPoint: {
      findFirst: jest.fn(),
    },
  },
}));

jest.mock('../services/journey.service', () => ({
  systemInterruptJourney: jest.fn().mockResolvedValue(undefined),
}));

import prisma from '../prisma';
import {
  computeStaleThresholdMs,
  findStaleInProgressJourneys,
  assertStaleAndInterrupt,
} from '../services/journey-resilience/stale-detection';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const journeyService = require('../services/journey.service');

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('computeStaleThresholdMs — distance-aware threshold', () => {
  test('5km ride uses 22.5min not 15min', () => {
    expect(computeStaleThresholdMs(5)).toBe(22.5 * 60 * 1000);
  });

  test('25km ride uses 112.5min', () => {
    expect(computeStaleThresholdMs(25)).toBe(112.5 * 60 * 1000);
  });

  test('1km ride floors to 15min (distance-based 4.5min would be too short)', () => {
    expect(computeStaleThresholdMs(1)).toBe(15 * 60 * 1000);
  });

  test('null distance defaults to 15min', () => {
    expect(computeStaleThresholdMs(null)).toBe(15 * 60 * 1000);
  });

  test('zero/negative distance defaults to 15min', () => {
    expect(computeStaleThresholdMs(0)).toBe(15 * 60 * 1000);
    expect(computeStaleThresholdMs(-1)).toBe(15 * 60 * 1000);
  });
});

describe('findStaleInProgressJourneys', () => {
  test('returns IN_PROGRESS journey past its distance-aware threshold with no recent GPS', async () => {
    const now = new Date('2026-05-04T12:00:00Z');
    const startedAt = new Date(now.getTime() - 30 * 60 * 1000); // 30min ago
    (mockPrisma.journey.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'j1',
        status: JourneyStatus.IN_PROGRESS,
        startedAt,
        estimatedDistance: 5,
      },
    ]);
    (mockPrisma.gpsPoint.findFirst as jest.Mock).mockResolvedValue(null);

    const stale = await findStaleInProgressJourneys(now);
    expect(stale).toHaveLength(1);
    expect(stale[0].id).toBe('j1');
  });

  test('skips normal slow ride within 1.5x estimate (does NOT flag)', async () => {
    const now = new Date('2026-05-04T12:00:00Z');
    const startedAt = new Date(now.getTime() - 20 * 60 * 1000); // 20min ago, under 22.5min
    (mockPrisma.journey.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'j2',
        status: JourneyStatus.IN_PROGRESS,
        startedAt,
        estimatedDistance: 5,
      },
    ]);
    (mockPrisma.gpsPoint.findFirst as jest.Mock).mockResolvedValue(null);

    const stale = await findStaleInProgressJourneys(now);
    expect(stale).toHaveLength(0);
  });

  test('skips journey with recent GPS heartbeat', async () => {
    const now = new Date('2026-05-04T12:00:00Z');
    const startedAt = new Date(now.getTime() - 30 * 60 * 1000);
    (mockPrisma.journey.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'j3',
        status: JourneyStatus.IN_PROGRESS,
        startedAt,
        estimatedDistance: 5,
      },
    ]);
    // Recent GPS ping exists
    (mockPrisma.gpsPoint.findFirst as jest.Mock).mockResolvedValue({ id: 'gp1' });

    const stale = await findStaleInProgressJourneys(now);
    expect(stale).toHaveLength(0);
  });
});

describe('assertStaleAndInterrupt', () => {
  test('re-checks status before transitioning (race defense)', async () => {
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue({
      id: 'j4',
      status: JourneyStatus.COMPLETED, // already moved on
      startedAt: new Date(Date.now() - 60 * 60 * 1000),
      estimatedDistance: 5,
    });

    await assertStaleAndInterrupt('j4');
    expect(journeyService.systemInterruptJourney).not.toHaveBeenCalled();
  });

  test('calls systemInterruptJourney when still stale', async () => {
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue({
      id: 'j5',
      status: JourneyStatus.IN_PROGRESS,
      startedAt: new Date(Date.now() - 60 * 60 * 1000),
      estimatedDistance: 5,
    });
    (mockPrisma.gpsPoint.findFirst as jest.Mock).mockResolvedValue(null);

    await assertStaleAndInterrupt('j5');
    expect(journeyService.systemInterruptJourney).toHaveBeenCalledWith('j5', 'STALE_NO_GPS_HEARTBEAT');
  });
});
