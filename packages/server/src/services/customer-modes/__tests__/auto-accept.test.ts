// SERVICES/CUSTOMER-MODES/__TESTS__/AUTO-ACCEPT.TEST.TS
//
// Dispatch K3 group 2 — covers the "smallest-wrongness" gotcha
// (compare against priceCeilingRwf, NOT wishPrice), the rejection
// reasons, and the race-lost idempotency guarantee.
//
// BID-ATOMICITY G2 — tryAutoAcceptBid no longer takes FOR UPDATE; the
// journey read is a plain eligibility pre-filter and acceptBid's atomic
// claim is the arbiter. The mocks below model that: journey.findUnique
// replaces the locked $queryRaw, and a BID_NOT_PENDING loss from
// acceptBid maps to 'race-lost'.

jest.mock('../../bid.service', () => ({
  acceptBid: jest.fn(),
}));

import {
  bidQualifiesForAutoAccept,
  tryAutoAcceptBid,
  _setAcceptBidForTests,
} from '../auto-accept';
import * as bidServiceMock from '../../bid.service';

const mockAcceptBid = bidServiceMock.acceptBid as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  _setAcceptBidForTests(null);
});

const T0 = new Date('2026-05-05T17:00:00.000Z');
const t = (offsetSec: number) => new Date(T0.getTime() + offsetSec * 1000);

function makeJourney(overrides: Partial<any> = {}) {
  return {
    status: 'REQUESTED',
    requestMode: 'NEED_TO_GO',
    priceCeilingRwf: 2600,
    discoveryStartedAt: T0,
    ...overrides,
  };
}

describe('bidQualifiesForAutoAccept (pure)', () => {
  it('SMALLEST-WRONGNESS: NEED_TO_GO with wish=1500, ceiling=2600, bid=2400 → qualifies', () => {
    // The customer's wishPrice is 1500 RWF, but they ticked NEED_TO_GO
    // with a 1.3x ceiling = 1950? No — the dispatch's example uses
    // ceiling=2600 (e.g. fairPrice=2000 * 1.3). The point: bid 2400 is
    // ABOVE wishPrice 1500 but BELOW ceiling 2600. It MUST qualify.
    const journey = makeJourney({ priceCeilingRwf: 2600 });
    const bid = { price: 2400, createdAt: t(10) };
    const result = bidQualifiesForAutoAccept(journey, bid, 60, t(10));
    expect(result.qualifies).toBe(true);
    expect(result.reason).toBe('qualifies');
  });

  it('rejects mode WAIT_AND_COMPARE', () => {
    const journey = makeJourney({ requestMode: 'WAIT_AND_COMPARE' });
    const result = bidQualifiesForAutoAccept(
      journey,
      { price: 2400, createdAt: t(10) },
      60,
      t(10),
    );
    expect(result.qualifies).toBe(false);
    expect(result.reason).toBe('mode-not-need-to-go');
  });

  it('rejects bid > ceiling', () => {
    const journey = makeJourney({ priceCeilingRwf: 2600 });
    const result = bidQualifiesForAutoAccept(
      journey,
      { price: 2700, createdAt: t(10) },
      60,
      t(10),
    );
    expect(result.qualifies).toBe(false);
    expect(result.reason).toBe('price-exceeds-ceiling');
  });

  it('rejects past 60s window', () => {
    const journey = makeJourney();
    const result = bidQualifiesForAutoAccept(
      journey,
      { price: 2000, createdAt: t(70) },
      60,
      t(70),
    );
    expect(result.qualifies).toBe(false);
    expect(result.reason).toBe('window-expired');
  });

  it('rejects journey not REQUESTED', () => {
    const journey = makeJourney({ status: 'MATCHED' });
    const result = bidQualifiesForAutoAccept(
      journey,
      { price: 2000, createdAt: t(10) },
      60,
      t(10),
    );
    expect(result.qualifies).toBe(false);
    expect(result.reason).toBe('journey-not-open');
  });

  it('rejects when no ceiling is set (sanity check; should not happen in prod for NEED_TO_GO)', () => {
    const journey = makeJourney({ priceCeilingRwf: null });
    const result = bidQualifiesForAutoAccept(
      journey,
      { price: 2000, createdAt: t(10) },
      60,
      t(10),
    );
    expect(result.qualifies).toBe(false);
    expect(result.reason).toBe('no-ceiling-set');
  });

  it('accepts at the exact 60s boundary', () => {
    const journey = makeJourney();
    const result = bidQualifiesForAutoAccept(
      journey,
      { price: 2000, createdAt: t(60) },
      60,
      t(60),
    );
    // now == windowEndsAt → not strictly greater → still qualifies
    expect(result.qualifies).toBe(true);
  });
});

describe('tryAutoAcceptBid (transactional)', () => {
  function makeMockPrisma(opts: {
    lockedRow: any | null;
    bid: any | null;
  }) {
    return {
      journey: {
        findUnique: jest.fn(async () => opts.lockedRow),
      },
      bid: {
        findUnique: jest.fn(async () => opts.bid),
      },
    } as any;
  }

  it('happy path: REQUESTED + NEED_TO_GO + qualifying bid → acceptBid called once', async () => {
    const prisma = makeMockPrisma({
      lockedRow: {
        id: 'j1',
        customerId: 'c1',
        status: 'REQUESTED',
        requestMode: 'NEED_TO_GO',
        priceCeilingRwf: 2600,
        discoveryStartedAt: T0,
      },
      bid: { id: 'b1', price: 2400, createdAt: t(5) },
    });
    mockAcceptBid.mockResolvedValueOnce({ matched: true });

    const result = await tryAutoAcceptBid(prisma, 'j1', 'b1', t(10));

    expect(result.triggered).toBe(true);
    expect(result.bidId).toBe('b1');
    expect(result.reason).toBe('auto-accepted');
    expect(mockAcceptBid).toHaveBeenCalledTimes(1);
    // CUTGUARD v2 G4 — a NAMED system actor, not the journey's own
    // customerId. The old assertion ('c1', read off the eligible-journey
    // row) was pinning a tautology: acceptBidCore compared it against
    // journey.customerId, itself. Harmless here — a cron has no session
    // and the eligibility filter is what authorises the accept — but it
    // was spelled exactly like U-1, which was not harmless. The actor now
    // says which machinery is acting.
    expect(mockAcceptBid).toHaveBeenCalledWith(
      'j1',
      { kind: 'system', reason: 'customer-modes/auto-accept' },
      'b1',
      {},
    );
  });

  it('race-lost: journey already MATCHED → no acceptBid call', async () => {
    const prisma = makeMockPrisma({
      lockedRow: null, // pre-filter read saw no eligible journey
      bid: { id: 'b1', price: 2400, createdAt: t(5) },
    });

    const result = await tryAutoAcceptBid(prisma, 'j1', 'b1', t(10));

    expect(result.triggered).toBe(false);
    expect(result.reason).toBe('race-lost');
    expect(mockAcceptBid).not.toHaveBeenCalled();
  });

  it('WAIT_AND_COMPARE journey → no auto-accept, no acceptBid call', async () => {
    const prisma = makeMockPrisma({
      lockedRow: {
        id: 'j1',
        customerId: 'c1',
        status: 'REQUESTED',
        requestMode: 'WAIT_AND_COMPARE',
        priceCeilingRwf: null,
        discoveryStartedAt: T0,
      },
      bid: { id: 'b1', price: 2400, createdAt: t(5) },
    });

    const result = await tryAutoAcceptBid(prisma, 'j1', 'b1', t(10));

    expect(result.triggered).toBe(false);
    expect(result.reason).toBe('mode-not-need-to-go');
    expect(mockAcceptBid).not.toHaveBeenCalled();
  });

  it('over-ceiling bid → returns price-exceeds-ceiling, no acceptBid', async () => {
    const prisma = makeMockPrisma({
      lockedRow: {
        id: 'j1',
        customerId: 'c1',
        status: 'REQUESTED',
        requestMode: 'NEED_TO_GO',
        priceCeilingRwf: 2600,
        discoveryStartedAt: T0,
      },
      bid: { id: 'b1', price: 2700, createdAt: t(5) },
    });

    const result = await tryAutoAcceptBid(prisma, 'j1', 'b1', t(10));

    expect(result.triggered).toBe(false);
    expect(result.reason).toBe('price-exceeds-ceiling');
    expect(mockAcceptBid).not.toHaveBeenCalled();
  });

  it('bid not found in DB → bid-missing', async () => {
    const prisma = makeMockPrisma({
      lockedRow: {
        id: 'j1',
        customerId: 'c1',
        status: 'REQUESTED',
        requestMode: 'NEED_TO_GO',
        priceCeilingRwf: 2600,
        discoveryStartedAt: T0,
      },
      bid: null,
    });

    const result = await tryAutoAcceptBid(prisma, 'j1', 'b1', t(10));

    expect(result.triggered).toBe(false);
    expect(result.reason).toBe('bid-missing');
    expect(mockAcceptBid).not.toHaveBeenCalled();
  });

  it('two qualifying bids race-arrive — only ONE auto-accept fires', async () => {
    // Simulate: first call reads REQUESTED and wins. Second call reads
    // the now-MATCHED journey and returns race-lost at the pre-filter.
    let calls = 0;
    const prisma: any = {
      journey: {
        findUnique: jest.fn(async () => {
          calls += 1;
          if (calls === 1) {
            return {
              id: 'j1',
              customerId: 'c1',
              status: 'REQUESTED',
              requestMode: 'NEED_TO_GO',
              priceCeilingRwf: 2600,
              discoveryStartedAt: T0,
            };
          }
          // Second call: the row is now MATCHED — pre-filter exits.
          return { id: 'j1', customerId: 'c1', status: 'MATCHED' };
        }),
      },
      bid: {
        findUnique: jest.fn(async ({ where }: any) => {
          if (where.id === 'b1') return { id: 'b1', price: 2400, createdAt: t(2) };
          if (where.id === 'b2') return { id: 'b2', price: 2500, createdAt: t(2) };
          return null;
        }),
      },
    };
    mockAcceptBid.mockResolvedValueOnce({ matched: true });

    const r1 = await tryAutoAcceptBid(prisma, 'j1', 'b1', t(5));
    const r2 = await tryAutoAcceptBid(prisma, 'j1', 'b2', t(5));

    expect(r1.triggered).toBe(true);
    expect(r2.triggered).toBe(false);
    expect(r2.reason).toBe('race-lost');
    expect(mockAcceptBid).toHaveBeenCalledTimes(1);
  });

  it("BID-ATOMICITY G2: acceptBid losing the atomic claim (BID_NOT_PENDING) maps to a calm race-lost", async () => {
    // The pre-filter read saw REQUESTED, but a manual accept won the
    // race before acceptBid ran: the claim throws BID_NOT_PENDING.
    const prisma = makeMockPrisma({
      lockedRow: {
        id: 'j1',
        customerId: 'c1',
        status: 'REQUESTED',
        requestMode: 'NEED_TO_GO',
        priceCeilingRwf: 2600,
        discoveryStartedAt: T0,
      },
      bid: { id: 'b1', price: 2400, createdAt: t(5) },
    });
    const loss: any = new Error('errors.bidNotPending');
    loss.code = 'BID_NOT_PENDING';
    loss.statusCode = 400;
    mockAcceptBid.mockRejectedValueOnce(loss);

    const result = await tryAutoAcceptBid(prisma, 'j1', 'b1', t(10));

    expect(result.triggered).toBe(false);
    expect(result.reason).toBe('race-lost');
  });

  it('non-race acceptBid errors still propagate to the caller', async () => {
    const prisma = makeMockPrisma({
      lockedRow: {
        id: 'j1',
        customerId: 'c1',
        status: 'REQUESTED',
        requestMode: 'NEED_TO_GO',
        priceCeilingRwf: 2600,
        discoveryStartedAt: T0,
      },
      bid: { id: 'b1', price: 2400, createdAt: t(5) },
    });
    mockAcceptBid.mockRejectedValueOnce(new Error('gateway exploded'));

    await expect(tryAutoAcceptBid(prisma, 'j1', 'b1', t(10))).rejects.toThrow(
      'gateway exploded',
    );
  });
});
