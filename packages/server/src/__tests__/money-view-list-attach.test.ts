// MONEY-VIEW v2 G3 — the rides list stops being dead about money.
//
// `GET /api/journeys` has never attached a `commissionBreakdown`: there is
// no such column on `Journey` and the route computed nothing. HistoryPage
// has carried two guarded money blocks since D7/C6 that read exactly that
// key, so both rendered for nobody. CLEAN-SWEEP G1 guarded them anyway
// (the guard's job is to make the shape safe, not to bet on which shapes
// arrive) and recorded them as dead. This is what makes them live.
//
// DERIVED, NOT RECOMPUTED, and that is the load-bearing decision.
// `calculateCommission` off today's tier counts would answer for the
// rider a customer IS rather than the one she WAS when the ride settled —
// a passenger crossing the 20-ride threshold would watch her own history
// rewrite itself, and the list would disagree with the receipt. The
// escrow row is the settlement record: it stores the rates and tiers that
// were APPLIED and the payout that was CREDITED.
//
// So the fixtures below deliberately set the escrow's stored tier to one
// the customer's CURRENT ride count would not produce. A recomputing
// implementation passes every other assertion here and fails those.

import * as journeyService from '../services/journey.service';
import { UserRole } from '@bimoto/shared';

jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    journey: { findMany: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn() },
    driverProfile: { findUnique: jest.fn() },
    adminAction: { findMany: jest.fn() },
  },
}));

import mockPrisma from '../prisma';

const prismaMock = mockPrisma as unknown as {
  journey: { findMany: jest.Mock; findFirst: jest.Mock };
  driverProfile: { findUnique: jest.Mock };
  adminAction: { findMany: jest.Mock };
};

const CUSTOMER_ID = 'cust-1';
const DRIVER_ID = 'drv-1';

/**
 * CUTGUARD v2 amendment 2 — every assertion below about what she IS
 * shown is an assertion about a CURRENT client, so it says so.
 *
 * This matters most for the assertions about what she is NOT shown. With
 * the gate off, `commissionBreakdown` is absent for every reason at once,
 * and "attaches NOTHING when there is no escrow" would pass on a build
 * that had deleted the attach entirely. Asking as v14 is what keeps those
 * tests about the escrow rather than about the gate. The legacy direction
 * has its own describe at the bottom.
 */
function customerRows(options: { customerSavingsPreview?: boolean } = { customerSavingsPreview: true }) {
  return journeyService.getJourneys(
    CUSTOMER_ID,
    UserRole.CUSTOMER,
    undefined,
    undefined,
    undefined,
    undefined,
    false,
    options,
  );
}

/**
 * A settled ride. `customerCommissionRate` 0.035 is the FREQUENT rate and
 * `customerTier` says FREQUENT — but this customer has 4 completed rides
 * today, which is REGULAR at 0.05. Recomputing would answer REGULAR and
 * a saving of 0; the settlement says FREQUENT and 30.
 */
const SETTLED_ESCROW = {
  id: 'esc-1',
  amount: 2000,
  commission: 140,
  driverPayout: 1860,
  status: 'RELEASED',
  releasedAt: new Date('2026-07-20T11:00:00Z'),
  driverTier: 'REGULAR',
  customerTier: 'FREQUENT',
  driverCommissionRate: 0.035,
  customerCommissionRate: 0.035,
  waivedCommissionAmount: null,
  feeWaiverId: null,
  txRef: 'bimoto-tx-abc123',
  flwTxId: '99887766',
};

/** One settled customer row. Module-scoped: the gate describe uses it too. */
function arrange(escrow: unknown) {
  prismaMock.journey.findMany.mockReset().mockResolvedValue([
    {
      id: 'j1',
      customerId: CUSTOMER_ID,
      status: 'COMPLETED',
      agreedPrice: 2000,
      cancelReason: null,
      bids: [],
      escrow,
    },
  ]);
}

describe('the customer list arm attaches the customer-safe four', () => {
  beforeEach(() => {
    prismaMock.adminAction.findMany.mockReset().mockResolvedValue([]);
  });


  it('derives the four from the settlement record', async () => {
    arrange(SETTLED_ESCROW);
    const [row]: any = await customerRows();

    expect(row.commissionBreakdown).toEqual({
      bidPrice: 2000,
      // THE DERIVATION PIN. Recomputing from today's ride count gives
      // REGULAR/0; the settlement gives FREQUENT/30.
      customerTier: 'FREQUENT',
      // round(2000 x (0.05 baseline − 0.035 applied)) = 30
      customerSavings: 30,
      feeWaiverApplied: false,
    });
  });

  it('carries nothing of the motari, on the row or in the escrow beside it', async () => {
    arrange(SETTLED_ESCROW);
    const [row]: any = await customerRows();

    const serialized = JSON.stringify(row);
    for (const key of [
      'driverPayout',
      'driverTier',
      'driverCommissionRate',
      'driverSavings',
      'totalCommissionAmount',
      'totalCommissionRate',
      'txRef',
      'flwTxId',
    ]) {
      expect(serialized).not.toContain(key);
    }
    expect(serialized).not.toContain('1860');
    expect(serialized).not.toContain('bimoto-tx-abc123');
    // What she IS entitled to is still on the row.
    expect(row.escrow.amount).toBe(2000);
    expect(row.escrow.status).toBe('RELEASED');
  });

  it('reports a waiver as a boolean and keeps the amount off the row', async () => {
    arrange({
      ...SETTLED_ESCROW,
      commission: 0,
      driverPayout: 2000,
      waivedCommissionAmount: 140,
      feeWaiverId: 'waiver-7',
    });
    const [row]: any = await customerRows();

    expect(row.commissionBreakdown.feeWaiverApplied).toBe(true);
    // On a waived ride the waived amount IS the nominal commission, so
    // publishing it hands back payout = amount − waived.
    expect(JSON.stringify(row)).not.toContain('140');
  });

  it('attaches NOTHING when there is no escrow', async () => {
    arrange(null);
    const [row]: any = await customerRows();
    // The key is omitted, not nulled — shape 3 in commission-view's
    // taxonomy, which every screen already handles.
    expect(Object.keys(row)).not.toContain('commissionBreakdown');
    expect(row.escrow).toBeNull();
  });

  it('attaches NOTHING when the escrow predates the tier columns', async () => {
    // All four are nullable — they were added after the model — so a
    // legacy row cannot be derived from and must not be half-rendered.
    arrange({ ...SETTLED_ESCROW, customerTier: null, customerCommissionRate: null });
    const [row]: any = await customerRows();
    expect(Object.keys(row)).not.toContain('commissionBreakdown');
  });
});

describe('the driver arm attaches his settlement to HIS rows only', () => {
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

  const BASE_ROW = {
    id: 'j1',
    customerId: 'someone-else',
    status: 'REQUESTED',
    type: 'PASSENGER',
    pickupLat: -1.95,
    pickupLng: 29.87,
    vehiclePreference: null,
    createdAt: new Date(),
    discoveryStartedAt: new Date(),
    customer: { id: 'someone-else', nickname: 'Ange', completedRides: 5 },
    bids: [],
    _count: { bids: 0 },
  };

  it('gives him the full shape on a ride he drove', async () => {
    arrangeFeed({ ...BASE_ROW, driverId: DRIVER_ID, escrow: SETTLED_ESCROW });
    const [row]: any = await journeyService.getJourneys(
      DRIVER_ID, UserRole.DRIVER, undefined, -1.95, 29.87, 'driver',
    );

    expect(row.commissionBreakdown).toEqual({
      bidPrice: 2000,
      driverTier: 'REGULAR',
      driverCommissionRate: 0.035,
      customerTier: 'FREQUENT',
      customerCommissionRate: 0.035,
      totalCommissionRate: 0.07,
      totalCommissionAmount: 140,
      // Read off the row, because that is what escrow actually credited.
      driverPayout: 1860,
      customerSavings: 30,
      // round(2000 x (0.05 baseline − 0.035 applied)) = 30
      driverSavings: 30,
      feeWaiverApplied: false,
      chargedCommissionAmount: 140,
      waivedCommissionAmount: 0,
    });
  });

  it('reports the NOMINAL commission under a waiver, not the charged zero', async () => {
    // LAUNCH-TRUTH G1's compute-then-zero record: `commission` holds what
    // was CHARGED (0) and `waivedCommissionAmount` what the ladder would
    // have taken. The nominal is the ladder's truth.
    arrangeFeed({
      ...BASE_ROW,
      driverId: DRIVER_ID,
      escrow: {
        ...SETTLED_ESCROW,
        commission: 0,
        driverPayout: 2000,
        waivedCommissionAmount: 140,
        feeWaiverId: 'waiver-7',
      },
    });
    const [row]: any = await journeyService.getJourneys(
      DRIVER_ID, UserRole.DRIVER, undefined, -1.95, 29.87, 'driver',
    );

    expect(row.commissionBreakdown.totalCommissionAmount).toBe(140);
    expect(row.commissionBreakdown.chargedCommissionAmount).toBe(0);
    expect(row.commissionBreakdown.driverPayout).toBe(2000);
    expect(row.commissionBreakdown.feeWaiverApplied).toBe(true);
  });

  it('attaches NOTHING to an open request he is not the driver of', async () => {
    // An open request belongs to nobody yet. Gated on `driverId === userId`
    // rather than on the branch, because this arm answers both the feed
    // and a driver querying his own journeys by status.
    arrangeFeed({ ...BASE_ROW, driverId: null, escrow: SETTLED_ESCROW });
    const [row]: any = await journeyService.getJourneys(
      DRIVER_ID, UserRole.DRIVER, undefined, -1.95, 29.87, 'driver',
    );
    expect(Object.keys(row)).not.toContain('commissionBreakdown');
  });

  it("attaches NOTHING to a row another motari drove", async () => {
    arrangeFeed({ ...BASE_ROW, driverId: 'someone-else-drv', escrow: SETTLED_ESCROW });
    const [row]: any = await journeyService.getJourneys(
      DRIVER_ID, UserRole.DRIVER, undefined, -1.95, 29.87, 'driver',
    );
    expect(Object.keys(row)).not.toContain('commissionBreakdown');
    expect(JSON.stringify(row)).not.toContain('1860');
  });

  it('never ships the escrow row itself on a feed card', async () => {
    // LIVE-WIRE G5's design: the feed derives `reopenedUnpaid` and ships
    // only that. Widening the escrow SELECT for the settlement view must
    // not have changed it.
    arrangeFeed({ ...BASE_ROW, driverId: DRIVER_ID, escrow: SETTLED_ESCROW });
    const [row]: any = await journeyService.getJourneys(
      DRIVER_ID, UserRole.DRIVER, undefined, -1.95, 29.87, 'driver',
    );
    expect(Object.keys(row)).not.toContain('escrow');
    expect(JSON.stringify(row)).not.toContain('bimoto-tx-abc123');
    expect(row.reopenedUnpaid).toBe(false);
  });

  it('does not select the processor references at all', async () => {
    arrangeFeed({ ...BASE_ROW, driverId: DRIVER_ID, escrow: SETTLED_ESCROW });
    await journeyService.getJourneys(
      DRIVER_ID, UserRole.DRIVER, undefined, -1.95, 29.87, 'driver',
    );
    const select = prismaMock.journey.findMany.mock.calls[0][0].include.escrow.select;
    expect(Object.keys(select)).not.toContain('txRef');
    expect(Object.keys(select)).not.toContain('flwTxId');
  });
});

/**
 * CUTGUARD v2 amendment 2 — B-2's second instance, pinned from the side
 * the crash was on.
 *
 * HistoryPage at `da9eca0` guards on PRESENCE (`journey.commissionBreakdown &&`)
 * and then reads `totalCommissionRate`, `totalCommissionAmount`,
 * `driverTier`, `driverCommissionRate` and `driverPayout` — five keys a
 * customer-safe projection does not carry and must not carry (#202: any
 * one of them reconstructs the motari's net). The discriminator that
 * makes v14 safe, `hasCustomerSafeCommission`, landed in #206, which is
 * AFTER that APK.
 *
 * So the legacy answer has to OMIT the key rather than null it, and this
 * is the test that says so.
 */
describe('the rides-list preview is gated by CLIENT generation', () => {
  beforeEach(() => {
    prismaMock.adminAction.findMany.mockReset().mockResolvedValue([]);
  });

  it('omits the key entirely for a legacy client — not null, absent', async () => {
    arrange(SETTLED_ESCROW);
    const [row]: any = await customerRows({});

    expect(Object.prototype.hasOwnProperty.call(row, 'commissionBreakdown')).toBe(false);
    // `null` would be worse than useless here: HistoryPage's guard is
    // `&&`, so null is falsy and survives — but a future guard written as
    // `'commissionBreakdown' in journey` would not, and the shape v13 has
    // always coped with is ABSENT.
    expect(row.commissionBreakdown).toBeUndefined();
  });

  it('still gives her everything a v13 HistoryPage actually renders', async () => {
    arrange(SETTLED_ESCROW);
    const [row]: any = await customerRows({});

    // The gate withholds the preview and nothing else. Her row is the one
    // her build has always drawn.
    expect(row.id).toBeDefined();
    expect(row.status).toBe('COMPLETED');
    expect(row.agreedPrice).toBe(2000);
    expect(row.escrow.amount).toBe(2000);
    expect(row.escrow.status).toBe('RELEASED');
  });

  it('the SAME row, asked as v14, carries the four', async () => {
    arrange(SETTLED_ESCROW);
    const [row]: any = await customerRows();

    expect(Object.keys(row.commissionBreakdown).sort()).toEqual(
      ['bidPrice', 'customerSavings', 'customerTier', 'feeWaiverApplied'],
    );
  });

  it('the gate can only ever withhold — it never widens the shape', async () => {
    // The point of the safe-by-default direction: a client claiming to be
    // current gets the four and NOT one key more. Claiming a version is
    // a compatibility signal, never an authorization one.
    arrange(SETTLED_ESCROW);
    const [row]: any = await customerRows();

    const serialized = JSON.stringify(row.commissionBreakdown);
    for (const key of [
      'driverPayout',
      'driverTier',
      'driverCommissionRate',
      'driverSavings',
      'totalCommissionAmount',
      'totalCommissionRate',
    ]) {
      expect(serialized).not.toContain(key);
    }
  });
});
