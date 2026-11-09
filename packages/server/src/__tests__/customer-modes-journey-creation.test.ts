// __TESTS__/CUSTOMER-MODES-JOURNEY-CREATION.TEST.TS
//
// Dispatch K3 group 4 — verifies createJourney correctly handles
// the new requestMode + priceCeilingMultiplier fields, computes &
// LOCKS the priceCeilingRwf at creation time, and rejects malformed
// combinations. Backward-compat: omitting requestMode falls back to
// WAIT_AND_COMPARE with no ceiling fields populated.

jest.mock('../prisma', () => {
  const journeyCreate = jest.fn();
  return {
    __esModule: true,
    default: {
      journey: {
        create: journeyCreate,
      },
      user: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      // R3-LEGS — createJourney wraps journey.create + legs.createMany
      // in $transaction. Invoke the callback with a tx that proxies
      // journey.create through to the top-level mock so existing
      // assertions on `mockPrisma.journey.create.mock.calls` keep
      // working.
      $transaction: jest.fn(async (cb: any) => {
        const tx = {
          journey: { create: journeyCreate },
          leg: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
        };
        return cb(tx);
      }),
    },
  };
});

jest.mock('../services/discovery/supply-broadcast', () => ({
  scheduleCascadeBroadcasts: jest.fn(),
}));

jest.mock('../socket', () => ({
  emitToJourney: jest.fn(),
  getIO: () => {
    throw new Error('not initialized');
  },
}));

jest.mock('../services/fair-price.service', () => ({
  estimatePrice: jest.fn((distanceKm: number) => ({
    min: 300 + 200 * distanceKm,
    max: 300 + 400 * distanceKm,
  })),
}));

import prisma from '../prisma';
import * as fairPriceMock from '../services/fair-price.service';
import * as journeyService from '../services/journey.service';

const mockPrisma = prisma as any;
const mockEstimate = fairPriceMock.estimatePrice as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.user.findUnique.mockResolvedValue({ id: 'c1', isFlagged: false });
  mockEstimate.mockImplementation((distanceKm: number) => ({
    min: 300 + 200 * distanceKm,
    max: 300 + 400 * distanceKm,
  }));
  mockPrisma.journey.create.mockImplementation(({ data }: any) =>
    Promise.resolve({ id: 'j1', ...data, discoveryStartedAt: new Date(), createdAt: new Date() }),
  );
});

const baseInput = {
  type: 'PASSENGER' as const,
  pickupLat: -1.95,
  pickupLng: 30.06,
  pickupName: 'Pickup',
  destinationLat: -1.96,
  destinationLng: 30.07,
  destinationName: 'Drop',
};

describe('createJourney + customer modes', () => {
  it('omitting requestMode → WAIT_AND_COMPARE, no ceiling (backward compat)', async () => {
    await journeyService.createJourney('c1', baseInput as any);

    const args = mockPrisma.journey.create.mock.calls[0][0].data;
    expect(args.requestMode).toBe('WAIT_AND_COMPARE');
    expect(args.priceCeilingMultiplier).toBeNull();
    expect(args.priceCeilingRwf).toBeNull();
  });

  it('NEED_TO_GO + multiplier=1.3 → ceiling computed and stored', async () => {
    // Distance ~1.5 km → fair midpoint = (300+300 + 300+600)/2 = 750
    // Choose a known-distance scenario by mocking estimatePrice directly.
    mockEstimate.mockReturnValueOnce({ min: 1700, max: 2300 });
    // midpoint = 2000, multiplier = 1.3 → ceiling = 2600

    await journeyService.createJourney('c1', {
      ...baseInput,
      requestMode: 'NEED_TO_GO',
      priceCeilingMultiplier: 1.3,
    } as any);

    const args = mockPrisma.journey.create.mock.calls[0][0].data;
    expect(args.requestMode).toBe('NEED_TO_GO');
    expect(args.priceCeilingMultiplier).toBe(1.3);
    expect(args.priceCeilingRwf).toBe(2600);
  });

  it('NEED_TO_GO without multiplier → 400', async () => {
    await expect(
      journeyService.createJourney('c1', {
        ...baseInput,
        requestMode: 'NEED_TO_GO',
      } as any),
    ).rejects.toMatchObject({ statusCode: 400, code: 'PRICE_CEILING_MULTIPLIER_REQUIRED' });
  });

  it('NEED_TO_GO + multiplier=0.9 → 400 (below min)', async () => {
    await expect(
      journeyService.createJourney('c1', {
        ...baseInput,
        requestMode: 'NEED_TO_GO',
        priceCeilingMultiplier: 0.9,
      } as any),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'PRICE_CEILING_MULTIPLIER_OUT_OF_RANGE',
    });
  });

  it('NEED_TO_GO + multiplier=2.1 → 400 (above max)', async () => {
    await expect(
      journeyService.createJourney('c1', {
        ...baseInput,
        requestMode: 'NEED_TO_GO',
        priceCeilingMultiplier: 2.1,
      } as any),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'PRICE_CEILING_MULTIPLIER_OUT_OF_RANGE',
    });
  });

  it('WAIT_AND_COMPARE + multiplier provided → 400', async () => {
    await expect(
      journeyService.createJourney('c1', {
        ...baseInput,
        requestMode: 'WAIT_AND_COMPARE',
        priceCeilingMultiplier: 1.3,
      } as any),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'PRICE_CEILING_MULTIPLIER_NOT_ALLOWED',
    });
  });

  it('CEILING LOCKED at creation: subsequent fair-price changes do not affect stored ceiling', async () => {
    // First create with fairPrice midpoint = 2000, multiplier = 1.3 → ceiling = 2600
    mockEstimate.mockReturnValueOnce({ min: 1700, max: 2300 });
    await journeyService.createJourney('c1', {
      ...baseInput,
      requestMode: 'NEED_TO_GO',
      priceCeilingMultiplier: 1.3,
    } as any);
    const firstArgs = mockPrisma.journey.create.mock.calls[0][0].data;
    expect(firstArgs.priceCeilingRwf).toBe(2600);

    // Now simulate admin re-tune: estimatePrice returns a different midpoint.
    mockEstimate.mockReturnValueOnce({ min: 2200, max: 2800 });
    await journeyService.createJourney('c1', {
      ...baseInput,
      requestMode: 'NEED_TO_GO',
      priceCeilingMultiplier: 1.3,
    } as any);
    const secondArgs = mockPrisma.journey.create.mock.calls[1][0].data;
    // The new journey gets 3250 (midpoint 2500 * 1.3) — but the FIRST
    // journey's stored value (2600) was not retroactively recomputed.
    expect(secondArgs.priceCeilingRwf).toBe(3250);
    expect(firstArgs.priceCeilingRwf).toBe(2600);
  });
});
