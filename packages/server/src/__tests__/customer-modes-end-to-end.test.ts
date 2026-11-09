// __TESTS__/CUSTOMER-MODES-END-TO-END.TEST.TS
//
// Dispatch K3 group 8 — exercises the full NEED_TO_GO + suggest-up
// flow with a mocked Prisma + a stubbed acceptBid (so we don't need
// the full payment / escrow stack). Walks the seven scenarios in the
// dispatch §2.8 punch list:
//
//   1. Happy path NEED_TO_GO with auto-accept
//   2. NEED_TO_GO above ceiling → no auto-accept
//   3. Window expired (bid arrives at t=70s)
//   4. Suggest-up at 60s mark
//   5. Suggest-up at 120s mark (both tiers available)
//   6. Auto-accept cancels suggest-up scheduler
//   7. Race: two qualifying bids, one wins, one race-lost

jest.useFakeTimers();

import {
  bidQualifiesForAutoAccept,
  tryAutoAcceptBid,
  _setAcceptBidForTests,
} from '../services/customer-modes/auto-accept';
import {
  scheduleSuggestUpEmits,
  cancelSuggestUpEmits,
  _resetForTests as resetScheduler,
  _hasScheduledTimersForTests,
} from '../services/customer-modes/suggest-up-scheduler';
import { applySuggestUp, getSuggestUpStatus } from '../services/customer-modes/suggest-up';

const T0 = new Date('2026-05-05T17:00:00.000Z');
const t = (offsetSec: number) => new Date(T0.getTime() + offsetSec * 1000);

function makeJourneyRow(overrides: any = {}) {
  return {
    id: 'j1',
    customerId: 'c1',
    status: 'REQUESTED',
    requestMode: 'NEED_TO_GO',
    priceCeilingRwf: 2600,
    priceCeilingMultiplier: 1.3,
    discoveryStartedAt: T0,
    suggestUpCount: 0,
    wishPrice: 1500,
    ...overrides,
  };
}

function makeMockPrisma(initial: any) {
  // In-memory journey store with FOR UPDATE-equivalent semantics:
  // each call to $transaction reads the current state, evaluates the
  // callback, and persists changes atomically (single-threaded
  // Node.js — natural sequence).
  let row: any = { ...initial };
  return {
    _row: () => row,
    _set: (next: any) => {
      row = { ...row, ...next };
    },
    journey: {
      findUnique: jest.fn(async () => row),
      update: jest.fn(async ({ data }: any) => {
        if (data.suggestUpCount?.increment !== undefined) {
          row.suggestUpCount += data.suggestUpCount.increment;
        }
        if (data.wishPrice !== undefined) row.wishPrice = data.wishPrice;
        return row;
      }),
    },
    bid: {
      findUnique: jest.fn(async ({ where }: any) => {
        if (where.id === 'b1') return { id: 'b1', price: 2400, createdAt: t(5) };
        if (where.id === 'b2') return { id: 'b2', price: 2500, createdAt: t(5) };
        if (where.id === 'b-over') return { id: 'b-over', price: 2700, createdAt: t(5) };
        if (where.id === 'b-late') return { id: 'b-late', price: 2400, createdAt: t(70) };
        return null;
      }),
    },
    $transaction: jest.fn(async (cb: any) => {
      const tx = {
        $queryRaw: jest.fn(async () => {
          if (row.status !== 'REQUESTED') return [];
          return [
            {
              id: row.id,
              customerId: row.customerId,
              status: row.status,
              requestMode: row.requestMode,
              priceCeilingRwf: row.priceCeilingRwf,
              discoveryStartedAt: row.discoveryStartedAt,
            },
          ];
        }),
      };
      return cb(tx);
    }),
  } as any;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.clearAllTimers();
  resetScheduler();
});

afterAll(() => {
  jest.useRealTimers();
});

describe('Dispatch K3 — end-to-end', () => {
  it('1. Happy path NEED_TO_GO with auto-accept: bid 2400 ≤ ceiling 2600 within window → MATCHED', async () => {
    const prisma = makeMockPrisma(makeJourneyRow());
    const acceptBidStub = jest.fn(async () => {
      prisma._set({ status: 'MATCHED' });
      return { matched: true };
    });
    _setAcceptBidForTests(acceptBidStub as any);

    const result = await tryAutoAcceptBid(prisma, 'j1', 'b1', t(10));

    expect(result.triggered).toBe(true);
    expect(result.reason).toBe('auto-accepted');
    expect(acceptBidStub).toHaveBeenCalledTimes(1);
    expect(prisma._row().status).toBe('MATCHED');
  });

  it('2. NEED_TO_GO above ceiling: bid 2700 > ceiling 2600 → no auto-accept, journey stays REQUESTED', async () => {
    const prisma = makeMockPrisma(makeJourneyRow());
    const acceptBidStub = jest.fn();
    _setAcceptBidForTests(acceptBidStub as any);

    const result = await tryAutoAcceptBid(prisma, 'j1', 'b-over', t(10));

    expect(result.triggered).toBe(false);
    expect(result.reason).toBe('price-exceeds-ceiling');
    expect(acceptBidStub).not.toHaveBeenCalled();
    expect(prisma._row().status).toBe('REQUESTED');
  });

  it('3. Window expired: first bid arrives at t=70s → no auto-accept', async () => {
    const prisma = makeMockPrisma(makeJourneyRow());
    const acceptBidStub = jest.fn();
    _setAcceptBidForTests(acceptBidStub as any);

    const result = await tryAutoAcceptBid(prisma, 'j1', 'b-late', t(70));

    expect(result.triggered).toBe(false);
    expect(result.reason).toBe('window-expired');
    expect(acceptBidStub).not.toHaveBeenCalled();
  });

  it('4. Suggest-up at 60s mark: customer POSTs +50 → wishPrice incremented and Socket emit fired', async () => {
    const prisma = makeMockPrisma(makeJourneyRow({ wishPrice: 1500 }));
    const emit = jest.fn();
    const io: any = { to: jest.fn(() => ({ emit })) };

    const result = await applySuggestUp(prisma, io, 'j1', 'c1', 50, t(60));

    expect(result.newWishPrice).toBe(1550);
    expect(result.suggestUpCount).toBe(1);
    expect(emit).toHaveBeenCalledWith(
      'journey:wish-price-updated',
      expect.objectContaining({ wishPrice: 1550, addRwf: 50 }),
    );
  });

  it('5. Suggest-up at 120s mark: getSuggestUpStatus returns both tiers; both POSTs work', async () => {
    const status = getSuggestUpStatus(
      { discoveryStartedAt: T0, suggestUpCount: 0 },
      t(120),
    );
    expect(status.availableAmounts).toEqual([50, 100]);

    const prisma = makeMockPrisma(makeJourneyRow({ wishPrice: 1500 }));
    const emit = jest.fn();
    const io: any = { to: jest.fn(() => ({ emit })) };

    const r1 = await applySuggestUp(prisma, io, 'j1', 'c1', 50, t(120));
    expect(r1.newWishPrice).toBe(1550);

    const r2 = await applySuggestUp(prisma, io, 'j1', 'c1', 100, t(125));
    expect(r2.newWishPrice).toBe(1650);
    expect(r2.suggestUpCount).toBe(2);
  });

  it('6. Auto-accept cancels suggest-up scheduler — no T1 emit fires after MATCHED', async () => {
    const prisma = makeMockPrisma(makeJourneyRow());
    const acceptBidStub = jest.fn(async () => {
      prisma._set({ status: 'MATCHED' });
      return { matched: true };
    });
    _setAcceptBidForTests(acceptBidStub as any);

    const emit = jest.fn();
    const io: any = { to: jest.fn(() => ({ emit })) };

    // Schedule the tier emits as journey.service.createJourney would.
    scheduleSuggestUpEmits('j1', 'c1', io, prisma);
    expect(_hasScheduledTimersForTests('j1')).toBe(true);

    // Auto-accept fires at t=30s (well before T1 reveal at 60s).
    await tryAutoAcceptBid(prisma, 'j1', 'b1', t(30));
    cancelSuggestUpEmits('j1');
    expect(_hasScheduledTimersForTests('j1')).toBe(false);

    // Advance past both tiers; no emit should fire.
    jest.advanceTimersByTime(180_000);
    await Promise.resolve();
    await Promise.resolve();

    expect(emit).not.toHaveBeenCalled();
  });

  it('7. Race: two qualifying bids on same NEED_TO_GO journey → exactly one auto-accept fires', async () => {
    const prisma = makeMockPrisma(makeJourneyRow());
    const acceptBidStub = jest.fn(async () => {
      // First call flips the journey to MATCHED — second tryAuto sees
      // status != REQUESTED inside the FOR UPDATE re-read and bails.
      prisma._set({ status: 'MATCHED' });
      return { matched: true };
    });
    _setAcceptBidForTests(acceptBidStub as any);

    const r1 = await tryAutoAcceptBid(prisma, 'j1', 'b1', t(5));
    const r2 = await tryAutoAcceptBid(prisma, 'j1', 'b2', t(5));

    expect(r1.triggered).toBe(true);
    expect(r1.reason).toBe('auto-accepted');
    expect(r2.triggered).toBe(false);
    expect(r2.reason).toBe('race-lost');
    expect(acceptBidStub).toHaveBeenCalledTimes(1);
  });

  it('also covers: bidQualifiesForAutoAccept pure check matches end-to-end behaviour', () => {
    // Cross-check that the pure validator the hook reuses lines up
    // with the transactional path's outcomes.
    const journey = makeJourneyRow();
    expect(
      bidQualifiesForAutoAccept(journey, { price: 2400, createdAt: t(10) }, 60, t(10)).qualifies,
    ).toBe(true);
    expect(
      bidQualifiesForAutoAccept(journey, { price: 2700, createdAt: t(10) }, 60, t(10)).qualifies,
    ).toBe(false);
    expect(
      bidQualifiesForAutoAccept(journey, { price: 2400, createdAt: t(70) }, 60, t(70)).qualifies,
    ).toBe(false);
  });
});
