// PAY-TRUTH G5 — the two shapes a failed charge can take, and the bounded
// end of the one that keeps the match.
//
// G1 proved the old single behaviour stranded the customer: reverting the
// journey to REQUESTED while the FAILED escrow kept owning journeyId made
// the next accept-bid die on the unique constraint. These tests pin both
// halves of the fix — that the interactive path does NOT revert, that the
// non-interactive path still does, and that the reaper releases a driver
// only when the customer really has gone.

jest.mock('../prisma', () => {
  const tx = {
    escrow: { updateMany: jest.fn(), count: jest.fn() },
    journey: { update: jest.fn(), updateMany: jest.fn() },
    bid: { updateMany: jest.fn() },
  };
  return {
    __esModule: true,
    default: {
      escrow: { findUnique: jest.fn(), findMany: jest.fn() },
      $transaction: jest.fn(async (fn: any) => fn(tx)),
      __tx: tx,
    },
  };
});

jest.mock('../services/escrow-audit.service', () => ({
  appendAuditEntryTx: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../services/payout.service', () => ({
  creditDriverBalance: jest.fn().mockResolvedValue(undefined),
}));

import prisma from '../prisma';
import { markEscrowChargeFailed, releaseUnpaidMatch } from '../services/escrow.service';
import { appendAuditEntryTx } from '../services/escrow-audit.service';
import { runUnpaidMatchReaperOnce, UNPAID_MATCH_GRACE_MS } from '../jobs/unpaid-match-reaper.job';

const m = prisma as any;
const tx = m.__tx;
const audit = appendAuditEntryTx as jest.Mock;

const JOURNEY = '11111111-2222-3333-4444-555555555555';
const pendingEscrow = {
  id: 'e1',
  journeyId: JOURNEY,
  customerId: 'cust-1',
  amount: 2000,
  status: 'PENDING',
};

beforeEach(() => {
  jest.clearAllMocks();
  tx.escrow.updateMany.mockResolvedValue({ count: 1 });
  tx.escrow.count.mockResolvedValue(1);
  tx.journey.update.mockResolvedValue({});
  tx.journey.updateMany.mockResolvedValue({ count: 1 });
  tx.bid.updateMany.mockResolvedValue({ count: 0 });
});

describe('markEscrowChargeFailed disposition', () => {
  test("'keep-match' leaves the journey MATCHED and the bid ACCEPTED", async () => {
    m.escrow.findUnique.mockResolvedValue(pendingEscrow);

    await markEscrowChargeFailed('e1', 'INSUFFICIENT_FUNDS', undefined, 'keep-match');

    // The money row still tells the truth...
    expect(tx.escrow.updateMany).toHaveBeenCalledWith({
      where: { id: 'e1', status: 'PENDING' },
      data: { status: 'FAILED' },
    });
    // ...and the disposition is on the chain, so an auditor can tell why a
    // journey is still MATCHED over a FAILED escrow.
    expect(audit).toHaveBeenCalledWith(
      tx, 'e1', 'CHARGE_FAILED', 2000, 'cust-1',
      expect.objectContaining({ reason: 'INSUFFICIENT_FUNDS', disposition: 'keep-match' }),
    );
    // The match is NOT torn down — this is the whole fix.
    expect(tx.journey.update).not.toHaveBeenCalled();
    expect(tx.bid.updateMany).not.toHaveBeenCalled();
  });

  test("'release-match' is the DEFAULT and still frees the driver", async () => {
    m.escrow.findUnique.mockResolvedValue(pendingEscrow);

    // No disposition argument at all: every pre-existing caller (webhook,
    // reconciler) must inherit the old behaviour, not the new one.
    await markEscrowChargeFailed('e1', 'WEBHOOK_REPORTED_FAILURE');

    expect(tx.journey.update).toHaveBeenCalledWith({
      where: { id: JOURNEY },
      data: { status: 'REQUESTED', driverId: null, agreedPrice: null, commissionAmount: null },
    });
    // DOC-GUARD G4 — the reopen covers the winner as well as the losers.
    // This assertion used to read `status: 'DECLINED'`, which is exactly
    // the bug: the accepted bid stayed ACCEPTED on a journey with no
    // driver, and the customer was shown an Accept button that answered
    // 400 BID_NOT_PENDING.
    expect(tx.bid.updateMany).toHaveBeenCalledWith({
      where: { journeyId: JOURNEY, status: { in: ['ACCEPTED', 'DECLINED'] } },
      data: { status: 'PENDING' },
    });
    expect(audit).toHaveBeenCalledWith(
      tx, 'e1', 'CHARGE_FAILED', 2000, 'cust-1',
      expect.objectContaining({ disposition: 'release-match' }),
    );
  });

  test('a lost race writes nothing at all, under either disposition', async () => {
    m.escrow.findUnique.mockResolvedValue(pendingEscrow);
    tx.escrow.updateMany.mockResolvedValue({ count: 0 });

    await markEscrowChargeFailed('e1', 'INSUFFICIENT_FUNDS', undefined, 'keep-match');

    expect(audit).not.toHaveBeenCalled();
    expect(tx.journey.update).not.toHaveBeenCalled();
  });

  test('an already-settled escrow is never re-failed', async () => {
    m.escrow.findUnique.mockResolvedValue({ ...pendingEscrow, status: 'HELD' });

    await markEscrowChargeFailed('e1', 'WEBHOOK_REPORTED_FAILURE');

    expect(tx.escrow.updateMany).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });
});

describe('releaseUnpaidMatch', () => {
  test('releases a journey still MATCHED over a still-FAILED escrow', async () => {
    const released = await releaseUnpaidMatch('e1', JOURNEY);

    expect(released).toBe(true);
    expect(tx.escrow.count).toHaveBeenCalledWith({ where: { id: 'e1', status: 'FAILED' } });
    expect(tx.journey.updateMany).toHaveBeenCalledWith({
      where: { id: JOURNEY, status: 'MATCHED' },
      data: { status: 'REQUESTED', driverId: null, agreedPrice: null, commissionAmount: null },
    });
    // DOC-GUARD G4 — the reaper's release reopens the winning bid too,
    // identically to the webhook's. The releasing party never mattered
    // to the dead end, and it does not matter to the fix either.
    expect(tx.bid.updateMany).toHaveBeenCalledWith({
      where: { journeyId: JOURNEY, status: { in: ['ACCEPTED', 'DECLINED'] } },
      data: { status: 'PENDING' },
    });
    // The money row is untouched: this releases a match, not a payment.
    expect(tx.escrow.updateMany).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  test('a customer who paid in the meantime is never released out from under their ride', async () => {
    tx.escrow.count.mockResolvedValue(0);

    const released = await releaseUnpaidMatch('e1', JOURNEY);

    expect(released).toBe(false);
    expect(tx.journey.updateMany).not.toHaveBeenCalled();
  });

  test('a journey that already moved on is left alone', async () => {
    tx.journey.updateMany.mockResolvedValue({ count: 0 });

    const released = await releaseUnpaidMatch('e1', JOURNEY);

    expect(released).toBe(false);
    expect(tx.bid.updateMany).not.toHaveBeenCalled();
  });
});

describe('unpaid-match reaper', () => {
  test('only considers FAILED escrows on MATCHED journeys past the grace window', async () => {
    const now = Date.parse('2026-08-07T12:00:00.000Z');
    m.escrow.findMany.mockResolvedValue([]);

    await runUnpaidMatchReaperOnce(now);

    expect(m.escrow.findMany).toHaveBeenCalledWith({
      where: {
        status: 'FAILED',
        lastChargeAttemptAt: { lt: new Date(now - UNPAID_MATCH_GRACE_MS) },
        journey: { status: 'MATCHED' },
      },
      select: { id: true, journeyId: true },
    });
  });

  test('one stranded row failing does not block its siblings', async () => {
    m.escrow.findMany.mockResolvedValue([
      { id: 'e1', journeyId: JOURNEY },
      { id: 'e2', journeyId: 'j2' },
    ]);
    m.$transaction
      .mockImplementationOnce(async () => {
        throw new Error('boom');
      })
      .mockImplementationOnce(async (fn: any) => fn(tx));

    const released = await runUnpaidMatchReaperOnce(Date.parse('2026-08-07T12:00:00.000Z'));

    expect(released).toBe(1);
  });
});
