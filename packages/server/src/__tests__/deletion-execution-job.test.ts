// ACCOUNT-RIGHTS-CORE G5 — the execution job, and the states that make it
// wait.
//
// Every deferral case is a PAIR: the shape that must block, and the
// neighbouring shape that must not. A guard that cannot be shown to let
// the ordinary case through is not a guard, it is an outage — the
// seed-guards discipline, applied to erasure.

jest.mock('../prisma', () => {
  const db: any = {
    deletionRequest: { findMany: jest.fn(), update: jest.fn() },
    journey: { findFirst: jest.fn(async () => null) },
    escrow: { findFirst: jest.fn(async () => null) },
    emergencyAlert: { findFirst: jest.fn(async () => null) },
    user: { findUnique: jest.fn(async () => ({ frozenAt: null })) },
    driverBalance: { findUnique: jest.fn(async () => null) },
    // CUTGUARD v2 G5 — the three the obligation audit added.
    bid: { findFirst: jest.fn(async () => null) },
    driverPayoutBatch: { findFirst: jest.fn(async () => null) },
    payoutPreferenceChangeLog: { findFirst: jest.fn(async () => null) },
  };
  return { __esModule: true, default: db };
});

jest.mock('../services/job-lock', () => ({
  withJobLock: jest.fn(async (_name: string, fn: any) => fn()),
}));

jest.mock('../services/account-deletion.service', () => ({
  executeErasure: jest.fn(async () => ({
    documentUrls: [],
    revokedTokenCount: 0,
    deletionCount: 1,
  })),
}));

import { EscrowStatus, JourneyStatus } from '@prisma/client';
import prisma from '../prisma';
import {
  LIVE_ESCROW_STATUSES,
  NON_TERMINAL_JOURNEY_STATUSES,
  TERMINAL_JOURNEY_STATUSES,
  collectBlockingFacts,
  firstBlockingReason,
  processDeletionExecutions,
  startDeletionExecutionJob,
  stopDeletionExecutionJob,
} from '../jobs/deletion-execution.job';
import { executeErasure } from '../services/account-deletion.service';

const db = prisma as any;
const USER = 'u1';
const REQUEST = { id: 'dr1', userId: USER, deferredReason: null as string | null };

const CLEAR: Parameters<typeof firstBlockingReason>[0] = {
  hasNonTerminalJourney: false,
  hasLiveEscrow: false,
  hasOpenBid: false,
  hasUnresolvedEmergency: false,
  isFrozen: false,
  driverBalance: null,
  hasInFlightPayout: false,
  hasScheduledPayout: false,
};

function dueRow(overrides: Partial<typeof REQUEST> = {}) {
  db.deletionRequest.findMany.mockResolvedValue([{ ...REQUEST, ...overrides }]);
}

function clearBlockers() {
  db.journey.findFirst.mockResolvedValue(null);
  db.escrow.findFirst.mockResolvedValue(null);
  db.emergencyAlert.findFirst.mockResolvedValue(null);
  db.user.findUnique.mockResolvedValue({ frozenAt: null });
  db.driverBalance.findUnique.mockResolvedValue(null);
  db.bid.findFirst.mockResolvedValue(null);
  db.driverPayoutBatch.findFirst.mockResolvedValue(null);
  db.payoutPreferenceChangeLog.findFirst.mockResolvedValue(null);
}

beforeEach(() => {
  jest.clearAllMocks();
  clearBlockers();
  db.deletionRequest.findMany.mockResolvedValue([]);
  db.deletionRequest.update.mockResolvedValue({});
});

/* -------------------------------------- the status partition ---------- */

describe('the journey-status partition is derived, not listed', () => {
  test('terminal and non-terminal together cover the enum exactly, with no overlap', () => {
    const all = Object.values(JourneyStatus).sort();
    const union = [...TERMINAL_JOURNEY_STATUSES, ...NON_TERMINAL_JOURNEY_STATUSES].sort();
    expect(union).toEqual(all);
    for (const s of TERMINAL_JOURNEY_STATUSES) {
      expect(NON_TERMINAL_JOURNEY_STATUSES).not.toContain(s);
    }
  });

  test('the three terminal states are the three the schema calls terminal', () => {
    expect([...TERMINAL_JOURNEY_STATUSES].sort()).toEqual(
      ['CANCELLED', 'COMPLETED', 'EXPIRED'],
    );
  });

  test('every other state blocks — including the seven named in the census', () => {
    for (const s of [
      'SCHEDULED',
      'REQUESTED',
      'MATCHED',
      'IN_PROGRESS',
      'AWAITING_CONFIRMATION',
      'INTERRUPTED',
      'DISPUTED',
    ]) {
      expect(NON_TERMINAL_JOURNEY_STATUSES).toContain(s);
    }
  });

  test('live-money escrow states are PENDING, HELD and FROZEN — and not the settled ones', () => {
    expect([...LIVE_ESCROW_STATUSES].sort()).toEqual(['FROZEN', 'HELD', 'PENDING']);
    for (const settled of [
      EscrowStatus.RELEASED,
      EscrowStatus.REFUNDED,
      EscrowStatus.FAILED,
    ]) {
      expect(LIVE_ESCROW_STATUSES).not.toContain(settled);
    }
  });
});

/* --------------------------------- the deferral matrix, both ways ----- */

describe('firstBlockingReason — each blocker, and the clear case beside it', () => {
  test('nothing in the way returns null — the ordinary erasure is NOT blocked', () => {
    expect(firstBlockingReason(CLEAR)).toBeNull();
  });

  test('a non-terminal journey blocks', () => {
    expect(firstBlockingReason({ ...CLEAR, hasNonTerminalJourney: true })).toBe(
      'NON_TERMINAL_JOURNEY',
    );
  });

  test('a live escrow blocks', () => {
    expect(firstBlockingReason({ ...CLEAR, hasLiveEscrow: true })).toBe('LIVE_ESCROW');
  });

  test('an unresolved emergency blocks', () => {
    expect(firstBlockingReason({ ...CLEAR, hasUnresolvedEmergency: true })).toBe(
      'UNRESOLVED_EMERGENCY',
    );
  });

  test('a freeze blocks', () => {
    expect(firstBlockingReason({ ...CLEAR, isFrozen: true })).toBe('ACCOUNT_FROZEN');
  });

  test('a positive driver balance blocks', () => {
    expect(firstBlockingReason({ ...CLEAR, driverBalance: 5000 })).toBe(
      'POSITIVE_DRIVER_BALANCE',
    );
  });

  test('a ZERO balance does not block — a settled driver is erasable', () => {
    expect(firstBlockingReason({ ...CLEAR, driverBalance: 0 })).toBeNull();
  });

  test('NO balance row does not block — a passenger has never had one', () => {
    expect(firstBlockingReason({ ...CLEAR, driverBalance: null })).toBeNull();
  });

  test('with several blockers the ride is reported first', () => {
    expect(
      firstBlockingReason({
        ...CLEAR,
        hasNonTerminalJourney: true,
        hasLiveEscrow: true,
        isFrozen: true,
      }),
    ).toBe('NON_TERMINAL_JOURNEY');
  });
});

describe('collectBlockingFacts — the queries behind the facts', () => {
  test('asks about journeys on BOTH sides, customer and driver', async () => {
    await collectBlockingFacts(USER);
    expect(db.journey.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: NON_TERMINAL_JOURNEY_STATUSES },
          OR: [{ customerId: USER }, { driverId: USER }],
        }),
      }),
    );
  });

  test('asks about escrows on BOTH sides too', async () => {
    await collectBlockingFacts(USER);
    expect(db.escrow.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: LIVE_ESCROW_STATUSES },
          OR: [{ customerId: USER }, { driverId: USER }],
        }),
      }),
    );
  });

  test('asks only about emergencies this user RAISED, and only ACTIVE ones', async () => {
    await collectBlockingFacts(USER);
    expect(db.emergencyAlert.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { raisedById: USER, status: 'ACTIVE' },
      }),
    );
  });

  test('a clear user produces clear facts', async () => {
    await expect(collectBlockingFacts(USER)).resolves.toEqual(CLEAR);
  });
});

/* --------------------------------------- the sweep, end to end -------- */

describe('processDeletionExecutions — defers, never force-executes', () => {
  test('a due row with nothing in the way is erased', async () => {
    dueRow();
    await processDeletionExecutions();
    expect(executeErasure).toHaveBeenCalledWith(USER);
  });

  test('a due row with a live journey is NOT erased, and the reason is written', async () => {
    dueRow();
    db.journey.findFirst.mockResolvedValue({ id: 'j1' });

    await processDeletionExecutions();

    expect(executeErasure).not.toHaveBeenCalled();
    expect(db.deletionRequest.update).toHaveBeenCalledWith({
      where: { id: 'dr1' },
      data: { deferredReason: 'NON_TERMINAL_JOURNEY' },
    });
  });

  test('completing that journey unblocks it: the next tick erases and clears the reason', async () => {
    // Same row, now carrying yesterday's reason, with the journey gone.
    dueRow({ deferredReason: 'NON_TERMINAL_JOURNEY' });
    db.journey.findFirst.mockResolvedValue(null);

    await processDeletionExecutions();

    expect(db.deletionRequest.update).toHaveBeenCalledWith({
      where: { id: 'dr1' },
      data: { deferredReason: null },
    });
    expect(executeErasure).toHaveBeenCalledWith(USER);
  });

  test('a row blocked on the SAME reason is not rewritten every tick', async () => {
    dueRow({ deferredReason: 'LIVE_ESCROW' });
    db.escrow.findFirst.mockResolvedValue({ id: 'e1' });

    await processDeletionExecutions();

    expect(executeErasure).not.toHaveBeenCalled();
    expect(db.deletionRequest.update).not.toHaveBeenCalled();
  });

  test('a deferral never cancels and never force-executes the row', async () => {
    dueRow();
    db.emergencyAlert.findFirst.mockResolvedValue({ id: 'ea1' });

    await processDeletionExecutions();

    expect(executeErasure).not.toHaveBeenCalled();
    // The only write is the reason. Status is untouched, so the row stays
    // PENDING and the next tick retries it — for as long as it takes.
    const writes = db.deletionRequest.update.mock.calls.map((c: any) => c[0].data);
    for (const w of writes) {
      expect(w).not.toHaveProperty('status');
      expect(w).not.toHaveProperty('cancelledAt');
    }
  });

  test('only rows whose clock has actually run out are swept', async () => {
    await processDeletionExecutions();
    expect(db.deletionRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'PENDING', executesAt: { lte: expect.any(Date) } },
      }),
    );
  });

  test('one failing account does not abandon the sweep for the ones behind it', async () => {
    db.deletionRequest.findMany.mockResolvedValue([
      { id: 'dr1', userId: 'bad', deferredReason: null },
      { id: 'dr2', userId: 'good', deferredReason: null },
    ]);
    (executeErasure as jest.Mock)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ documentUrls: [], revokedTokenCount: 0, deletionCount: 1 });

    await expect(processDeletionExecutions()).resolves.toBeUndefined();

    expect(executeErasure).toHaveBeenCalledTimes(2);
    expect(executeErasure).toHaveBeenLastCalledWith('good');
  });

  test('a row deferred for a long time keeps retrying — nothing expires it', async () => {
    dueRow({ deferredReason: 'POSITIVE_DRIVER_BALANCE' });
    db.driverBalance.findUnique.mockResolvedValue({ pendingAmount: 12000 });

    for (let tick = 0; tick < 3; tick++) await processDeletionExecutions();

    expect(executeErasure).not.toHaveBeenCalled();
    // Still PENDING and still swept on every tick.
    expect(db.deletionRequest.findMany).toHaveBeenCalledTimes(3);
  });
});

describe('the job wrapper', () => {
  afterEach(() => stopDeletionExecutionJob());

  test('start runs a tick immediately and stop clears the timer', async () => {
    jest.useFakeTimers();
    startDeletionExecutionJob();
    await Promise.resolve();
    expect(db.deletionRequest.findMany).toHaveBeenCalled();
    stopDeletionExecutionJob();
    jest.clearAllTimers();
    jest.useRealTimers();
  });
});


/* ================================================== CUTGUARD v2 G5 ======== */
//
// B-4's reproduction, inverted. The bug was reproduced in the field as
// "PENDING bid survives erasure; passenger accepts from Deleted User;
// money HELD". These are the same three moments with the outcome the
// other way round.

describe('B-4 — a driver with an open bid is not erased', () => {
  test('a PENDING bid defers the sweep, and the row says why', async () => {
    dueRow();
    clearBlockers();
    db.bid.findFirst.mockResolvedValue({ id: 'b-live' });

    await processDeletionExecutions();

    expect(executeErasure).not.toHaveBeenCalled();
    expect(db.deletionRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'dr1' },
        data: { deferredReason: 'OPEN_BID' },
      }),
    );
  });

  test('the sweep asks only about LIVE bid statuses', async () => {
    dueRow();
    clearBlockers();
    await processDeletionExecutions();

    const where = db.bid.findFirst.mock.calls[0][0].where;
    expect(where.driverId).toBe(USER);
    // DECLINED / WITHDRAWN / EXPIRED are somebody else's ride or nobody's;
    // they must not hold an erasure open forever.
    expect(where.status.in).toEqual(expect.arrayContaining(['PENDING', 'ACCEPTED']));
    expect(where.status.in).not.toContain('EXPIRED');
    expect(where.status.in).not.toContain('WITHDRAWN');
  });

  test('once the bid is gone, the NEXT sweep erases him', async () => {
    // The other half of the pair: a guard that cannot be shown to let the
    // ordinary case through is an outage, not a guard.
    dueRow({ deferredReason: 'OPEN_BID' });
    clearBlockers();

    await processDeletionExecutions();

    expect(executeErasure).toHaveBeenCalledWith(USER);
    // And the stale reason is cleared BEFORE the erasure, so an executed
    // row does not carry yesterday's explanation into its final state.
    expect(db.deletionRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { deferredReason: null } }),
    );
  });
});

describe('money already moving also defers', () => {
  test('a PENDING payout batch defers with IN_FLIGHT_PAYOUT', async () => {
    dueRow();
    clearBlockers();
    db.driverPayoutBatch.findFirst.mockResolvedValue({ id: 'batch-1' });

    await processDeletionExecutions();

    expect(executeErasure).not.toHaveBeenCalled();
    expect(db.deletionRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { deferredReason: 'IN_FLIGHT_PAYOUT' } }),
    );
  });

  test('a booked preference-change payout defers with SCHEDULED_PAYOUT', async () => {
    dueRow();
    clearBlockers();
    db.payoutPreferenceChangeLog.findFirst.mockResolvedValue({ id: 'log-1' });

    await processDeletionExecutions();

    expect(executeErasure).not.toHaveBeenCalled();
    expect(db.deletionRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { deferredReason: 'SCHEDULED_PAYOUT' } }),
    );
  });

  test('an anomaly-blocked row (no due date) is NOT an obligation', async () => {
    dueRow();
    clearBlockers();
    await processDeletionExecutions();

    const where = db.payoutPreferenceChangeLog.findFirst.mock.calls[0][0].where;
    expect(where.payoutFired).toBe(false);
    // `payoutDueAt: { not: null }` — the job never fires a null-due row,
    // so it is not money booked to move and must not hold an erasure open
    // indefinitely.
    expect(where.payoutDueAt).toEqual({ not: null });
  });
});

describe('the five original facts still defer — nothing was traded away', () => {
  const cases: Array<[string, () => void, string]> = [
    ['non-terminal journey', () => db.journey.findFirst.mockResolvedValue({ id: 'j' }), 'NON_TERMINAL_JOURNEY'],
    ['live escrow', () => db.escrow.findFirst.mockResolvedValue({ id: 'e' }), 'LIVE_ESCROW'],
    ['active emergency', () => db.emergencyAlert.findFirst.mockResolvedValue({ id: 'a' }), 'UNRESOLVED_EMERGENCY'],
    ['frozen account', () => db.user.findUnique.mockResolvedValue({ frozenAt: new Date() }), 'ACCOUNT_FROZEN'],
    ['positive balance', () => db.driverBalance.findUnique.mockResolvedValue({ pendingAmount: 500 }), 'POSITIVE_DRIVER_BALANCE'],
  ];

  test.each(cases)('%s still defers', async (_name, arrange, reason) => {
    dueRow();
    clearBlockers();
    arrange();

    await processDeletionExecutions();

    expect(executeErasure).not.toHaveBeenCalled();
    expect(db.deletionRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { deferredReason: reason } }),
    );
  });
});
