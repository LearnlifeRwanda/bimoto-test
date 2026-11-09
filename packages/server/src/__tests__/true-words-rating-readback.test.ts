// TRUE-WORDS G5.1 — the receipt remembers your stars.
//
// COCKPIT #164 gave the passenger a way to rate a ride but no way to read
// the rating back: GET /api/journeys/:id carried bids, escrow, messages,
// customer, driver and legs, and no ratings at all. Reopening a receipt on
// a ride you had already rated offered the stars again, and the only way
// to discover you had rated was to submit and read the 409.
//
// The fix rides the GET the receipt already makes rather than adding an
// endpoint, so what has to be pinned here is (a) that the viewer's own
// stars come back, (b) that they are the VIEWER's and nobody else's, and
// (c) that the extra query is not paid on every journey read.

import * as journeyService from '../services/journey.service';

jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    journey: { findUnique: jest.fn() },
    rating: { findUnique: jest.fn() },
    driverProfile: { findUnique: jest.fn() },
    feeWaiver: { findMany: jest.fn(), findFirst: jest.fn() },
  },
}));

import mockPrisma from '../prisma';

const CUSTOMER_ID = 'cust-1';
const DRIVER_ID = 'drv-1';

const journeyFindUnique = mockPrisma.journey.findUnique as jest.Mock;
const ratingFindUnique = (mockPrisma as any).rating.findUnique as jest.Mock;

/** A finished ride with no agreed price — the plain return path. */
function seedCompleted(overrides: Record<string, unknown> = {}) {
  journeyFindUnique.mockResolvedValue({
    id: 'j1',
    status: 'COMPLETED',
    customerId: CUSTOMER_ID,
    driverId: DRIVER_ID,
    agreedPrice: null,
    escrow: null,
    bids: [],
    messages: [],
    legs: [],
    customer: { id: CUSTOMER_ID, nickname: 'Alice', completedRides: 3 },
    driver: { id: DRIVER_ID, nickname: 'Bob', driverProfile: null },
    ...overrides,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  ratingFindUnique.mockResolvedValue(null);
  (mockPrisma.driverProfile.findUnique as jest.Mock).mockResolvedValue({ totalRides: 10 });
  ((mockPrisma as any).feeWaiver.findMany as jest.Mock).mockResolvedValue([]);
  ((mockPrisma as any).feeWaiver.findFirst as jest.Mock).mockResolvedValue(null);
});

describe('getJourneyById — the viewer\'s own rating rides the journey GET', () => {
  test('a rated ride comes back with the stars the viewer gave', async () => {
    seedCompleted();
    ratingFindUnique.mockResolvedValue({
      stars: 4,
      comment: null,
      createdAt: new Date('2026-08-14T10:00:00Z'),
    });

    const journey = (await journeyService.getJourneyById('j1', CUSTOMER_ID)) as any;

    expect(journey.myRating).toEqual(
      expect.objectContaining({ stars: 4, comment: null }),
    );
  });

  test('an unrated ride comes back with myRating null, not undefined', async () => {
    // The client distinguishes "not rated" from "this server does not
    // report ratings", so the field must be present and null.
    seedCompleted();

    const journey = (await journeyService.getJourneyById('j1', CUSTOMER_ID)) as any;

    expect(journey).toHaveProperty('myRating', null);
  });

  test('the lookup is scoped to the viewer — never the counterpart', async () => {
    // The driver reading the same receipt must not learn what the
    // passenger thought of them, and vice versa. The unique key is
    // (journeyId, raterId), so the scoping lives in the where clause.
    seedCompleted();

    await journeyService.getJourneyById('j1', DRIVER_ID);

    expect(ratingFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { journeyId_raterId: { journeyId: 'j1', raterId: DRIVER_ID } },
      }),
    );
  });

  test('an unfinished ride pays for no rating query at all', async () => {
    // Only a COMPLETED journey can carry a rating (rating.service.ts
    // refuses anything else with 400 JOURNEY_NOT_COMPLETED), so every
    // other journey read must skip the round trip.
    seedCompleted({ status: 'IN_PROGRESS' });

    const journey = (await journeyService.getJourneyById('j1', CUSTOMER_ID)) as any;

    expect(ratingFindUnique).not.toHaveBeenCalled();
    expect(journey.myRating).toBeNull();
  });

  test('an unauthenticated read pays for no rating query either', async () => {
    seedCompleted();

    const journey = (await journeyService.getJourneyById('j1')) as any;

    expect(ratingFindUnique).not.toHaveBeenCalled();
    expect(journey.myRating).toBeNull();
  });

  test('the priced path carries it too — the receipt is a priced ride', async () => {
    // A real completed ride has an agreed price, which sends
    // getJourneyById down the commissionBreakdown return rather than the
    // plain one. Both returns must carry the field or the receipt forgets
    // the stars on exactly the journeys that have them.
    seedCompleted({
      agreedPrice: 1200,
      driver: { id: DRIVER_ID, nickname: 'Bob', driverProfile: { totalRides: 40 } },
    });
    ratingFindUnique.mockResolvedValue({
      stars: 5,
      comment: 'Fast',
      createdAt: new Date('2026-08-14T10:00:00Z'),
    });

    // CUTGUARD v2 amendment 2 — v14, so `commissionBreakdown` is actually
    // attached and the assertion below still identifies which of the two
    // returns was taken. The rating must ride BOTH returns, and the gate
    // must not be what decides that.
    const journey = (await journeyService.getJourneyById('j1', CUSTOMER_ID, {
      customerSavingsPreview: true,
    })) as any;

    expect(journey.commissionBreakdown).toBeDefined();
    expect(journey.myRating).toEqual(expect.objectContaining({ stars: 5 }));
  });
});
