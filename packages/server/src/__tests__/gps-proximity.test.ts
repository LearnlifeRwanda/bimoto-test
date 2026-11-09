import { JourneyStatus } from '@bimoto/shared';

jest.mock('../prisma', () => {
  const db: any = {
    journey: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    driverProfile: {
      update: jest.fn(),
    },
    escrow: {
      findUnique: jest.fn(),
    },
    gpsPoint: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    user: {
      update: jest.fn(),
    },
    // MONEY-ATOMIC G3 — endJourney now does its writes inside one
    // transaction. The tx handed to the callback is this same object, so
    // every assertion below still reads the same jest.fn call lists.
    $transaction: jest.fn(async (cb: any) => cb(db)),
  };
  return { __esModule: true, default: db };
});

jest.mock('../services/escrow.service', () => ({
  releaseEscrow: jest.fn().mockResolvedValue({}),
  freezeEscrow: jest.fn().mockResolvedValue({}),
}));

jest.mock('../services/escrow-audit.service', () => ({
  appendAuditEntry: jest.fn().mockResolvedValue(undefined),
  appendAuditEntryTx: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../services/journey-validation.service', () => ({
  validateJourneyPlausibility: jest.fn().mockResolvedValue({ valid: true, flags: [] }),
}));

import prisma from '../prisma';
import * as journeyService from '../services/journey.service';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GPS Proximity Validation', () => {
  describe('startJourney', () => {
    const baseJourney = {
      id: 'j1',
      driverId: 'd1',
      customerId: 'c1',
      status: JourneyStatus.MATCHED,
      pickupLat: -1.9403,
      pickupLng: 29.8739,
      destinationLat: -1.9553,
      destinationLng: 29.8939,
    };

    test('fails if driver is >1km from pickup', async () => {
      (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue(baseJourney);

      // ~10km away from pickup
      await expect(journeyService.startJourney('j1', 'd1', -1.85, 29.87))
        .rejects.toThrow('errors.tooFarFromPickup');
    });

    test('succeeds if driver is within 1km of pickup', async () => {
      (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue(baseJourney);
      (mockPrisma.journey.update as jest.Mock).mockResolvedValue({
        ...baseJourney,
        status: JourneyStatus.IN_PROGRESS,
        startedAt: new Date(),
      });
      (mockPrisma.driverProfile.update as jest.Mock).mockResolvedValue({});

      // Very close to pickup (~100m)
      const result = await journeyService.startJourney('j1', 'd1', -1.9404, 29.8740);
      expect(result.status).toBe(JourneyStatus.IN_PROGRESS);
    });

    test('allows start with null GPS (flags in audit log)', async () => {
      (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue(baseJourney);
      (mockPrisma.journey.update as jest.Mock).mockResolvedValue({
        ...baseJourney,
        status: JourneyStatus.IN_PROGRESS,
        startedAt: new Date(),
      });
      (mockPrisma.escrow.findUnique as jest.Mock).mockResolvedValue({ id: 'e1', amount: 2000 });

      const result = await journeyService.startJourney('j1', 'd1', null, null);
      expect(result.status).toBe(JourneyStatus.IN_PROGRESS);
    });
  });

  describe('endJourney', () => {
    const inProgressJourney = {
      id: 'j1',
      driverId: 'd1',
      customerId: 'c1',
      status: JourneyStatus.IN_PROGRESS,
      type: 'PASSENGER',
      pickupLat: -1.9403,
      pickupLng: 29.8739,
      destinationLat: -1.9553,
      destinationLng: 29.8939,
      recipientPhone: null,
    };

    test('fails if driver is >2km from destination', async () => {
      (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue(inProgressJourney);
      // Driver had a recent GPS ping = NOT dark, so the late-completion path
      // does NOT relax the gate; the strict TOO_FAR error stands.
      (mockPrisma.gpsPoint.findFirst as jest.Mock).mockResolvedValue({ id: 'gp1' });

      // ~10km away from destination
      await expect(journeyService.endJourney('j1', 'd1', -1.85, 29.87))
        .rejects.toThrow('errors.tooFarFromDestination');
    });

    test('succeeds if driver is within 2km of destination', async () => {
      (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue(inProgressJourney);
      (mockPrisma.journey.update as jest.Mock).mockResolvedValue({
        ...inProgressJourney,
        status: JourneyStatus.AWAITING_CONFIRMATION,
        endedAt: new Date(),
      });
      (mockPrisma.driverProfile.update as jest.Mock).mockResolvedValue({});

      // Within 1km of destination
      const result = await journeyService.endJourney('j1', 'd1', -1.956, 29.894);
      expect(result.status).toBe(JourneyStatus.AWAITING_CONFIRMATION);
    });
  });
});
