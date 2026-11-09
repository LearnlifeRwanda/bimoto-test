// INCLUDE-REACH G5 — the projection, per viewer, at the unit layer.
//
// The E2E spec (packages/e2e/tests/journey-read-authorization.spec.ts) is
// what proves the query actually narrows, because a mocked prisma cannot.
// What THIS pins is the decision that chooses the query: which scope each
// caller resolves to, and which relations the read is allowed to ask for
// once it has. Both halves are needed — the last two IDOR-class defects were
// certified for months by suites that only ever read as a participant.

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
const STRANGER_ID = 'stranger-1';

const journeyFindUnique = mockPrisma.journey.findUnique as jest.Mock;
const ratingFindUnique = (mockPrisma as any).rating.findUnique as jest.Mock;
const driverProfileFindUnique = (mockPrisma as any).driverProfile.findUnique as jest.Mock;
const feeWaiverFindMany = (mockPrisma as any).feeWaiver.findMany as jest.Mock;

function seed(status: string, extra: Record<string, unknown> = {}) {
  const base = {
    id: 'j1',
    status,
    customerId: CUSTOMER_ID,
    driverId: status === 'REQUESTED' ? null : DRIVER_ID,
    agreedPrice: null,
    type: 'PASSENGER',
    customer: { id: CUSTOMER_ID, nickname: 'Passenger', completedRides: 3 },
    legs: [],
    ...extra,
  };
  journeyFindUnique.mockResolvedValue(base);
  ratingFindUnique.mockResolvedValue(null);
  driverProfileFindUnique.mockResolvedValue({ totalRides: 12 });
  feeWaiverFindMany.mockResolvedValue([]);
  return base;
}

/** The `include` handed to the SECOND findUnique — the projection itself. */
function projectionInclude(): Record<string, unknown> {
  const calls = journeyFindUnique.mock.calls;
  expect(calls.length).toBeGreaterThanOrEqual(2);
  return calls[calls.length - 1][0].include;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('journeyViewerScope', () => {
  const requested = { customerId: CUSTOMER_ID, driverId: null, status: 'REQUESTED' };
  const matched = { customerId: CUSTOMER_ID, driverId: DRIVER_ID, status: 'MATCHED' };

  test('no viewer id is a server-internal caller, not an outsider', () => {
    // POST /:id/rate calls getJourneyById with no viewer (rating.routes.ts:83).
    expect(journeyService.journeyViewerScope(undefined, matched)).toBe('privileged');
  });

  test('the customer and the matched driver are participants', () => {
    expect(journeyService.journeyViewerScope(CUSTOMER_ID, matched)).toBe('participant');
    expect(journeyService.journeyViewerScope(DRIVER_ID, matched)).toBe('participant');
  });

  test('anyone else on an open request is a bidder', () => {
    expect(journeyService.journeyViewerScope(STRANGER_ID, requested)).toBe('bidder');
  });

  test('the same account is an outsider once the journey is matched to someone else', () => {
    expect(journeyService.journeyViewerScope(STRANGER_ID, matched)).toBe('outsider');
  });

  test('every non-REQUESTED status shuts a non-participant out', () => {
    for (const status of ['MATCHED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'SCHEDULED']) {
      expect(journeyService.journeyViewerScope(STRANGER_ID, { ...matched, status })).toBe(
        'outsider',
      );
    }
  });

  test('a journey that is not there has no viewer', () => {
    expect(journeyService.journeyViewerScope(STRANGER_ID, null)).toBe('outsider');
  });
});

describe('getJourneyById projection', () => {
  test('a participant asks for everything, exactly as before', async () => {
    seed('MATCHED');
    await journeyService.getJourneyById('j1', CUSTOMER_ID);

    const include = projectionInclude();
    expect(include).toHaveProperty('messages');
    expect(include).toHaveProperty('escrow');
    expect(include).toHaveProperty('bids');
    expect(include).toHaveProperty('driver');
    expect(include).toHaveProperty('legs');
    // Legs unnarrowed — the participant sees the contact he has to call.
    expect((include.legs as Record<string, unknown>).select).toBeUndefined();
  });

  test('a server-internal caller (no viewer id) is unchanged too', async () => {
    seed('MATCHED');
    await journeyService.getJourneyById('j1');
    expect(projectionInclude()).toHaveProperty('messages');
  });

  test('a bidder never asks for the chat, the escrow, the bids or the counterparty', async () => {
    seed('REQUESTED');
    const out = await journeyService.getJourneyById('j1', STRANGER_ID);

    const include = projectionInclude();
    expect(include).not.toHaveProperty('messages');
    expect(include).not.toHaveProperty('escrow');
    expect(include).not.toHaveProperty('bids');
    expect(include).not.toHaveProperty('driver');
    // He does get the passenger's public card and the stops.
    expect(include).toHaveProperty('customer');
    expect(include).toHaveProperty('legs');

    // …and the stops without the third party standing at them.
    const legSelect = (include.legs as { select: Record<string, unknown> }).select;
    expect(legSelect.contactName).toBeUndefined();
    expect(legSelect.contactPhone).toBeUndefined();
    expect(legSelect.recipientDisputeReason).toBeUndefined();
    // What he does need to price a parcel run.
    expect(legSelect.parcelSize).toBe(true);
    expect(legSelect.parcelCategory).toBe(true);
    expect(legSelect.name).toBe(true);
    expect(legSelect.lat).toBe(true);
    expect(legSelect.lng).toBe(true);

    // LIVE-WIRE G4's exact-net arithmetic still reaches the bid screen.
    expect((out as { payoutContext?: unknown }).payoutContext).toBeDefined();
    expect(out.myRating).toBeNull();
  });

  test('an outsider gets the lean projection and no money arithmetic at all', async () => {
    seed('MATCHED');
    const out = await journeyService.getJourneyById('j1', STRANGER_ID);

    const include = projectionInclude();
    expect(include).not.toHaveProperty('messages');
    expect(include).not.toHaveProperty('escrow');

    // No payout context, and no waiver or profile read to build one — there
    // is nobody to build it for. (The route answers this caller with 404.)
    expect((out as { payoutContext?: unknown }).payoutContext).toBeUndefined();
    expect(out.myRating).toBeNull();
    expect(driverProfileFindUnique).not.toHaveBeenCalled();
  });

  test('the scope is decided BEFORE the projection is asked for', async () => {
    seed('MATCHED');
    await journeyService.getJourneyById('j1', STRANGER_ID);

    // The first read is the three-column probe; a projection chosen after
    // the fact would already have loaded the chat into memory.
    const first = journeyFindUnique.mock.calls[0][0];
    expect(first.select).toEqual({ customerId: true, driverId: true, status: true });
    expect(first.include).toBeUndefined();
  });

  test('a journey nobody can find is 404 before any scope is resolved', async () => {
    journeyFindUnique.mockResolvedValue(null);
    await expect(journeyService.getJourneyById('nope', STRANGER_ID)).rejects.toMatchObject({
      statusCode: 404,
      code: 'JOURNEY_NOT_FOUND',
    });
    expect(journeyFindUnique).toHaveBeenCalledTimes(1);
  });
});
