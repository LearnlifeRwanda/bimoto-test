jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    gpsPoint: {
      findFirst: jest.fn(),
    },
    journey: {
      update: jest.fn(),
    },
  },
}));

import prisma from '../prisma';
import {
  wasDriverDarkBefore,
  assertLateCompletionAcceptable,
  markJourneyLateCompletion,
} from '../services/journey-resilience/late-completion';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('wasDriverDarkBefore', () => {
  test('returns true when no GPS ping in window', async () => {
    (mockPrisma.gpsPoint.findFirst as jest.Mock).mockResolvedValue(null);
    expect(await wasDriverDarkBefore('j1')).toBe(true);
  });

  test('returns false when a recent ping exists', async () => {
    (mockPrisma.gpsPoint.findFirst as jest.Mock).mockResolvedValue({ id: 'gp1' });
    expect(await wasDriverDarkBefore('j1')).toBe(false);
  });
});

describe('assertLateCompletionAcceptable', () => {
  const journeyBase = {
    id: 'j1',
    destinationLat: -1.95,
    destinationLng: 29.89,
  };

  test('accepts NORMAL when GPS within 2km of destination', async () => {
    const result = await assertLateCompletionAcceptable(
      { ...journeyBase, startedAt: new Date(Date.now() - 60 * 60 * 1000) },
      -1.95,
      29.89,
    );
    expect(result).toEqual({ accept: true, reason: 'NORMAL' });
  });

  test('accepts GPS_DARK_PERIOD when far from destination but driver was dark', async () => {
    (mockPrisma.gpsPoint.findFirst as jest.Mock).mockResolvedValue(null);
    const result = await assertLateCompletionAcceptable(
      { ...journeyBase, startedAt: new Date(Date.now() - 60 * 60 * 1000) },
      -1.85, // ~10km away
      29.89,
    );
    expect(result).toEqual({ accept: true, reason: 'GPS_DARK_PERIOD' });
  });

  test('rejects TOO_FAR_NOT_DARK when far and driver had recent GPS', async () => {
    (mockPrisma.gpsPoint.findFirst as jest.Mock).mockResolvedValue({ id: 'gp1' });
    const result = await assertLateCompletionAcceptable(
      { ...journeyBase, startedAt: new Date(Date.now() - 60 * 60 * 1000) },
      -1.85,
      29.89,
    );
    expect(result).toEqual({ accept: false, reason: 'TOO_FAR_NOT_DARK' });
  });

  test('rejects when journey just started (cannot have been dark 10min)', async () => {
    const result = await assertLateCompletionAcceptable(
      { ...journeyBase, startedAt: new Date(Date.now() - 30 * 1000) },
      -1.85,
      29.89,
    );
    expect(result).toEqual({ accept: false, reason: 'TOO_FAR_NOT_DARK' });
  });

  test('with no GPS lat/lng, dark period accepts late completion', async () => {
    (mockPrisma.gpsPoint.findFirst as jest.Mock).mockResolvedValue(null);
    const result = await assertLateCompletionAcceptable(
      { ...journeyBase, startedAt: new Date(Date.now() - 60 * 60 * 1000) },
      null,
      null,
    );
    expect(result).toEqual({ accept: true, reason: 'GPS_DARK_PERIOD' });
  });
});

describe('markJourneyLateCompletion', () => {
  test('updates Journey.lateCompletion=true', async () => {
    (mockPrisma.journey.update as jest.Mock).mockResolvedValue({});
    await markJourneyLateCompletion('j1');
    expect(mockPrisma.journey.update).toHaveBeenCalledWith({
      where: { id: 'j1' },
      data: { lateCompletion: true },
    });
  });
});
