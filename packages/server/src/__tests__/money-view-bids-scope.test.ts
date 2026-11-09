// MONEY-VIEW v2 G2 — the bid rows sealed at every door, the bidder curated
// everywhere he travels.
//
// #206 scoped the rows on ONE route (`GET /journeys/:id/bids`) and its own
// commit message named the reasoning that had let three earlier dispatches
// past: "this list is readable by any authenticated caller". That sentence
// described the defect. This suite covers the two doors #206 did not:
//
//   THE FEED (`GET /api/journeys?viewAs=driver`) — `bids: true`, mapped
//   through a strip that deletes exactly three CONTACT scalars, so raw bid
//   rows rode `...rest` to every motari in radius. It is the same room's
//   WIDER door: `getJourneyById` reaches a motari who opened the request,
//   this reaches everyone in range.
//
//   THE DETAIL's participant branch — every bid row to BOTH participants.
//   The customer owns the auction; the matched driver reading his rivals'
//   prices is #206's defect at another exit.
//
// And N2, which is neither: `driverProfile: true` on the bid rows of both
// journey reads, shipping every bidder's LIVE POSITION and verification
// internals to the customer — while the route built to answer "who is
// bidding on me?" had selected nine curated fields since DRIVER-ID v3.

import * as journeyService from '../services/journey.service';
import {
  CURATED_BIDDER_PROFILE_SELECT,
  CURATED_BIDDER_SELECT,
} from '../services/bidder-view';
import { UserRole } from '@bimoto/shared';

jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    journey: { findUnique: jest.fn(), findMany: jest.fn(), findFirst: jest.fn() },
    user: { findUnique: jest.fn() },
    bid: { findMany: jest.fn() },
    driverProfile: { findUnique: jest.fn() },
    rating: { findUnique: jest.fn() },
    adminAction: { findMany: jest.fn() },
    feeWaiver: { findMany: jest.fn(), findFirst: jest.fn() },
  },
}));

import mockPrisma from '../prisma';

const prismaMock = mockPrisma as unknown as {
  journey: { findUnique: jest.Mock; findMany: jest.Mock; findFirst: jest.Mock };
  driverProfile: { findUnique: jest.Mock };
  rating: { findUnique: jest.Mock };
  adminAction: { findMany: jest.Mock };
  feeWaiver: { findMany: jest.Mock };
};

const CUSTOMER_ID = 'cust-1';
const DRIVER_ID = 'drv-1';
const RIVAL_ID = 'drv-2';

/**
 * Everything on a `DriverProfile` that is NOT a bidder's business — his
 * live position and the internals of his verification.
 */
const PROFILE_INTERNALS = [
  'lastLat',
  'lastLng',
  'lastLocationAt',
  'rejectionReason',
  'revokedAt',
  'verifiedAt',
  'drivingLicenseNumber',
  'drivingLicensePhotoUrl',
  'ruraAuthorizationPhotoUrl',
  'insurancePhotoUrl',
  'screener',
  'isOnline',
];

describe('the curated bidder view', () => {
  it('is the field set getBidsForJourney already applied — one definition', () => {
    // The point of the module is that there is ONE answer. If this list
    // changes, it changes at every door a bidder travels through.
    expect(Object.keys(CURATED_BIDDER_PROFILE_SELECT).sort()).toEqual([
      'avgRating',
      'cooperativeName',
      'insuranceConfirmed',
      'registrationPlate',
      'ruraAuthorizationNumber',
      'totalRides',
      'vehicleDescription',
      'vehicleType',
      'verificationStatus',
    ]);
  });

  it('admits no live position and no verification internal', () => {
    for (const field of PROFILE_INTERNALS) {
      expect(Object.keys(CURATED_BIDDER_PROFILE_SELECT)).not.toContain(field);
    }
  });

  it('carries only who he is beside the profile', () => {
    // `include: { driver: … }` on the customer list arm was returning the
    // bidder's ENTIRE User row.
    expect(Object.keys(CURATED_BIDDER_SELECT).sort()).toEqual([
      'driverProfile',
      'id',
      'nickname',
    ]);
  });
});

describe('the driver FEED no longer carries rival bids', () => {
  beforeEach(() => {
    prismaMock.driverProfile.findUnique.mockReset().mockResolvedValue({
      userId: DRIVER_ID,
      vehicleType: 'MOTO',
      lastLat: -1.95,
      lastLng: 29.87,
      lastLocationAt: new Date(),
    });
    prismaMock.journey.findFirst.mockReset().mockResolvedValue(null);
  });

  function arrangeFeed(row: Record<string, unknown>) {
    prismaMock.journey.findMany.mockReset().mockImplementation(({ where }: any) => {
      if (where?.type === 'URGENT_MESSENGER') return Promise.resolve([]);
      if (where?.type === 'PRIORITY_MESSENGER') return Promise.resolve([]);
      return Promise.resolve([row]);
    });
  }

  const FEED_ROW = {
    id: 'jrn-1',
    customerId: 'someone-else',
    driverId: null,
    status: 'REQUESTED',
    type: 'PASSENGER',
    pickupLat: -1.95,
    pickupLng: 29.87,
    vehiclePreference: null,
    createdAt: new Date(),
    discoveryStartedAt: new Date(),
    customer: { id: 'someone-else', nickname: 'Ange', completedRides: 5 },
    escrow: null,
  };

  it('asks the database only for THIS driver’s bids', async () => {
    arrangeFeed({ ...FEED_ROW, bids: [], _count: { bids: 4 } });
    await journeyService.getJourneys(DRIVER_ID, UserRole.DRIVER, undefined, -1.95, 29.87, 'driver');

    // A rival's price that never leaves the database cannot be the next
    // spread's problem. This asserts the seal at the QUERY, which is the
    // only place it cannot be undone by an edit to the mapper.
    const call = prismaMock.journey.findMany.mock.calls[0][0];
    expect(call.include.bids).toEqual({ where: { driverId: DRIVER_ID } });
    expect(call.include._count).toEqual({ select: { bids: true } });
  });

  it('ships a count and his own bid, and no rival row', async () => {
    const myBid = { id: 'bid-mine', driverId: DRIVER_ID, price: 1800, etaMinutes: 7 };
    arrangeFeed({ ...FEED_ROW, bids: [myBid], _count: { bids: 4 } });

    const [row]: any = await journeyService.getJourneys(
      DRIVER_ID, UserRole.DRIVER, undefined, -1.95, 29.87, 'driver',
    );

    expect(row.bidCount).toBe(4);
    expect(row.myBid).toEqual(myBid);
    // The raw array is gone as a KEY, not merely empty: an empty `bids`
    // would still be a place for the next change to leak into.
    expect(Object.keys(row)).not.toContain('bids');
    expect(Object.keys(row)).not.toContain('_count');
  });

  it('says zero and null when he has not bid', async () => {
    arrangeFeed({ ...FEED_ROW, bids: [], _count: { bids: 0 } });
    const [row]: any = await journeyService.getJourneys(
      DRIVER_ID, UserRole.DRIVER, undefined, -1.95, 29.87, 'driver',
    );
    expect(row.bidCount).toBe(0);
    expect(row.myBid).toBeNull();
  });

  it("carries no rival's price even when rival rows reach the mapper", async () => {
    // TWO SEALS, PROVED SEPARATELY. The test above proves the QUERY asks
    // only for his own rows. This one hands the mapper a rival row anyway
    // — as an un-narrowed query would — and proves the mapper still does
    // not ship it. Either seal alone would let a future edit re-open the
    // door; the negative is written against the whole serialized object
    // rather than a key list, so a new field cannot re-open it quietly.
    arrangeFeed({
      ...FEED_ROW,
      bids: [{ id: 'bid-rival', driverId: RIVAL_ID, price: 9999, etaMinutes: 3 }],
      _count: { bids: 3 },
    });
    const [row]: any = await journeyService.getJourneys(
      DRIVER_ID, UserRole.DRIVER, undefined, -1.95, 29.87, 'driver',
    );
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain(RIVAL_ID);
    expect(serialized).not.toContain('9999');
    expect(serialized).not.toContain('bid-rival');
    expect(row.bidCount).toBe(3);
  });

  it('keeps the PROTECTED contact floor exactly where it was', async () => {
    // PARCEL-VISIBLE invariant 2 — that list may only grow. Sealing the
    // bids must not have moved it.
    arrangeFeed({
      ...FEED_ROW,
      bids: [],
      _count: { bids: 0 },
      recipientName: 'Uwimana Claudine',
      recipientPhone: '+250788555777',
      childGuardianPhone: '+250788555888',
      goodsSizeCategory: 'MEDIUM',
    });
    const [row]: any = await journeyService.getJourneys(
      DRIVER_ID, UserRole.DRIVER, undefined, -1.95, 29.87, 'driver',
    );
    for (const field of journeyService.PROTECTED_JOURNEY_FIELDS_PRE_MATCH) {
      expect(Object.keys(row)).not.toContain(field);
    }
    // And the strip still does not over-reach.
    expect(row.goodsSizeCategory).toBe('MEDIUM');
  });
});

describe('the DETAIL scopes bid rows to the viewer', () => {
  const BASE = { customerId: CUSTOMER_ID, driverId: DRIVER_ID, status: 'MATCHED' };

  function arrangeDetail() {
    prismaMock.journey.findUnique
      .mockReset()
      .mockResolvedValueOnce(BASE)
      .mockResolvedValueOnce({
        id: 'jrn-1',
        ...BASE,
        agreedPrice: null,
        escrow: null,
        messages: [],
        bids: [],
        legs: [],
        customer: { id: CUSTOMER_ID, nickname: 'Ange', completedRides: 25 },
        driver: { id: DRIVER_ID, nickname: 'Jean', driverProfile: { totalRides: 40 } },
      });
    prismaMock.rating.findUnique.mockReset().mockResolvedValue(null);
    prismaMock.driverProfile.findUnique.mockReset().mockResolvedValue({ totalRides: 40 });
    prismaMock.feeWaiver.findMany.mockReset().mockResolvedValue([]);
  }

  it('gives the CUSTOMER every row — the whole list is her decision', async () => {
    arrangeDetail();
    await journeyService.getJourneyById('jrn-1', CUSTOMER_ID);
    const include = prismaMock.journey.findUnique.mock.calls[1][0].include;
    expect(include.bids.where).toBeUndefined();
  });

  it('gives a DRIVER participant his own row only', async () => {
    arrangeDetail();
    await journeyService.getJourneyById('jrn-1', DRIVER_ID);
    const include = prismaMock.journey.findUnique.mock.calls[1][0].include;
    // Filtered at the query — the matched motari never receives a rival's
    // price, which in a sealed-bid marketplace IS the bid.
    expect(include.bids.where).toEqual({ driverId: DRIVER_ID });
  });

  it('leaves a privileged caller the whole list', async () => {
    arrangeDetail();
    await journeyService.getJourneyById('jrn-1');
    const include = prismaMock.journey.findUnique.mock.calls[1][0].include;
    expect(include.bids.where).toBeUndefined();
  });

  it('curates every bidder profile it returns, and the matched driver too', async () => {
    arrangeDetail();
    await journeyService.getJourneyById('jrn-1', CUSTOMER_ID);
    const include = prismaMock.journey.findUnique.mock.calls[1][0].include;

    // The bid rows' bidder…
    expect(include.bids.include.driver.select).toBe(CURATED_BIDDER_SELECT);
    // …and the matched driver, who is not a bid row and is the same room.
    expect(include.driver.select).toBe(CURATED_BIDDER_SELECT);
    // Never the raw row again.
    expect(include.bids.include.driver.include).toBeUndefined();
    expect(include.driver.include).toBeUndefined();
  });
});

describe('the customer LIST arm curates its bidders', () => {
  it('selects the bidder rather than including his whole User row', async () => {
    prismaMock.journey.findMany.mockReset().mockResolvedValue([]);
    prismaMock.adminAction.findMany.mockReset().mockResolvedValue([]);
    await journeyService.getJourneys(CUSTOMER_ID, UserRole.CUSTOMER);

    const include = prismaMock.journey.findMany.mock.calls[0][0].include;
    expect(include.bids.include.driver.select).toBe(CURATED_BIDDER_SELECT);
    expect(include.bids.include.driver.include).toBeUndefined();
  });
});
