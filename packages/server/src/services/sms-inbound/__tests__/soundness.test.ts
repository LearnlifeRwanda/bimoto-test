// SENDER-MATCH-2 G3 — the two soundness fixes, gated but fixed.
//
// Both paths are OFF in the pilot (SMS_COMMAND_TIER=safe). They are fixed
// anyway, so the day `full` opens it opens onto sound paths rather than onto
// the shape #193's census found. The journey-reply half also fixes the WEB
// path's sibling problem at its source: the composition is in
// cancelJourney, which POST /api/journeys/:id/cancel shares.

import { CancelReason, JourneyStatus } from '@prisma/client';

// ---------------------------------------------------------------------------
// 1. CANCEL's refund joins the cancellation transaction
// ---------------------------------------------------------------------------

const txCalls: string[] = [];
const state: any = {};

jest.mock('../../../prisma', () => ({
  __esModule: true,
  default: {
    journey: {
      findUnique: jest.fn(async () => state.journey),
      update: jest.fn(async () => state.journey),
    },
    $transaction: jest.fn(async (fn: any) => {
      txCalls.length = 0;
      const tx = {
        journey: {
          update: jest.fn(async () => {
            txCalls.push('journey.update');
            if (state.failAfterJourneyUpdate) throw new Error('attribution blew up');
            return { ...state.journey, status: 'CANCELLED' };
          }),
        },
        user: { update: jest.fn(async () => ({})) },
        escrow: {
          updateMany: jest.fn(async () => {
            txCalls.push('escrow.claim');
            return { count: 1 };
          }),
          findUnique: jest.fn(async () => ({ id: 'e1', status: 'REFUNDED' })),
        },
        escrowAuditLog: { create: jest.fn(async () => ({})) },
      };
      return fn(tx);
    }),
  },
}));

jest.mock('../../escrow.service', () => ({
  refundEscrow: jest.fn(async () => {
    txCalls.push('refundEscrow-STANDALONE');
    return {};
  }),
  refundEscrowTx: jest.fn(async () => {
    txCalls.push('refundEscrowTx-JOINED');
    return {};
  }),
}));

// G6(a) — was `() => ({}), { virtual: true }`, which is what made three
// tests in this file die the moment #200 added a notifyEscrowRefunded call
// to cancelJourney. Every export is now a jest.fn() by construction; see
// helpers/notification-service-mock.ts for why this shape rather than an
// enumeration.
jest.mock('../../notification.service', () =>
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('../../../__tests__/helpers/notification-service-mock').autoStubbedModule(),
);

import * as escrowService from '../../escrow.service';

describe('SENDER-MATCH-2 — CANCEL refunds inside the cancellation transaction', () => {
  let cancelJourney: any;

  beforeAll(() => {
    cancelJourney = require('../../journey.service').cancelJourney;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    txCalls.length = 0;
    state.failAfterJourneyUpdate = false;
    state.journey = {
      id: 'j1',
      customerId: 'c1',
      driverId: 'd1',
      status: JourneyStatus.MATCHED,
      matchedAt: new Date(Date.now() - 60 * 60 * 1000),
      startedAt: null,
      escrow: { id: 'e1', journeyId: 'j1', status: 'HELD', amount: 2000 },
    };
  });

  test('the JOINED variant runs and the standalone does not', async () => {
    await cancelJourney('j1', 'c1', CancelReason.CUSTOMER_CHANGED_MIND);
    expect(escrowService.refundEscrowTx).toHaveBeenCalledTimes(1);
    expect(escrowService.refundEscrow).not.toHaveBeenCalled();
  });

  test('the refund happens INSIDE the same transaction as the status change', async () => {
    await cancelJourney('j1', 'c1', CancelReason.CUSTOMER_CHANGED_MIND);
    // Both effects were recorded by the tx callback's own client — which is
    // what "one unit" means here. Before this fix the refund committed in a
    // transaction of its own, before the callback ever opened.
    expect(txCalls).toContain('journey.update');
    expect(txCalls).toContain('refundEscrowTx-JOINED');
  });

  test('the refund is passed the tx client, not the global prisma', async () => {
    await cancelJourney('j1', 'c1', CancelReason.CUSTOMER_CHANGED_MIND);
    const [txArg, escrowArg, actor] = (escrowService.refundEscrowTx as jest.Mock).mock.calls[0];
    expect(txArg).toBeDefined();
    expect(txArg.journey).toBeDefined(); // the transactional client
    expect(escrowArg).toMatchObject({ id: 'e1', status: 'HELD' });
    expect(actor).toBe('c1');
  });

  test('ROLLBACK: a failure inside the unit leaves the journey MATCHED and the escrow HELD', async () => {
    state.failAfterJourneyUpdate = true;
    await expect(
      cancelJourney('j1', 'c1', CancelReason.CUSTOMER_CHANGED_MIND),
    ).rejects.toThrow('attribution blew up');

    // The whole callback threw, so Prisma rolls the transaction back and
    // NOTHING it did survives. The user retries against an unchanged world.
    //
    // Before the composition this was the dangerous case: the refund had
    // already committed in its own transaction, so the same failure left a
    // REFUNDED escrow on a still-MATCHED journey — money returned for a ride
    // the system still believed was happening.
    expect(state.journey.status).toBe(JourneyStatus.MATCHED);
    expect(state.journey.escrow.status).toBe('HELD');
    expect(escrowService.refundEscrow).not.toHaveBeenCalled();
  });

  test('a non-MATCHED cancellation refunds nothing, as before', async () => {
    state.journey.status = JourneyStatus.REQUESTED;
    await cancelJourney('j1', 'c1', CancelReason.CUSTOMER_CHANGED_MIND);
    expect(escrowService.refundEscrowTx).not.toHaveBeenCalled();
  });

  test('a MATCHED journey with no escrow row refunds nothing and does not 404', async () => {
    state.journey.escrow = null;
    await expect(
      cancelJourney('j1', 'c1', CancelReason.CUSTOMER_CHANGED_MIND),
    ).resolves.toBeDefined();
    expect(escrowService.refundEscrowTx).not.toHaveBeenCalled();
  });
});
