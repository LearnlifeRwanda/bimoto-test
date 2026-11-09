// MONEY-VIEW v2 G1 — the escrow row, projected per viewer.
//
// #202 built `toCustomerSafeCommission` for the COMPUTED breakdown and
// #206 made five screens safe against the shapes it produces. The escrow
// ROW is the same money at a different exit, and it had no such place at
// all: two client-facing reads (`getJourneyById`, and the customer arm of
// `getJourneys`) both said `escrow: true`, which returns every column the
// model has.
//
// The leak was live, not theoretical. RideReceiptPage:146 reads
//
//     driverReceived = breakdown?.driverPayout ?? escrow?.driverPayout
//
// and a customer's `breakdown` is the redacted four, so the first arm is
// `undefined` on every passenger receipt and the fallback PRINTED the
// motari's net — the very number #202 removed from the breakdown, arriving
// through the row standing beside it.
//
// The assertions below are written BOTH ways on purpose. Presence, because
// a view that drops `id`/`status` silently breaks the payment-retry
// surface (PaymentsPage:55 polls `/api/payments/:escrowId/status` off
// `journey.escrow.id`). And absence over the WHOLE serialized object
// rather than a hand-listed set, so a column added to `Escrow` later
// cannot quietly re-open the leak — the same technique
// live-wire-role-scoped-payload uses for the breakdown.

import { toCustomerEscrowView, toDriverEscrowView } from '../services/journey.service';

jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    journey: { findUnique: jest.fn(), findMany: jest.fn() },
    user: { findUnique: jest.fn() },
    bid: { findMany: jest.fn() },
    driverProfile: { findUnique: jest.fn() },
    escrow: { findUnique: jest.fn() },
    rating: { findUnique: jest.fn() },
    adminAction: { findMany: jest.fn() },
    feeWaiver: { findMany: jest.fn(), findFirst: jest.fn() },
  },
}));

/**
 * A settlement row with every column the `Escrow` model carries, so the
 * absence assertions are proved against a row that really holds them.
 * A WAIVED ride, because that is the harder case: the waived amount is
 * the nominal tier commission, so publishing it hands back the payout.
 */
const FULL_ESCROW = {
  id: 'esc-1',
  journeyId: 'jrn-1',
  customerId: 'cust-1',
  driverId: 'drv-1',
  amount: 2000,
  commission: 0,
  driverPayout: 2000,
  status: 'HELD',
  createdAt: new Date('2026-08-25T09:00:00Z'),
  releasedAt: new Date('2026-08-25T10:00:00Z'),
  driverTier: 'SILVER',
  customerTier: 'FREQUENT',
  driverCommissionRate: 0.04,
  customerCommissionRate: 0.035,
  txRef: 'bimoto-tx-abc123',
  flwTxId: '99887766',
  lastChargeAttemptAt: new Date('2026-08-25T09:00:30Z'),
  waivedCommissionAmount: 150,
  feeWaiverId: 'waiver-7',
};

/** Everything from which the motari's net is readable or reconstructible. */
const DRIVER_MONEY_KEYS = [
  'commission',
  'driverPayout',
  'driverTier',
  'driverCommissionRate',
  'waivedCommissionAmount',
];

/** The payment processor's own references. No client of any role sees these. */
const PROCESSOR_KEYS = ['txRef', 'flwTxId', 'lastChargeAttemptAt'];

describe('toCustomerEscrowView', () => {
  const view = toCustomerEscrowView(FULL_ESCROW)!;

  it('keeps what the payment surfaces actually need', () => {
    // Not courtesy fields: PaymentsPage:55 polls
    // GET /api/payments/:escrowId/status off `journey.escrow.id`, and
    // `retryMomoCharge(escrowId)` needs the same id. A view without them
    // breaks the retry path on the screen where a charge fails.
    expect(view.id).toBe('esc-1');
    expect(view.status).toBe('HELD');
    expect(view.amount).toBe(2000);
    expect(view.releasedAt).toEqual(FULL_ESCROW.releasedAt);
  });

  it('gives the customer her OWN tier and rate', () => {
    expect(view.customerTier).toBe('FREQUENT');
    expect(view.customerCommissionRate).toBe(0.035);
  });

  it('reduces the waiver to a boolean, never an amount', () => {
    // #202 gives the customer a boolean here. The row must not contradict
    // the breakdown standing next to it: on a waived ride
    // `waivedCommissionAmount` IS the nominal tier commission, so the
    // amount would hand back `driverPayout = amount - waived`.
    expect(view.feeWaiverApplied).toBe(true);
    expect((view as unknown as Record<string, unknown>).waivedCommissionAmount).toBeUndefined();
    expect((view as unknown as Record<string, unknown>).feeWaiverId).toBeUndefined();
  });

  it('carries nothing from which the driver payout can be reconstructed', () => {
    const serialized = JSON.stringify(view);
    for (const key of DRIVER_MONEY_KEYS) {
      expect(Object.keys(view)).not.toContain(key);
      expect(serialized).not.toContain(key);
    }
    // And the values themselves, not only the key names.
    expect(serialized).not.toContain('SILVER');
    expect(serialized).not.toContain('150');
  });

  it('carries no processor reference', () => {
    const serialized = JSON.stringify(view);
    for (const key of PROCESSOR_KEYS) {
      expect(Object.keys(view)).not.toContain(key);
    }
    expect(serialized).not.toContain('bimoto-tx-abc123');
    expect(serialized).not.toContain('99887766');
  });

  it('says nothing when there is no escrow', () => {
    expect(toCustomerEscrowView(null)).toBeNull();
    expect(toCustomerEscrowView(undefined)).toBeNull();
  });

  it('reports no waiver when the row carries none', () => {
    const unwaived = toCustomerEscrowView({
      ...FULL_ESCROW,
      feeWaiverId: null,
      waivedCommissionAmount: null,
    })!;
    expect(unwaived.feeWaiverApplied).toBe(false);
  });
});

describe('toDriverEscrowView', () => {
  const view = toDriverEscrowView(FULL_ESCROW)!;

  it('gives the motari his settlement in full', () => {
    expect(view.id).toBe('esc-1');
    expect(view.status).toBe('HELD');
    expect(view.amount).toBe(2000);
    expect(view.commission).toBe(0);
    expect(view.driverPayout).toBe(2000);
    expect(view.releasedAt).toEqual(FULL_ESCROW.releasedAt);
  });

  it('gives him his OWN tier, rate and waiver — his money', () => {
    expect(view.driverTier).toBe('SILVER');
    expect(view.driverCommissionRate).toBe(0.04);
    expect(view.waivedCommissionAmount).toBe(150);
    expect(view.feeWaiverApplied).toBe(true);
  });

  it("does not carry the customer's tier or rate", () => {
    expect(Object.keys(view)).not.toContain('customerTier');
    expect(Object.keys(view)).not.toContain('customerCommissionRate');
    expect(JSON.stringify(view)).not.toContain('FREQUENT');
  });

  it('carries no processor reference either', () => {
    const serialized = JSON.stringify(view);
    for (const key of PROCESSOR_KEYS) {
      expect(Object.keys(view)).not.toContain(key);
    }
    expect(serialized).not.toContain('bimoto-tx-abc123');
    expect(serialized).not.toContain('99887766');
  });

  it('says nothing when there is no escrow', () => {
    expect(toDriverEscrowView(null)).toBeNull();
    expect(toDriverEscrowView(undefined)).toBeNull();
  });
});

describe('the two views together', () => {
  it('overlap only on what both are entitled to', () => {
    const customer = Object.keys(toCustomerEscrowView(FULL_ESCROW)!);
    const driver = Object.keys(toDriverEscrowView(FULL_ESCROW)!);
    const shared = customer.filter((k) => driver.includes(k)).sort();
    expect(shared).toEqual([
      'amount',
      'feeWaiverApplied',
      'id',
      'releasedAt',
      'status',
    ]);
  });

  it('neither view is the raw row', () => {
    const raw = Object.keys(FULL_ESCROW);
    expect(Object.keys(toCustomerEscrowView(FULL_ESCROW)!).length).toBeLessThan(raw.length);
    expect(Object.keys(toDriverEscrowView(FULL_ESCROW)!).length).toBeLessThan(raw.length);
  });
});

// ---------------------------------------------------------------------------
// THE VIEWS BEING CORRECT IS HALF OF IT. The other half is that every exit
// actually goes through them — the failure mode this dispatch exists to end
// is not a wrong projection, it is a projection that some route forgot.
//
// So these drive the real `getJourneyById` and assert on what it RETURNS,
// per viewer, off one settlement row. A regression that reverts either
// call site to `journey.escrow` fails here even though the view functions
// above stay perfect.
// ---------------------------------------------------------------------------

import prisma from '../prisma';
import { getJourneyById } from '../services/journey.service';

const mockPrisma = prisma as unknown as {
  journey: { findUnique: jest.Mock };
  rating: { findUnique: jest.Mock };
  driverProfile: { findUnique: jest.Mock };
  feeWaiver: { findMany: jest.Mock };
};

const JOURNEY_BASE = {
  customerId: 'cust-1',
  driverId: 'drv-1',
  status: 'COMPLETED',
};

const JOURNEY_FULL = {
  id: 'jrn-1',
  ...JOURNEY_BASE,
  agreedPrice: 2000,
  escrow: FULL_ESCROW,
  messages: [],
  bids: [],
  legs: [],
  customer: { id: 'cust-1', nickname: 'Ange', completedRides: 25 },
  driver: { id: 'drv-1', nickname: 'Jean', driverProfile: { totalRides: 40 } },
};

function arrangeJourney() {
  mockPrisma.journey.findUnique
    .mockReset()
    .mockResolvedValueOnce(JOURNEY_BASE) // the three-column scope probe
    .mockResolvedValueOnce(JOURNEY_FULL); // the projection
  mockPrisma.rating.findUnique.mockReset().mockResolvedValue(null);
  mockPrisma.driverProfile.findUnique.mockReset().mockResolvedValue({ totalRides: 40 });
  mockPrisma.feeWaiver.findMany.mockReset().mockResolvedValue([]);
}

describe('getJourneyById routes its escrow through the views', () => {
  it("hands the CUSTOMER a scoped row — and the receipt's fallback nothing to print", async () => {
    arrangeJourney();
    // CUTGUARD v2 amendment 2 — asked as a CURRENT client, because the
    // assertion below is that her breakdown carries no `driverPayout`,
    // and a breakdown withheld by the version gate would satisfy that
    // vacuously. The gate's own directions are pinned in
    // cutguard-app-version-gates; this test is about the PROJECTION.
    const body: any = await getJourneyById('jrn-1', 'cust-1', {
      customerSavingsPreview: true,
    });

    // Still truthy, so the who-loop in journey-read-authorization.spec and
    // every `journey.escrow?.id` reader keep working.
    expect(body.escrow).toBeTruthy();
    expect(body.escrow.id).toBe('esc-1');
    expect(body.escrow.status).toBe('HELD');

    // THE F1 FIX, stated as the line that broke:
    // RideReceiptPage's `breakdown?.driverPayout ?? escrow?.driverPayout`
    // now has nothing on either side for a passenger.
    expect(body.commissionBreakdown.driverPayout).toBeUndefined();
    expect(body.escrow.driverPayout).toBeUndefined();

    const serialized = JSON.stringify(body.escrow);
    for (const key of [...DRIVER_MONEY_KEYS, ...PROCESSOR_KEYS]) {
      expect(Object.keys(body.escrow)).not.toContain(key);
    }
    expect(serialized).not.toContain('bimoto-tx-abc123');
  });

  it('hands the matched DRIVER his settlement', async () => {
    arrangeJourney();
    const body: any = await getJourneyById('jrn-1', 'drv-1');

    expect(body.escrow).toBeTruthy();
    expect(body.escrow.driverPayout).toBe(2000);
    expect(body.escrow.commission).toBe(0);
    expect(body.escrow.driverTier).toBe('SILVER');
    expect(body.escrow.waivedCommissionAmount).toBe(150);

    // His own money, but never the processor's references.
    for (const key of PROCESSOR_KEYS) {
      expect(Object.keys(body.escrow)).not.toContain(key);
    }
    expect(JSON.stringify(body.escrow)).not.toContain('bimoto-tx-abc123');
  });

  it('leaves a privileged (server-internal) caller the raw row', async () => {
    arrangeJourney();
    const body: any = await getJourneyById('jrn-1');

    // The conflict resolver and the emergency routes read columns no
    // client may see; neither is a client exit.
    expect(body.escrow.txRef).toBe('bimoto-tx-abc123');
    expect(body.escrow.driverPayout).toBe(2000);
  });
});
