// CUTGUARD v2 G3 (U-4) — what the passenger receives when she accepts.
//
// #202 removed `driverPayout` from the commission breakdown. #207 scoped
// the bid LIST. Neither touched the accept RESULT, which built its own
// thirteen-key object and handed her the motari's full settlement — the
// exact number two dispatches had been spent removing, arriving by a
// third door.
//
// The assertion is set-equality on the key set, not "driverPayout is
// absent". Absence-of-one-key is the assertion that would have passed
// while `totalCommissionAmount` shipped — and price minus that IS the
// payout. The four are the four, and anything else fails.

import { JourneyStatus, BidStatus } from '@bimoto/shared';

jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    journey: {
      findUnique: jest.fn(),
      update: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    bid: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    driverProfile: { findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
    leg: { findMany: jest.fn().mockResolvedValue([]) },
    feeWaiver: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
    $transaction: jest.fn(),
  },
}));

jest.mock('../services/escrow.service', () => ({
  createEscrow: jest.fn().mockResolvedValue({}),
  createEscrowTx: jest
    .fn()
    .mockResolvedValue({ id: 'esc-1', txRef: 'ref-1', status: 'PENDING', amount: 2000 }),
}));

jest.mock('../config', () => ({
  config: {
    SKIP_DRIVER_VERIFICATION: true,
    DATABASE_URL: 'test',
    JWT_SECRET: 'test-jwt-secret-at-least-16-chars',
    JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-16-chars',
    ENCRYPTION_KEY: 'a'.repeat(64),
    PORT: 3000,
    CLIENT_URL: 'http://localhost:5173',
    NODE_ENV: 'test',
  },
}));

import prisma from '../prisma';
import * as bidService from '../services/bid.service';
import { toCustomerSafeCommission, toFullCommissionBreakdown } from '../services/commission-view';
// CUTGUARD v2 G4 — the actor is now a TYPE (services/session-actor.ts).
// A test stands in for a session, so it says so with an explicit cast at
// the call rather than passing a bare string, which is what made the
// tautology writable in the first place.
import { customerActor, type SessionUserId } from '../services/session-actor';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

/** Exactly what a customer may see. */
const CUSTOMER_SAFE_KEYS = ['bidPrice', 'customerTier', 'customerSavings', 'feeWaiverApplied'];

/** The keys that were on the accept result and must not be. */
const WITHHELD = [
  'driverPayout',
  'driverTier',
  'driverCommissionRate',
  'driverSavings',
  // Not "driver" keys by name, and every bit as damaging: price minus
  // either of these IS the payout.
  'totalCommissionAmount',
  'totalCommissionRate',
  'customerCommissionRate',
  'chargedCommissionAmount',
  'waivedCommissionAmount',
];

function primeAcceptPath() {
  (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue({
    id: 'j1',
    customerId: 'c1',
    status: JourneyStatus.REQUESTED,
  });
  (mockPrisma.bid.findUnique as jest.Mock).mockResolvedValue({
    id: 'b1',
    journeyId: 'j1',
    driverId: 'd1',
    price: 2000,
    status: BidStatus.PENDING,
  });
  (mockPrisma.driverProfile.findUnique as jest.Mock).mockResolvedValue({
    userId: 'd1',
    totalRides: 20,
  });
  (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
    id: 'c1',
    completedRides: 5,
    nickname: 'Ineza',
    language: 'rw',
  });
  (mockPrisma.$transaction as jest.Mock).mockImplementation(async (fn: Function) =>
    fn({
      escrow: { findUnique: jest.fn().mockResolvedValue(null) },
      bid: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({ id: 'b1', status: BidStatus.ACCEPTED }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      journey: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({
          id: 'j1',
          status: JourneyStatus.MATCHED,
          driverId: 'd1',
          agreedPrice: 2000,
        }),
      },
    }),
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  primeAcceptPath();
});

/**
 * CUTGUARD v2 amendment 2 — B-2's FOURTH instance, and the one this
 * dispatch nearly attested away.
 *
 * The reasoning that said the accept path was safe went: v13's
 * BidListPage sources its confirm-dialog breakdown from the bid ROW, not
 * from the accept response, and the bid row is gated. Both halves are
 * true and the conclusion is still wrong, because the accept response
 * does not have to be READ to be rendered — v13 does
 * `setActiveJourney(updated)` with this exact body and navigates to
 * MatchedPage, which draws whatever is in that store.
 *
 * It is usually masked: MatchedPage returns a spinner until its own
 * `GET /journeys/:id` resolves and overwrites the store. But that fetch
 * clears `isLoading` in a `finally`, so when it FAILS the page renders
 * THIS payload — and dereferences `totalCommissionAmount`,
 * `totalCommissionRate` and `driverPayout`, none of which a customer-safe
 * projection carries or may carry.
 *
 * So these tests say which generation they are asking as, and the gate
 * has both its directions pinned below.
 */
const V14 = { customerSavingsPreview: true } as const;

describe('POST /accept-bid — the passenger’s commission view', () => {
  test('acceptBid answers with EXACTLY the customer-safe four', async () => {
    const result = (await bidService.acceptBid('j1', customerActor('c1' as SessionUserId), 'b1', V14)) as any;
    expect(Object.keys(result.commissionBreakdown).sort()).toEqual(
      [...CUSTOMER_SAFE_KEYS].sort(),
    );
  });

  test('acceptBid withholds every key that narrows to the motari’s net', async () => {
    const result = (await bidService.acceptBid('j1', customerActor('c1' as SessionUserId), 'b1', V14)) as any;
    for (const key of WITHHELD) {
      expect(Object.prototype.hasOwnProperty.call(result.commissionBreakdown, key)).toBe(false);
    }
  });

  test('acceptBidForCard — the same exit, the same audience, the same four', async () => {
    const result = (await bidService.acceptBidForCard('j1', customerActor('c1' as SessionUserId), 'b1', V14)) as any;
    expect(Object.keys(result.commissionBreakdown).sort()).toEqual(
      [...CUSTOMER_SAFE_KEYS].sort(),
    );
    for (const key of WITHHELD) {
      expect(Object.prototype.hasOwnProperty.call(result.commissionBreakdown, key)).toBe(false);
    }
  });

  test('what she DOES get is still true and still hers', async () => {
    // The redaction is not a blanking. Her own tier and what it saved her
    // are her money, computed from the ladder she is on.
    const result = (await bidService.acceptBid('j1', customerActor('c1' as SessionUserId), 'b1', V14)) as any;
    expect(result.commissionBreakdown.bidPrice).toBe(2000);
    expect(typeof result.commissionBreakdown.customerTier).toBe('string');
    expect(typeof result.commissionBreakdown.customerSavings).toBe('number');
    expect(result.commissionBreakdown.feeWaiverApplied).toBe(false);
  });
});

/* ------------------------------------------------------------ red-proof --- */

describe('the pre-fix shape is what the projector removes', () => {
  test('the driver ladder the accept path used to answer with carries all nine', () => {
    // Built by the same driver projector acceptBidCore uses, so this is
    // literally the object the passenger used to receive. If this ever
    // stops carrying them, the assertions above are measuring nothing.
    const full = toFullCommissionBreakdown({
      bidPrice: 2000,
      commission: {
        driverTier: { tier: 'PRO' },
        driverCommissionRate: 0.025,
        customerTier: { tier: 'SUPER' },
        customerCommissionRate: 0.025,
        totalCommissionRate: 0.05,
        totalCommissionAmount: 100,
        customerSavings: 50,
        driverSavings: 50,
      },
      waiver: { effectiveDriverPayout: 1900, waiverId: null, charged: 100, waived: 0 },
    });
    for (const key of WITHHELD) {
      expect(Object.prototype.hasOwnProperty.call(full, key)).toBe(true);
    }
    expect(full.driverPayout).toBe(1900);

    // And the projector takes the same object down to the four — the
    // extra keys are DROPPED, not merely left unread by the client.
    const safe = toCustomerSafeCommission(full);
    expect(Object.keys(safe).sort()).toEqual([...CUSTOMER_SAFE_KEYS].sort());
  });

  test('price minus totalCommissionAmount IS the payout — why that key is withheld too', () => {
    // The arithmetic that makes "just remove driverPayout" insufficient.
    expect(2000 - 100).toBe(1900);
  });
});

/* ------------------------------------------------- the version gate --- */

/**
 * B-2's fourth instance, pinned from both sides.
 *
 * `respondToCounter` reaches `acceptBid` too — a DRIVER accepting the
 * passenger's counter-offer — and deliberately does not pass the option:
 * that request says nothing about HER phone, which is the one the
 * journey-room fan-out reaches. Absent ⇒ legacy is what makes that
 * correct without anybody having to remember it, so the default is
 * asserted here rather than assumed.
 */
describe('the accept-path preview is gated by CLIENT generation', () => {
  test('legacy: the key is OMITTED — not null, absent', async () => {
    const result = (await bidService.acceptBid(
      'j1',
      customerActor('c1' as SessionUserId),
      'b1',
    )) as any;

    expect(Object.prototype.hasOwnProperty.call(result, 'commissionBreakdown')).toBe(false);
    expect(result.commissionBreakdown).toBeUndefined();
  });

  test('legacy: everything a v13 BidListPage needs off this response is still here', async () => {
    // The gate withholds the preview and nothing else. These are the
    // fields da9eca0's accept handler actually reads before navigating —
    // the escrow-failure retry surface (PAY-TRUTH G3) and the match.
    const result = (await bidService.acceptBid(
      'j1',
      customerActor('c1' as SessionUserId),
      'b1',
    )) as any;

    expect(result.escrowStatus).toBeDefined();
    expect(result.escrowId).toBeDefined();
    expect(result.escrowTxRef).toBeDefined();
    expect(result.escrowAmount).toBeDefined();
    expect(Object.prototype.hasOwnProperty.call(result, 'paymentFailureCode')).toBe(true);
  });

  test('legacy: the card sibling omits it too, and keeps its checkout', async () => {
    const result = (await bidService.acceptBidForCard(
      'j1',
      customerActor('c1' as SessionUserId),
      'b1',
    )) as any;

    expect(Object.prototype.hasOwnProperty.call(result, 'commissionBreakdown')).toBe(false);
    // The thing the card widget cannot start without.
    expect(result.cardCheckout.escrowId).toBeDefined();
    expect(result.cardCheckout.txRef).toBeDefined();
    expect(result.cardCheckout.amount).toBe(2000);
    expect(result.paymentMethod).toBe('card');
  });

  test('DEFAULT is legacy — an option object with other keys still withholds', async () => {
    // The safe-by-default direction, asserted against the shape a caller
    // actually passes. `acknowledgeConflict` alone must not smuggle the
    // preview in by being truthy somewhere.
    const result = (await bidService.acceptBid('j1', customerActor('c1' as SessionUserId), 'b1', {
      acknowledgeConflict: true,
    })) as any;

    expect(Object.prototype.hasOwnProperty.call(result, 'commissionBreakdown')).toBe(false);
  });

  test('v14: the same call, asked as current, carries exactly the four', async () => {
    const result = (await bidService.acceptBid(
      'j1',
      customerActor('c1' as SessionUserId),
      'b1',
      V14,
    )) as any;

    expect(Object.keys(result.commissionBreakdown).sort()).toEqual([...CUSTOMER_SAFE_KEYS].sort());
    // And claiming a version can only ever get you LESS: the four, never
    // a fifth key. The header is a compatibility signal, not an
    // authorization one.
    for (const key of WITHHELD) {
      expect(Object.prototype.hasOwnProperty.call(result.commissionBreakdown, key)).toBe(false);
    }
  });
});
