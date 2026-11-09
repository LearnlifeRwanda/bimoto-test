// PILOT-GUARD Item 1 — the lockout becomes what the policy says.
//
// Three cancelled SCHEDULED rides in seven days used to end a
// passenger's use of Bimoto. The reputation path set User.isFlagged
// with no reason; createJourney 403'd EVERY subsequent booking with
// `errors.accountFlagged`, a key that exists in none of the three
// locale files, so the presenter fell through to the generic "not
// accepted" (lib/api-error-presenter.ts, REJECTED branch). No AmlFlag
// row was written, so the appeal queue — which selects CRITICAL OPEN
// AmlFlags (conflict-resolver/conflicts/aml-appeal.ts) — never saw it.
// The account was locked out, silently, permanently, with no route back.
//
// middleware/auth.ts:81-91 states the design this now implements:
//
//   "Note: User.isFlagged (from Dispatch C's AML detection) is NOT a
//    blocking condition at this layer. Flagged users continue to use
//    the app while admin reviews their case (silence-equals-consent +
//    admin-in-loop design). Only User.frozenAt (set by an explicit
//    admin freeze action via Dispatch H) blocks at auth.
//
//    If you ever need to block flagged users at auth (e.g. regulator
//    requirement), add the check below this comment — but expect
//    business pushback because flag→automatic-block-without-review is
//    the surveillance-creep failure mode the project explicitly
//    avoided."
//
// Each test below is written to FAIL at a3cebe7 and pass after. The
// failing shape is named in each test's comment so the pairing is
// checkable rather than asserted.

import { JourneyStatus } from '@bimoto/shared';

jest.mock('../prisma', () => {
  const journeyCreate = jest.fn();
  const db: any = {
    journey: { create: journeyCreate, count: jest.fn(), findFirst: jest.fn() },
    user: { findUnique: jest.fn(), update: jest.fn() },
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

import prisma from '../prisma';
import * as journeyService from '../services/journey.service';
import {
  bumpScheduledCancellationCount,
  SCHEDULED_CANCEL_FLAG_THRESHOLD,
  SCHEDULED_CANCEL_WINDOW_DAYS,
} from '../services/scheduled-rides/cancellation-reputation';

// The reason code is asserted as a LITERAL, and the returned shape is
// read through a loose alias, so this file compiles unchanged against
// a3cebe7 and fails on its assertions rather than on `tsc`. That is what
// makes the both-ways run a proof about behaviour.
const EXPECTED_FLAG_REASON = 'SCHEDULED_CANCELLATIONS_3_IN_7D';
type BumpResult = Record<string, unknown>;

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

beforeEach(() => jest.clearAllMocks());

describe('PILOT-GUARD Item 1 — a flag flags; it does not block', () => {
  // BEFORE: `data: { isFlagged: true }` — no reason written, so the row
  // reached /admin/flagged carrying nothing an admin could review.
  test('the third scheduled cancellation in the window flags WITH a reason', async () => {
    (mockPrisma.user.update as jest.Mock).mockResolvedValue({ scheduledCancellationCount: 2 });
    (mockPrisma.journey.count as jest.Mock).mockResolvedValue(SCHEDULED_CANCEL_FLAG_THRESHOLD);

    const result: BumpResult = await bumpScheduledCancellationCount('u1');

    expect(result.isFlagged).toBe(true);
    expect(result.flagReason).toBe(EXPECTED_FLAG_REASON);

    const flagWrite = (mockPrisma.user.update as jest.Mock).mock.calls[1][0];
    expect(flagWrite.data).toEqual({
      isFlagged: true,
      flagReason: EXPECTED_FLAG_REASON,
    });
  });

  // BEFORE: `newCount` was User.scheduledCancellationCount — a LIFETIME
  // tally bumped only on customer-initiated cancels — while the flag was
  // decided by a rolling count of every CANCELLED SCHEDULED journey in
  // the window. A caller pairing newCount with threshold read "2 of 3"
  // on the very call that flagged the account.
  test('the reported count is the count the decision used', async () => {
    (mockPrisma.user.update as jest.Mock).mockResolvedValue({ scheduledCancellationCount: 2 });
    (mockPrisma.journey.count as jest.Mock).mockResolvedValue(3);

    const result: BumpResult = await bumpScheduledCancellationCount('u1');

    expect(result.newCount).toBe(3);
    expect(result.newCount as number).toBeGreaterThanOrEqual(result.threshold as number);
    expect(result.isFlagged).toBe(true);
    // The lifetime tally is still available, under a name that says so.
    expect(result.lifetimeCount).toBe(2);

    const countQuery = (mockPrisma.journey.count as jest.Mock).mock.calls[0][0];
    expect(countQuery.where.bookingMode).toBe('SCHEDULED');
    expect(countQuery.where.status).toBe('CANCELLED');
    expect(SCHEDULED_CANCEL_WINDOW_DAYS).toBe(7);
  });

  test('a cancellation under the threshold flags nothing and records no reason', async () => {
    (mockPrisma.user.update as jest.Mock).mockResolvedValue({ scheduledCancellationCount: 1 });
    (mockPrisma.journey.count as jest.Mock).mockResolvedValue(1);

    const result: BumpResult = await bumpScheduledCancellationCount('u1');

    expect(result.isFlagged).toBe(false);
    expect(result.flagReason).toBeNull();
    expect(mockPrisma.user.update).toHaveBeenCalledTimes(1);
  });

  // BEFORE: this rejected with `errors.accountFlagged` — a 403 on EVERY
  // booking, forever, with no appeal row and no rendered message.
  test('a flagged customer can still book — the flag does not 403 the ride', async () => {
    const created = {
      id: 'j1',
      customerId: 'c1',
      status: JourneyStatus.REQUESTED,
      type: 'PASSENGER',
    };
    (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: 'c1',
      isFlagged: true,
      flagReason: EXPECTED_FLAG_REASON,
    });
    (mockPrisma.journey.create as jest.Mock).mockResolvedValue(created);
    (mockPrisma.user.update as jest.Mock).mockResolvedValue({});

    const result = await journeyService.createJourney('c1', {
      type: 'PASSENGER' as any,
      pickupLat: -1.95,
      pickupLng: 29.87,
      pickupName: 'Kigali Heights',
      destinationLat: -1.96,
      destinationLng: 29.88,
      destinationName: 'Kimironko Market',
      goodsFragile: false,
    });

    expect(result.status).toBe(JourneyStatus.REQUESTED);
    expect(mockPrisma.journey.create).toHaveBeenCalledTimes(1);
  });

  // The behaviour that DOES still block is unchanged and lives one layer
  // up: middleware/auth.ts refuses a frozen account (ACCOUNT_FROZEN)
  // before any route runs. createJourney never had, and still has not,
  // any part in that.
  test('the flag refusal is gone from the service entirely', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../services/journey.service.ts'),
      'utf8',
    );
    // `throw new AppError(403, 'ACCOUNT_FLAGGED', 'errors.accountFlagged')`
    // was the only occurrence of this code in the file, and the only
    // thrower of that key in the server. Freezing is untouched and still
    // blocks — one layer up, in middleware/auth.ts, where it always did.
    expect(src).not.toMatch(/ACCOUNT_FLAGGED/);
    expect(src).not.toMatch(/errors\.accountFlagged/);
  });
});
