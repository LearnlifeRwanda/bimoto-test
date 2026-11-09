// CUTGUARD v2 G6 (B-2) — the savings preview, scoped to clients that can
// draw it, and the compatibility contract that would have caught it.
//
// THE DEFECT. #207 gave the customer a `commissionBreakdown` on the bid
// list — the customer-safe four. A v13 BidListPage reads
// `totalCommissionAmount.toLocaleString()` off that object, and the
// customer-safe shape does not carry that key. So the payload that fixed
// one thing crashed the confirm dialog of every phone that had not
// updated yet, on the screen where she is about to pay.
//
// The gate is one half. The other half is the last describe block: a
// contract test over the fields a SHIPPED client depends on, which is the
// shape of test that would have caught B-2 before it shipped rather than
// after a passenger's screen went white.

import { JourneyStatus, BidStatus } from '@bimoto/shared';

jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    journey: { findUnique: jest.fn() },
    bid: { findMany: jest.fn() },
    user: { findUnique: jest.fn() },
    driverProfile: { findUnique: jest.fn() },
    vehicleChangeLog: { findMany: jest.fn().mockResolvedValue([]) },
    feeWaiver: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
  },
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

const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const CUSTOMER = 'c1';

function primeBidList() {
  (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue({
    id: 'j1',
    customerId: CUSTOMER,
    status: JourneyStatus.REQUESTED,
  });
  (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
    id: CUSTOMER,
    completedRides: 30,
  });
  (mockPrisma.bid.findMany as jest.Mock).mockResolvedValue([
    {
      id: 'b1',
      journeyId: 'j1',
      driverId: 'd1',
      price: 2000,
      etaMinutes: 5,
      status: BidStatus.PENDING,
      createdAt: new Date(),
      updatedAt: new Date(),
      driver: {
        nickname: 'Jean',
        driverProfile: {
          avgRating: 4.5,
          totalRides: 200,
          vehicleType: 'MOTO',
          vehicleDescription: 'Honda',
          verificationStatus: 'VERIFIED',
        },
      },
    },
  ]);
}

beforeEach(() => {
  jest.clearAllMocks();
  primeBidList();
});

describe('B-2 — the savings preview is scoped by client generation', () => {
  test('v14: the customer gets the customer-safe four', async () => {
    const bids = await bidService.getBidsForJourney('j1', CUSTOMER, {
      customerSavingsPreview: true,
    });
    const breakdown = (bids[0] as { commissionBreakdown?: unknown }).commissionBreakdown as
      | Record<string, unknown>
      | undefined;
    expect(breakdown).toBeDefined();
    expect(Object.keys(breakdown!).sort()).toEqual([
      'bidPrice',
      'customerSavings',
      'customerTier',
      'feeWaiverApplied',
    ]);
  });

  test('legacy: the key is ABSENT, not null — the shape v13 copes with', async () => {
    // Absent rather than null on purpose. #207's own note says the key is
    // OMITTED for a viewer who may not have it, because a null is still a
    // place for the next change to leak into — and, for B-2 specifically,
    // a v13 client guards on presence.
    const bids = await bidService.getBidsForJourney('j1', CUSTOMER, {
      customerSavingsPreview: false,
    });
    expect(Object.prototype.hasOwnProperty.call(bids[0], 'commissionBreakdown')).toBe(false);
  });

  test('the DEFAULT is legacy — a caller that does not say gets the safe shape', async () => {
    // This is what makes the socket path (getBidViewForCustomer, which has
    // no request and therefore no header) safe by construction rather
    // than by somebody remembering.
    const bids = await bidService.getBidsForJourney('j1', CUSTOMER);
    expect(Object.prototype.hasOwnProperty.call(bids[0], 'commissionBreakdown')).toBe(false);
  });

  test('the gate never touches the DRIVER arm', async () => {
    // The version gate narrows by CLIENT, not by viewer: a motari reading
    // his own bid gets his full ladder at every version, because his v13
    // build has always rendered it.
    const bids = await bidService.getBidsForJourney('j1', 'd1', {
      customerSavingsPreview: false,
    });
    const breakdown = (bids[0] as { commissionBreakdown?: Record<string, unknown> })
      .commissionBreakdown;
    expect(breakdown).toBeDefined();
    expect(breakdown).toHaveProperty('driverPayout');
  });
});

/* ================================================ the compatibility ratchet */

describe('the response-compatibility contract', () => {
  // WHAT THIS IS. A record of the fields a SHIPPED client reads off each
  // payload. The rule it enforces is one-directional:
  //
  //     a client-facing response may GROW optional fields;
  //     it may not remove a depended-on field, and it may not start
  //     sending a field a shipped client would choke on.
  //
  // B-2 was the second half. #207 did not remove anything — it ADDED
  // `commissionBreakdown` to the customer's bid rows, in a shape v13's
  // renderer could not survive. A test that asked "what does the shipped
  // client read off this object, and does what we send satisfy it?" would
  // have said so before the passenger's screen did.
  //
  // ITS BLIND SPOT, stated because a contract test that oversells itself
  // is worse than none: this pins the payloads NAMED here, against the
  // dependencies WRITTEN here. It cannot discover a field a client reads
  // that nobody recorded, and it cannot see the client's renderer. It is
  // a ratchet on known contracts, not a proof of compatibility — the
  // honest complement is that when a client dependency is found the hard
  // way, it gets added here so it is never found the hard way twice.

  /** Fields v13's BidListPage dereferences on a customer bid row. */
  const V13_CUSTOMER_BID_FIELDS = ['id', 'price', 'etaMinutes', 'status', 'driver'];

  /**
   * Fields v13 dereferences on `commissionBreakdown` IF the key is
   * present. This is the B-2 list: the v13 renderer reads these
   * unconditionally once the object exists, so sending an object without
   * them is a crash.
   */
  const V13_BREAKDOWN_FIELDS_IF_PRESENT = ['totalCommissionRate', 'totalCommissionAmount'];

  test('a legacy customer bid row still carries everything v13 reads', async () => {
    const bids = await bidService.getBidsForJourney('j1', CUSTOMER, {
      customerSavingsPreview: false,
    });
    for (const field of V13_CUSTOMER_BID_FIELDS) {
      expect(Object.prototype.hasOwnProperty.call(bids[0], field)).toBe(true);
    }
  });

  test('B-2 itself: v13 must not receive a breakdown it cannot render', async () => {
    // The assertion that would have caught it. If a future change starts
    // sending a customer breakdown to a legacy client, this fails unless
    // that breakdown satisfies what v13 reads off it.
    const bids = await bidService.getBidsForJourney('j1', CUSTOMER, {
      customerSavingsPreview: false,
    });
    const breakdown = (bids[0] as { commissionBreakdown?: Record<string, unknown> })
      .commissionBreakdown;

    if (breakdown !== undefined) {
      for (const field of V13_BREAKDOWN_FIELDS_IF_PRESENT) {
        expect(Object.prototype.hasOwnProperty.call(breakdown, field)).toBe(true);
      }
    } else {
      expect(breakdown).toBeUndefined();
    }
  });

  test('and the v14 payload is ADDITIVE over the legacy one', async () => {
    // The other direction of the same rule: turning the gate on may only
    // add keys. A v14 client that lost a field it depends on would be the
    // mirror-image defect.
    const legacy = await bidService.getBidsForJourney('j1', CUSTOMER, {
      customerSavingsPreview: false,
    });
    const current = await bidService.getBidsForJourney('j1', CUSTOMER, {
      customerSavingsPreview: true,
    });

    const legacyKeys = Object.keys(legacy[0]);
    const currentKeys = new Set(Object.keys(current[0]));
    const lost = legacyKeys.filter((k) => !currentKeys.has(k));
    expect(lost).toEqual([]);

    const added = [...currentKeys].filter((k) => !legacyKeys.includes(k));
    expect(added).toEqual(['commissionBreakdown']);
  });
});
