// ACCOUNT-RIGHTS-CORE G5 — the ONE carve-out in the 72-hour window.
//
// Founder ruling D1 is emphatic that the deletion window is NORMAL:
// everything works, SOS and the blocking states are untouched, mobility is
// never gated. The single exception is a scheduled ride booked for a time
// past the account's own deletion date — not a gate on mobility, but a
// refusal to promise a ride the account will not be there to take.
//
// So the tests that matter most here are the ones proving what is NOT
// refused. A carve-out that quietly became a booking ban would violate D1
// far more seriously than a missing refusal.

jest.mock('../prisma', () => {
  const journeyCreate = jest.fn();
  const db: any = {
    journey: { create: journeyCreate, count: jest.fn(), findFirst: jest.fn() },
    user: { findUnique: jest.fn(), update: jest.fn() },
    deletionRequest: { findFirst: jest.fn(async () => null) },
    $transaction: jest.fn(async (cb: any) => {
      const tx = {
        ...db,
        journey: { ...db.journey, create: journeyCreate },
        leg: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
      };
      return cb(tx);
    }),
  };
  return { __esModule: true, default: db };
});

jest.mock('../services/journey-validation.service', () => ({
  validateJourneyPlausibility: jest.fn().mockResolvedValue({ valid: true, flags: [] }),
}));

import { JourneyStatus } from '@bimoto/shared';
import prisma from '../prisma';
import * as journeyService from '../services/journey.service';

const db = prisma as any;
const CUSTOMER = 'c1';
const HOUR = 60 * 60 * 1000;

/** Deletion executes in 72h, the ordinary case. */
function pendingDeletionIn(ms: number) {
  db.deletionRequest.findFirst.mockResolvedValue({
    requestedAt: new Date(),
    executesAt: new Date(Date.now() + ms),
  });
}

function noPendingDeletion() {
  db.deletionRequest.findFirst.mockResolvedValue(null);
}

const BASE = {
  type: 'PASSENGER' as any,
  pickupLat: -1.95,
  pickupLng: 29.87,
  pickupName: 'Kigali Heights',
  destinationLat: -1.96,
  destinationLng: 29.88,
  destinationName: 'Kimironko Market',
  goodsFragile: false,
};

function scheduled(atMs: number) {
  return {
    ...BASE,
    bookingMode: 'SCHEDULED' as any,
    scheduledFor: new Date(Date.now() + atMs).toISOString(),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  noPendingDeletion();
  db.user.findUnique.mockResolvedValue({ id: CUSTOMER, isFlagged: false });
  db.journey.count.mockResolvedValue(0);
  db.journey.findFirst.mockResolvedValue(null);
  db.journey.create.mockImplementation(async ({ data }: any) => ({ id: 'j1', ...data }));
  db.user.update.mockResolvedValue({});
});

describe('D1 carve-out — a scheduled ride past your own deletion date', () => {
  test('REFUSED: deletion in 72h, ride scheduled 96h out', async () => {
    pendingDeletionIn(72 * HOUR);

    await expect(
      journeyService.createJourney(CUSTOMER, scheduled(96 * HOUR)),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'SCHEDULED_PAST_DELETION',
      message: 'errors.scheduledPastDeletion',
    });
    expect(db.journey.create).not.toHaveBeenCalled();
  });

  test('ALLOWED: the same deletion, a ride 24h out — comfortably inside the window', async () => {
    pendingDeletionIn(72 * HOUR);

    const result = await journeyService.createJourney(CUSTOMER, scheduled(24 * HOUR));

    expect(result.status).toBe(JourneyStatus.SCHEDULED);
    expect(db.journey.create).toHaveBeenCalledTimes(1);
  });

  test('ALLOWED: a ride just BEFORE executesAt is fine; just after is not', async () => {
    pendingDeletionIn(48 * HOUR);

    await expect(
      journeyService.createJourney(CUSTOMER, scheduled(48 * HOUR - 5 * 60 * 1000)),
    ).resolves.toBeTruthy();

    jest.clearAllMocks();
    pendingDeletionIn(48 * HOUR);
    db.user.findUnique.mockResolvedValue({ id: CUSTOMER, isFlagged: false });
    db.journey.count.mockResolvedValue(0);
    db.journey.findFirst.mockResolvedValue(null);

    await expect(
      journeyService.createJourney(CUSTOMER, scheduled(48 * HOUR + 5 * 60 * 1000)),
    ).rejects.toMatchObject({ code: 'SCHEDULED_PAST_DELETION' });
  });
});

describe('D1 — everything else in the window is untouched', () => {
  test('no pending deletion: a ride 30 days out books normally', async () => {
    noPendingDeletion();

    const result = await journeyService.createJourney(CUSTOMER, scheduled(29 * 24 * HOUR));

    expect(result.status).toBe(JourneyStatus.SCHEDULED);
    expect(db.journey.create).toHaveBeenCalledTimes(1);
  });

  test('an IMMEDIATE ride is never touched, even with a deletion pending', async () => {
    pendingDeletionIn(1 * HOUR);

    const result = await journeyService.createJourney(CUSTOMER, BASE);

    // Mobility is never gated (D1). An immediate ride happens now, so it
    // cannot outlive the account, and the carve-out must not even look.
    expect(result.status).toBe(JourneyStatus.REQUESTED);
    expect(db.journey.create).toHaveBeenCalledTimes(1);
  });

  test('the deletion lookup is scoped to the booking customer', async () => {
    pendingDeletionIn(72 * HOUR);
    await journeyService.createJourney(CUSTOMER, scheduled(24 * HOUR));

    expect(db.deletionRequest.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: CUSTOMER, status: 'PENDING' },
      }),
    );
  });

  test('a CANCELLED deletion stops carving out at once — the later slot is bookable again', async () => {
    // Cancellation leaves no PENDING row, so the lookup finds nothing and
    // the refusal disappears on the very next booking attempt.
    noPendingDeletion();

    await expect(
      journeyService.createJourney(CUSTOMER, scheduled(96 * HOUR)),
    ).resolves.toBeTruthy();
  });
});
