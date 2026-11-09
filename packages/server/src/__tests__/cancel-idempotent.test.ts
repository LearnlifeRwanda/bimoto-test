// __TESTS__/CANCEL-IDEMPOTENT.TEST.TS
//
// COUNTER-READY G2 — cancelling an already-cancelled journey ANSWERS.
//
// THE FIELD EVIDENCE. The pilot server log carries the live defect
// `Invalid journey transition: CANCELLED + CANCEL`: the state machine has
// no CANCELLED→CANCEL edge, so a second cancel of the same journey threw
// instead of answering. This wave adds a cancel button to the offers
// screen (REQUEST-WITHDRAW), and a double-tap on a slow network would hit
// it directly.
//
// WHAT IS PINNED, in both directions:
//   * the second cancel SUCCEEDS and hands back the cancelled journey;
//   * and it does NOTHING TWICE — no second journey.update overwriting
//     cancelledAt and cancelReason with the retry's clock, no second
//     refund, no second attribution (which increments no-show counters
//     and can flag or suspend a driver), no second scheduled bump;
//   * COMPLETED and EXPIRED still refuse, because they are not cancelled
//     and saying "done" about them would be a lie;
//   * every per-reason refusal is UNCHANGED, which is what placing the
//     early return after the reason switch buys.

jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    journey: { findUnique: jest.fn(), update: jest.fn() },
    user: { update: jest.fn() },
    $transaction: jest.fn(),
  },
}));

jest.mock('../services/escrow.service', () => ({
  refundEscrow: jest.fn().mockResolvedValue({}),
  refundEscrowTx: jest.fn().mockResolvedValue({}),
}));

jest.mock('../services/scheduled-rides', () => ({
  bumpScheduledCancellationCount: jest.fn().mockResolvedValue({}),
  validateScheduledFor: jest.fn(),
  validatePickupCoords: jest.fn(),
  computeBidWindowTimes: jest.fn(),
}));

jest.mock('../services/journey-state-transitions', () => ({
  onJourneyExitsRequested: jest.fn(),
}));

// EXPORT-AND-LEDGER G6(a) — the Proxy auto-stub. cancelJourney reaches
// notification.service through several branches (the refund
// announcement, the graduated-penalty pushes) and enumerating them by
// hand is exactly the mock-drift class this helper closed.
jest.mock('../services/notification.service', () =>
  require('./helpers/notification-service-mock').autoStubbedModule(),
);

import prisma from '../prisma';
import { CancelReason } from '@prisma/client';
import { cancelJourney } from '../services/journey.service';
import * as escrowService from '../services/escrow.service';
import { bumpScheduledCancellationCount } from '../services/scheduled-rides';
import { onJourneyExitsRequested } from '../services/journey-state-transitions';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

function cancelledJourney(over: Record<string, unknown> = {}) {
  return {
    id: 'j1',
    customerId: 'c1',
    driverId: 'd1',
    status: 'CANCELLED',
    bookingMode: 'IMMEDIATE',
    matchedAt: new Date(Date.now() - 10 * 60 * 1000),
    startedAt: null,
    cancelledAt: new Date('2026-08-25T09:00:00.000Z'),
    cancelReason: 'CUSTOMER_CHANGED_MIND',
    escrow: { id: 'e1', amount: 2000 },
    ...over,
  };
}

function setupTxCapture() {
  const journeyUpdates: any[] = [];
  const userUpdates: any[] = [];
  (mockPrisma.$transaction as jest.Mock).mockImplementation(async (fn: any) => {
    const tx = {
      user: { update: jest.fn(async (a: any) => userUpdates.push(a)) },
      journey: {
        update: jest.fn(async (a: any) => {
          journeyUpdates.push(a);
          return { ...a.data, id: 'j1' };
        }),
      },
    };
    return fn(tx);
  });
  return { journeyUpdates, userUpdates };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('a second cancel of an already-cancelled journey', () => {
  test('succeeds, and hands back the journey as it stands', async () => {
    const existing = cancelledJourney();
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue(existing);
    setupTxCapture();

    const result = await cancelJourney('j1', 'c1', CancelReason.CUSTOMER_CHANGED_MIND);

    expect(result.status).toBe('CANCELLED');
    expect(result.id).toBe('j1');
    // The FIRST cancellation's stamps survive — a retry does not
    // rewrite when, or why, the journey was cancelled.
    expect(result.cancelReason).toBe('CUSTOMER_CHANGED_MIND');
    expect(result.cancelledAt).toEqual(existing.cancelledAt);
  });

  test('the answer does not carry the escrow row a participant never asked for', async () => {
    // `journey` is read with include: { escrow: true } for the refund
    // branch; the first cancel returns a plain journey.update row, and
    // the retry must have the same shape rather than being the one call
    // that hands money detail back.
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue(cancelledJourney());
    setupTxCapture();

    const result = await cancelJourney('j1', 'c1', CancelReason.CUSTOMER_CHANGED_MIND);

    expect(result).not.toHaveProperty('escrow');
  });

  test('NOTHING happens twice', async () => {
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue(cancelledJourney());
    const { journeyUpdates, userUpdates } = setupTxCapture();

    await cancelJourney('j1', 'c1', CancelReason.CUSTOMER_CHANGED_MIND);

    // No transaction at all: no status write, no attribution, no refund.
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(journeyUpdates).toHaveLength(0);
    expect(userUpdates).toHaveLength(0);
    expect(escrowService.refundEscrowTx).not.toHaveBeenCalled();
    expect(escrowService.refundEscrow).not.toHaveBeenCalled();
    expect(bumpScheduledCancellationCount).not.toHaveBeenCalled();
    expect(onJourneyExitsRequested).not.toHaveBeenCalled();
  });

  test('no double refund even when the journey was MATCHED and had money on it', async () => {
    // The dangerous shape: the first cancel refunded a held escrow. A
    // second pass that ran the refund branch again would return the
    // passenger's money a second time.
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue(
      cancelledJourney({ escrow: { id: 'e1', amount: 2000, status: 'REFUNDED' } }),
    );
    setupTxCapture();

    await cancelJourney('j1', 'c1', CancelReason.CUSTOMER_CHANGED_MIND);

    expect(escrowService.refundEscrowTx).not.toHaveBeenCalled();
  });

  test('SAFETY_CONCERN — the other always-allowed reason — is idempotent too', async () => {
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue(cancelledJourney());
    setupTxCapture();

    const result = await cancelJourney('j1', 'c1', CancelReason.SAFETY_CONCERN);

    expect(result.status).toBe('CANCELLED');
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  test('a stranger still gets 403 — idempotency is not an authorisation hole', async () => {
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue(cancelledJourney());
    setupTxCapture();

    await expect(
      cancelJourney('j1', 'c9', CancelReason.CUSTOMER_CHANGED_MIND),
    ).rejects.toMatchObject({ code: 'NOT_JOURNEY_PARTICIPANT' });
  });
});

describe('the per-reason refusals are unchanged', () => {
  test('DRIVER_NO_SHOW on a cancelled journey still refuses with its own error', async () => {
    // Placing the early return AFTER the reason switch is what buys
    // this: that caller did NOT get what they asked for — the
    // attribution they wanted was never made and never can be — so
    // answering "done" would be the wrong sentence.
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue(cancelledJourney());
    setupTxCapture();

    await expect(
      cancelJourney('j1', 'c1', CancelReason.DRIVER_NO_SHOW),
    ).rejects.toMatchObject({ code: 'WRONG_STATE_FOR_NO_SHOW' });
  });

  test('BOTH_NO_SHOW is still system-only, cancelled journey or not', async () => {
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue(cancelledJourney());
    setupTxCapture();

    await expect(
      cancelJourney('j1', 'c1', CancelReason.BOTH_NO_SHOW),
    ).rejects.toMatchObject({ code: 'BOTH_NO_SHOW_IS_SYSTEM_ONLY' });
  });
});

describe('other terminal states still refuse', () => {
  test.each(['COMPLETED', 'EXPIRED'])(
    'a %s journey is not cancelled, and is not told it is',
    async (status) => {
      (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue(
        cancelledJourney({ status }),
      );
      setupTxCapture();

      // transitionJourney still owns this refusal, unchanged.
      await expect(
        cancelJourney('j1', 'c1', CancelReason.CUSTOMER_CHANGED_MIND),
      ).rejects.toThrow();
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    },
  );
});

describe('the first cancel is untouched by all of this', () => {
  test('a REQUESTED journey still cancels, transacts and cleans up', async () => {
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue(
      cancelledJourney({ status: 'REQUESTED', matchedAt: null, escrow: null }),
    );
    const { journeyUpdates } = setupTxCapture();

    const result = await cancelJourney('j1', 'c1', CancelReason.CUSTOMER_CHANGED_MIND);

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(journeyUpdates).toHaveLength(1);
    expect(journeyUpdates[0].data.status).toBe('CANCELLED');
    expect(journeyUpdates[0].data.cancelReason).toBe(CancelReason.CUSTOMER_CHANGED_MIND);
    expect(result.status).toBe('CANCELLED');
    expect(onJourneyExitsRequested).toHaveBeenCalledWith('j1', 'journey-cancelled');
  });
});
