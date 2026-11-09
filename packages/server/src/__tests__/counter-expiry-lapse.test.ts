// __TESTS__/COUNTER-EXPIRY-LAPSE.TEST.TS
//
// COUNTER-READY G5 — an unanswered counter lapses with the bid.
//
// The bid-expiry job's per-bid update gained ONE conditional spread.
// What is pinned here is both halves of that condition: a countered,
// unanswered bid closes its counter as LAPSED, and every other bid gets
// EXACTLY the write it got before this dispatch — nothing added, no
// column touched that was not touched before.
//
// LAPSED and not DECLINED, deliberately: nobody declined anything. The
// clock ran out on both of them, and a record that said the motari
// refused would be a record of something that did not happen.

jest.mock('../prisma', () => {
  const bidRows = new Map<string, any>();
  const client: any = {
    bid: {
      findMany: jest.fn(async () => [...bidRows.values()].filter((b) => b.status === 'PENDING')),
      update: jest.fn(async ({ where, data }: any) => {
        const row = { ...bidRows.get(where.id), ...data };
        bidRows.set(where.id, row);
        return row;
      }),
    },
  };
  client.__rows = bidRows;
  return { __esModule: true, default: client };
});

jest.mock('../socket', () => ({ emitToJourney: jest.fn() }));

jest.mock('../services/job-lock', () => ({
  withJobLock: jest.fn(async (_name: string, fn: any) => fn()),
}));

import prisma from '../prisma';
import { startBidExpiryJob, stopBidExpiryJob } from '../jobs/bid-expiry.job';
import { emitToJourney } from '../socket';

const bidRows = (prisma as any).__rows as Map<string, any>;

const seedBid = (id: string, over: Record<string, unknown> = {}) => {
  bidRows.set(id, {
    id,
    journeyId: 'j1',
    driverId: 'd1',
    status: 'PENDING',
    price: 2000,
    counterAmountRwf: null,
    counterAt: null,
    counterOutcome: null,
    ...over,
  });
};

/** One tick of the job, via its real entry point. */
async function runOneTick() {
  startBidExpiryJob();
  stopBidExpiryJob();
  // startBidExpiryJob fires an immediate tick before the interval.
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
}

beforeEach(() => {
  jest.clearAllMocks();
  bidRows.clear();
});

afterEach(() => {
  stopBidExpiryJob();
});

describe('bid expiry lapses an unanswered counter', () => {
  test('countered and never answered → EXPIRED + LAPSED', async () => {
    seedBid('b1', { counterAmountRwf: 1500, counterAt: new Date() });
    await runOneTick();

    const bid = bidRows.get('b1');
    expect(bid.status).toBe('EXPIRED');
    expect(bid.counterOutcome).toBe('LAPSED');
  });

  test('no counter at all → EXPIRED, and counterOutcome is left alone', async () => {
    seedBid('b2');
    await runOneTick();

    const bid = bidRows.get('b2');
    expect(bid.status).toBe('EXPIRED');
    expect(bid.counterOutcome).toBeNull();
    // The write itself is exactly the one this job always made.
    const call = ((prisma as any).bid.update as jest.Mock).mock.calls[0][0];
    expect(call.data).toEqual({ status: 'EXPIRED' });
  });

  test('a counter already ANSWERED is not overwritten', async () => {
    // He declined; the bid stayed PENDING at his price and then ran out
    // of time. His answer stands — expiry closes the OFFER, not the
    // record of what he said about the price.
    seedBid('b3', {
      counterAmountRwf: 1500,
      counterAt: new Date(),
      counterOutcome: 'DECLINED',
    });
    await runOneTick();

    const bid = bidRows.get('b3');
    expect(bid.status).toBe('EXPIRED');
    expect(bid.counterOutcome).toBe('DECLINED');
  });

  test('the BID_EXPIRED announcement is unchanged either way', async () => {
    seedBid('b4', { counterAmountRwf: 1500, counterAt: new Date() });
    await runOneTick();
    expect(emitToJourney).toHaveBeenCalledWith('j1', 'bid-expired', {
      bidId: 'b4',
      journeyId: 'j1',
      driverId: 'd1',
    });
  });

  test('the lapse does not consult the flag — a switch turned back off strands nothing', async () => {
    // A row that carries a counter carries it whether or not
    // COUNTER_BID_ENABLED is still on, and an open question on an
    // expired offer must close either way.
    const { config } = require('../config');
    config.COUNTER_BID_ENABLED = false;
    seedBid('b5', { counterAmountRwf: 1500, counterAt: new Date() });
    await runOneTick();
    expect(bidRows.get('b5').counterOutcome).toBe('LAPSED');
  });
});
