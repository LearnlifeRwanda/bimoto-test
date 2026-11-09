jest.mock('../prisma', () => {
  const db: any = {
    journey: {
      findUnique: jest.fn(),
    },
    rating: {
      findUnique: jest.fn(),
      create: jest.fn(),
      aggregate: jest.fn(),
    },
    driverProfile: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    // MONEY-ATOMIC G4 — the create and the avgRating update now share one
    // transaction. The tx handed to the callback is this same object, so
    // every assertion below still reads the same jest.fn call lists.
    $transaction: jest.fn(async (cb: any) => cb(db)),
  };
  return { __esModule: true, default: db };
});

import prisma from '../prisma';
import * as ratingService from '../services/rating.service';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Rating Service', () => {
  test('creates a rating for a completed journey and recalculates avgRating', async () => {
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue({
      id: 'j1',
      customerId: 'c1',
      driverId: 'd1',
      status: 'COMPLETED',
    });
    (mockPrisma.rating.findUnique as jest.Mock).mockResolvedValue(null); // no duplicate
    (mockPrisma.rating.create as jest.Mock).mockResolvedValue({
      id: 'r1',
      journeyId: 'j1',
      raterId: 'c1',
      ratedId: 'd1',
      stars: 4,
      comment: 'Good ride',
    });
    (mockPrisma.driverProfile.findUnique as jest.Mock).mockResolvedValue({
      userId: 'd1',
      avgRating: 4.5,
    });
    (mockPrisma.rating.aggregate as jest.Mock).mockResolvedValue({
      _avg: { stars: 4.25 },
    });
    (mockPrisma.driverProfile.update as jest.Mock).mockResolvedValue({});

    const result = await ratingService.createRating('j1', 'c1', 'd1', 4, 'Good ride');

    expect(result.stars).toBe(4);
    expect(mockPrisma.rating.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        journeyId: 'j1',
        raterId: 'c1',
        ratedId: 'd1',
        stars: 4,
      }),
    });
    // avgRating should be recalculated
    expect(mockPrisma.driverProfile.update).toHaveBeenCalledWith({
      where: { userId: 'd1' },
      data: { avgRating: 4.25 },
    });
  });

  test('rejects rating for non-completed journey', async () => {
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue({
      id: 'j1',
      customerId: 'c1',
      driverId: 'd1',
      status: 'IN_PROGRESS',
    });

    await expect(ratingService.createRating('j1', 'c1', 'd1', 5))
      .rejects.toThrow('errors.journeyNotCompleted');
  });

  test('rejects duplicate rating', async () => {
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue({
      id: 'j1',
      customerId: 'c1',
      driverId: 'd1',
      status: 'COMPLETED',
    });
    (mockPrisma.rating.findUnique as jest.Mock).mockResolvedValue({
      id: 'existing',
    });

    await expect(ratingService.createRating('j1', 'c1', 'd1', 5))
      .rejects.toThrow('errors.alreadyRated');
  });

  test('rejects if rater is not a journey participant', async () => {
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue({
      id: 'j1',
      customerId: 'c1',
      driverId: 'd1',
      status: 'COMPLETED',
    });

    await expect(ratingService.createRating('j1', 'stranger', 'd1', 5))
      .rejects.toThrow('errors.notJourneyParticipant');
  });
});

// TEAM-ANSWERS G2 — the service half of the impossibility test. The
// route is not the guarantee; these are. No caller, present or future,
// can persuade createRating to write a Rating row pointing at a customer.
describe('Rating Service — passengers are never scored', () => {
  const COMPLETED = {
    id: 'j1',
    customerId: 'c1',
    driverId: 'd1',
    status: 'COMPLETED',
  };

  test('refuses a rating whose RATEE is the customer, even from the driver', async () => {
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue(COMPLETED);

    await expect(ratingService.createRating('j1', 'd1', 'c1', 5))
      .rejects.toThrow('errors.notJourneyParticipant');
    expect(mockPrisma.rating.create).not.toHaveBeenCalled();
  });

  test('refuses a rating whose RATEE is the customer even when the rater IS the customer', async () => {
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue(COMPLETED);

    // The pathological self-referential call — the shape a future caller
    // could reach for if it wanted a per-passenger number.
    await expect(ratingService.createRating('j1', 'c1', 'c1', 5))
      .rejects.toThrow('errors.invalidRatedUser');
    expect(mockPrisma.rating.create).not.toHaveBeenCalled();
  });

  test('refuses when the journey has no driver to rate', async () => {
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue({
      ...COMPLETED,
      driverId: null,
    });

    await expect(ratingService.createRating('j1', 'c1', 'd1', 5))
      .rejects.toThrow('errors.invalidRatedUser');
    expect(mockPrisma.rating.create).not.toHaveBeenCalled();
  });

  test('stores an optional low-star reason, and null when none was given', async () => {
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue(COMPLETED);
    (mockPrisma.rating.findUnique as jest.Mock).mockResolvedValue(null);
    (mockPrisma.rating.create as jest.Mock).mockResolvedValue({ id: 'r1' });
    (mockPrisma.driverProfile.findUnique as jest.Mock).mockResolvedValue(null);

    await ratingService.createRating('j1', 'c1', 'd1', 1, 'he would not use the meter', 'PRICE_DISAGREEMENT' as any);
    expect((mockPrisma.rating.create as jest.Mock).mock.calls[0][0].data).toEqual(
      expect.objectContaining({ reason: 'PRICE_DISAGREEMENT', comment: 'he would not use the meter' }),
    );

    jest.clearAllMocks();
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue(COMPLETED);
    (mockPrisma.rating.findUnique as jest.Mock).mockResolvedValue(null);
    (mockPrisma.rating.create as jest.Mock).mockResolvedValue({ id: 'r2' });
    (mockPrisma.driverProfile.findUnique as jest.Mock).mockResolvedValue(null);

    await ratingService.createRating('j1', 'c1', 'd1', 5);
    expect((mockPrisma.rating.create as jest.Mock).mock.calls[0][0].data).toEqual(
      expect.objectContaining({ reason: null }),
    );
  });
});
