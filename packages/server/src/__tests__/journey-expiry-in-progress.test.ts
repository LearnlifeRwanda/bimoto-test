import { JourneyStatus } from '@bimoto/shared';

jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    journey: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    gpsPoint: {
      findFirst: jest.fn(),
    },
    bid: { update: jest.fn() },
    escrow: { findUnique: jest.fn(), update: jest.fn() },
  },
}));

jest.mock('../socket', () => ({
  emitToJourney: jest.fn(),
}));

jest.mock('../services/journey.service', () => ({
  systemInterruptJourney: jest.fn().mockResolvedValue(undefined),
}));

import prisma from '../prisma';
import * as journeyService from '../services/journey.service';
import { processJourneyExpiry } from '../jobs/journey-expiry.job';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

beforeEach(() => {
  jest.clearAllMocks();
  // Default: REQUESTED + MATCHED + IN_PROGRESS queries all return [].
  (mockPrisma.journey.findMany as jest.Mock).mockResolvedValue([]);
});

describe('Journey Expiry Job - IN_PROGRESS handler', () => {
  test('does NOT fire on fresh IN_PROGRESS (under threshold)', async () => {
    // 5km ride, started 10min ago — under 22.5min threshold.
    const startedAt = new Date(Date.now() - 10 * 60 * 1000);
    (mockPrisma.journey.findMany as jest.Mock).mockImplementation((args: any) => {
      if (args?.where?.status === JourneyStatus.IN_PROGRESS) {
        return Promise.resolve([
          { id: 'jp1', status: JourneyStatus.IN_PROGRESS, startedAt, estimatedDistance: 5 },
        ]);
      }
      return Promise.resolve([]);
    });
    (mockPrisma.gpsPoint.findFirst as jest.Mock).mockResolvedValue(null);

    await processJourneyExpiry();
    expect(journeyService.systemInterruptJourney).not.toHaveBeenCalled();
  });

  test('FIRES on stale IN_PROGRESS at distance-aware boundary (5km / 22.5min)', async () => {
    const startedAt = new Date(Date.now() - 23 * 60 * 1000); // 23min > 22.5min
    (mockPrisma.journey.findMany as jest.Mock).mockImplementation((args: any) => {
      if (args?.where?.status === JourneyStatus.IN_PROGRESS) {
        return Promise.resolve([
          { id: 'jp2', status: JourneyStatus.IN_PROGRESS, startedAt, estimatedDistance: 5 },
        ]);
      }
      return Promise.resolve([]);
    });
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue({
      id: 'jp2',
      status: JourneyStatus.IN_PROGRESS,
      startedAt,
      estimatedDistance: 5,
    });
    (mockPrisma.gpsPoint.findFirst as jest.Mock).mockResolvedValue(null);

    await processJourneyExpiry();
    expect(journeyService.systemInterruptJourney).toHaveBeenCalledWith('jp2', 'STALE_NO_GPS_HEARTBEAT');
  });

  test('does NOT double-INTERRUPT a journey already INTERRUPTED (race defense)', async () => {
    const startedAt = new Date(Date.now() - 60 * 60 * 1000);
    (mockPrisma.journey.findMany as jest.Mock).mockImplementation((args: any) => {
      if (args?.where?.status === JourneyStatus.IN_PROGRESS) {
        return Promise.resolve([
          { id: 'jp3', status: JourneyStatus.IN_PROGRESS, startedAt, estimatedDistance: 5 },
        ]);
      }
      return Promise.resolve([]);
    });
    // findUnique re-check returns the journey ALREADY INTERRUPTED
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue({
      id: 'jp3',
      status: JourneyStatus.INTERRUPTED, // changed since findMany
      startedAt,
      estimatedDistance: 5,
    });
    (mockPrisma.gpsPoint.findFirst as jest.Mock).mockResolvedValue(null);

    await processJourneyExpiry();
    expect(journeyService.systemInterruptJourney).not.toHaveBeenCalled();
  });

  test('one stuck row failure does not block siblings', async () => {
    const startedAt = new Date(Date.now() - 60 * 60 * 1000);
    (mockPrisma.journey.findMany as jest.Mock).mockImplementation((args: any) => {
      if (args?.where?.status === JourneyStatus.IN_PROGRESS) {
        return Promise.resolve([
          { id: 'jp-bad', status: JourneyStatus.IN_PROGRESS, startedAt, estimatedDistance: 5 },
          { id: 'jp-good', status: JourneyStatus.IN_PROGRESS, startedAt, estimatedDistance: 5 },
        ]);
      }
      return Promise.resolve([]);
    });
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue({
      id: 'jp-bad',
      status: JourneyStatus.IN_PROGRESS,
      startedAt,
      estimatedDistance: 5,
    });
    (mockPrisma.gpsPoint.findFirst as jest.Mock).mockResolvedValue(null);

    (journeyService.systemInterruptJourney as jest.Mock)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined);

    const consoleErr = jest.spyOn(console, 'error').mockImplementation(() => {});
    await processJourneyExpiry();
    consoleErr.mockRestore();

    expect(journeyService.systemInterruptJourney).toHaveBeenCalledTimes(2);
  });

  test('estimatedDistance null defaults to 15-min threshold', async () => {
    const startedAt = new Date(Date.now() - 16 * 60 * 1000); // 16min > 15min default
    (mockPrisma.journey.findMany as jest.Mock).mockImplementation((args: any) => {
      if (args?.where?.status === JourneyStatus.IN_PROGRESS) {
        return Promise.resolve([
          { id: 'jp5', status: JourneyStatus.IN_PROGRESS, startedAt, estimatedDistance: null },
        ]);
      }
      return Promise.resolve([]);
    });
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue({
      id: 'jp5',
      status: JourneyStatus.IN_PROGRESS,
      startedAt,
      estimatedDistance: null,
    });
    (mockPrisma.gpsPoint.findFirst as jest.Mock).mockResolvedValue(null);

    await processJourneyExpiry();
    expect(journeyService.systemInterruptJourney).toHaveBeenCalledWith('jp5', 'STALE_NO_GPS_HEARTBEAT');
  });
});
