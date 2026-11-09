// MONEY-ATOMIC-2 — the seventh money path: silence-is-consent settlement.
//
// processAutoConfirm is a SWEEP, so its atomicity has two halves and this
// file asserts both:
//
//   1. Per journey, all-or-nothing. The CONFIRMED stamp, the AUTO_CONFIRM
//      audit entry, the escrow release and both completedRides counters
//      commit together or not at all. Before this the release sat in a
//      transaction of its own and everything around it committed
//      separately, so a failing release left a terminally CONFIRMED
//      journey with the money still HELD — and since the sweep filters
//      `status: AWAITING_CONFIRMATION`, no later tick ever revisited it.
//
//   2. Per batch, isolated. One journey rolling back must NOT take the
//      others with it: the loop continues, and the next journey settles.
//      This is why the transaction is opened per journey and not around
//      the sweep — a batch-wide transaction would fix (1) and break (2).
//
// The prisma double stages each transaction's writes and keeps them only
// if the callback resolves, exactly as a real COMMIT/ROLLBACK.

import { JourneyStatus, EscrowStatus } from '@bimoto/shared';

jest.mock('../prisma', () => {
  const db: any = {};
  return { __esModule: true, default: db };
});

jest.mock('../socket', () => ({ emitToJourney: jest.fn() }));

jest.mock('../services/escrow-audit.service', () => ({
  appendAuditEntry: jest.fn().mockResolvedValue(undefined),
  appendAuditEntryTx: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../services/escrow.service', () => ({
  releaseEscrowTx: jest.fn(),
}));

jest.mock('../services/journey-validation.service', () => ({
  validateJourneyPlausibility: jest.fn().mockResolvedValue({ valid: true, flags: [] }),
}));

jest.mock('../services/sms.service', () => ({
  sendSms: jest.fn().mockResolvedValue({ success: true }),
}));

import prisma from '../prisma';
import { emitToJourney } from '../socket';
import { releaseEscrowTx } from '../services/escrow.service';
import { processAutoConfirm } from '../jobs/auto-confirm.job';

const db = prisma as any;

interface Write {
  model: string;
  id: string;
  data: any;
}

/** Committed writes, in order. Nothing lands here until a tx resolves. */
let committed: Write[];
/** Escrow rows as the sweep loaded them — untouched by a rolled-back unit. */
let escrows: Record<string, { id: string; amount: number; status: string }>;

function journeyRow(id: string, escrowId: string | null) {
  return {
    id,
    status: JourneyStatus.AWAITING_CONFIRMATION,
    endedAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
    customerInitiatedCompletion: false,
    lateCompletion: false,
    customerId: `c-${id}`,
    driverId: `d-${id}`,
    escrow: escrowId ? escrows[escrowId] : null,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  committed = [];
  escrows = {
    'e-doomed': { id: 'e-doomed', amount: 1000, status: EscrowStatus.HELD },
    'e-fine': { id: 'e-fine', amount: 2000, status: EscrowStatus.HELD },
  };

  db.journey = { findMany: jest.fn(), update: jest.fn() };
  db.user = { update: jest.fn() };
  db.escrow = { findMany: jest.fn().mockResolvedValue([]) };
  db.escrowAuditLog = { findFirst: jest.fn() };
  db.$transaction = jest.fn(async (cb: any) => {
    const staged: Write[] = [];
    const tx: any = {
      journey: {
        update: async ({ where, data }: any) => {
          staged.push({ model: 'journey', id: where.id, data });
          return { id: where.id, ...data };
        },
      },
      user: {
        update: async ({ where, data }: any) => {
          staged.push({ model: 'user', id: where.id, data });
          return {};
        },
      },
    };
    try {
      const out = await cb(tx);
      committed.push(...staged); // COMMIT
      return out;
    } catch (err) {
      throw err; // ROLLBACK: staged writes are discarded
    }
  });
});

describe('MONEY-ATOMIC-2 — auto-confirm settles per journey, all-or-nothing', () => {
  test('a failing release rolls back only its own journey; the batch keeps settling', async () => {
    (db.journey.findMany as jest.Mock)
      .mockResolvedValueOnce([journeyRow('j-doomed', 'e-doomed'), journeyRow('j-fine', 'e-fine')])
      .mockResolvedValueOnce([]); // reminder scan

    (releaseEscrowTx as jest.Mock).mockImplementation(async (_tx: any, escrow: any) => {
      if (escrow.id === 'e-doomed') throw new Error('payout gateway unreachable');
      escrows['e-fine'].status = EscrowStatus.RELEASED;
      return {};
    });

    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});

    await processAutoConfirm();

    // ---- half 1: the doomed journey committed NOTHING.
    expect(committed.filter((w) => w.id === 'j-doomed')).toHaveLength(0);
    // No CONFIRMED stamp, so the next tick's AWAITING_CONFIRMATION filter
    // still finds it — the retry the old code made impossible.
    expect(committed.some((w) => w.model === 'journey' && w.id === 'j-doomed')).toBe(false);
    // Its counters never moved either.
    expect(committed.some((w) => w.id === 'c-j-doomed' || w.id === 'd-j-doomed')).toBe(false);
    // And its escrow is untouched — still HELD, still releasable on retry.
    expect(escrows['e-doomed'].status).toBe(EscrowStatus.HELD);
    // Nothing announced a settlement that did not happen.
    expect(emitToJourney).not.toHaveBeenCalledWith('j-doomed', expect.anything(), expect.anything());

    // ---- half 2: the loop carried on and the next journey fully settled.
    expect(committed).toEqual([
      {
        model: 'journey',
        id: 'j-fine',
        data: expect.objectContaining({ status: JourneyStatus.COMPLETED }),
      },
      { model: 'user', id: 'c-j-fine', data: { completedRides: { increment: 1 } } },
      { model: 'user', id: 'd-j-fine', data: { completedRides: { increment: 1 } } },
    ]);
    expect(escrows['e-fine'].status).toBe(EscrowStatus.RELEASED);
    expect(emitToJourney).toHaveBeenCalledWith(
      'j-fine',
      expect.anything(),
      expect.objectContaining({ journeyId: 'j-fine' }),
    );

    // ---- and the log says which journey is coming back, not just that
    // something broke.
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining('left AWAITING_CONFIRMATION for retry'),
      expect.any(Error),
    );
    errorLog.mockRestore();
  });

  test('a failing completedRides counter also rolls the release back', async () => {
    (db.journey.findMany as jest.Mock)
      .mockResolvedValueOnce([journeyRow('j1', 'e-fine')])
      .mockResolvedValueOnce([]);

    (releaseEscrowTx as jest.Mock).mockResolvedValue({});
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});

    // The counter write is the LAST thing in the unit — the write that used
    // to run after the release had already committed on its own.
    db.$transaction = jest.fn(async (cb: any) => {
      const staged: Write[] = [];
      const tx: any = {
        journey: {
          update: async ({ where, data }: any) => {
            staged.push({ model: 'journey', id: where.id, data });
            return { id: where.id, ...data };
          },
        },
        user: {
          update: async () => {
            throw new Error('user row locked');
          },
        },
      };
      try {
        const out = await cb(tx);
        committed.push(...staged);
        return out;
      } catch (err) {
        throw err;
      }
    });

    await processAutoConfirm();

    expect(committed).toHaveLength(0);
    expect(releaseEscrowTx).toHaveBeenCalledTimes(1); // it ran…
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining('left AWAITING_CONFIRMATION for retry'),
      expect.any(Error),
    );
    // …but inside the unit that rolled back, so nothing it wrote survived.
    errorLog.mockRestore();
  });
});
