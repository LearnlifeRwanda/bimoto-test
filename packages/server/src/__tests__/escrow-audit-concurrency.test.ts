// BID-ATOMICITY G5 — the audit chain under GENUINE concurrency: two
// appends racing on one escrow serialize to sequential numbers via the
// (escrowId, sequenceNumber) unique + the savepoint retry, and the chain
// still verifies.
//
// The prisma mock is a stateful store whose escrowAuditLog.create
// enforces the unique exactly as Postgres does (P2002 on a taken chain
// position). A barrier holds both appenders at their tail read so BOTH
// compute the same sequence number — the interleaving that used to fork
// the chain — and the loser must take the P2002 → rollback-to-savepoint
// → re-read → recompute path to land on the next number. (The same race
// is also proven against live Postgres in CI's migration rehearsal; this
// test pins the retry loop's logic under jest.)

jest.mock('../prisma', () => {
  const state = {
    auditRows: [] as any[],
    tailReadGate: null as (() => Promise<void>) | null,
  };
  const db: any = {
    __state: state,
    $transaction: (fn: (tx: any) => Promise<any>) => fn(db),
    $executeRawUnsafe: jest.fn(async () => 0),
    escrowAuditLog: {
      findFirst: jest.fn(async ({ where }: any) => {
        const rows = state.auditRows
          .filter((r: any) => r.escrowId === where.escrowId)
          .sort((a: any, b: any) => a.sequenceNumber - b.sequenceNumber);
        const snapshot = rows.length ? { ...rows[rows.length - 1] } : null;
        if (state.tailReadGate) await state.tailReadGate();
        return snapshot;
      }),
      create: jest.fn(async ({ data }: any) => {
        const dup = state.auditRows.some(
          (r: any) =>
            r.escrowId === data.escrowId &&
            r.sequenceNumber === data.sequenceNumber,
        );
        if (dup) {
          const err: any = new Error('Unique constraint failed');
          err.code = 'P2002';
          err.meta = { target: ['escrowId', 'sequenceNumber'] };
          throw err;
        }
        state.auditRows.push({ ...data });
        return { ...data };
      }),
      findMany: jest.fn(async ({ where }: any) =>
        state.auditRows
          .filter((r: any) => r.escrowId === where.escrowId)
          .sort((a: any, b: any) => a.sequenceNumber - b.sequenceNumber)
          .map((r: any) => ({ ...r })),
      ),
    },
  };
  return { __esModule: true, default: db };
});

import prisma from '../prisma';
import {
  appendAuditEntryTx,
  appendAuditEntry,
  verifyAuditChain,
} from '../services/escrow-audit.service';

const db = prisma as any;
const state = db.__state;

function makeBarrier(n: number): () => Promise<void> {
  let arrived = 0;
  let release: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return () => {
    arrived += 1;
    if (arrived >= n) release();
    return gate;
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  state.auditRows.length = 0;
  state.tailReadGate = null;
});

describe('two audit appends racing on one escrow', () => {
  test('sequential numbers, linked hashes, chain verifies — the loser retried instead of forking', async () => {
    state.tailReadGate = makeBarrier(2);

    await Promise.all([
      db.$transaction((tx: any) =>
        appendAuditEntryTx(tx, 'esc-1', 'CHARGE_CONFIRMED', 2000, 'webhook'),
      ),
      db.$transaction((tx: any) =>
        appendAuditEntryTx(tx, 'esc-1', 'CHARGE_CONFIRMED', 2000, 'reconciler'),
      ),
    ]);

    const rows = state.auditRows
      .filter((r: any) => r.escrowId === 'esc-1')
      .sort((a: any, b: any) => a.sequenceNumber - b.sequenceNumber);
    expect(rows.map((r: any) => r.sequenceNumber)).toEqual([0, 1]);
    expect(rows[0].previousHash).toBe('GENESIS');
    expect(rows[1].previousHash).toBe(rows[0].entryHash);

    // The losing appender really took the retry path: three creates
    // (winner + loser's failed attempt + loser's retry), and the
    // savepoint machinery ran.
    expect(db.escrowAuditLog.create).toHaveBeenCalledTimes(3);
    const raw = (db.$executeRawUnsafe as jest.Mock).mock.calls.map((c: any[]) => c[0]);
    expect(raw).toContain('ROLLBACK TO SAVEPOINT bimoto_audit_append');

    const verdict = await verifyAuditChain('esc-1');
    expect(verdict).toEqual({ valid: true, entries: 2 });
  });

  test('appendAuditEntry (non-tx variant) serializes the same way', async () => {
    state.tailReadGate = makeBarrier(2);

    await Promise.all([
      appendAuditEntry('esc-2', 'FROZEN', 500, 'admin-1'),
      appendAuditEntry('esc-2', 'FROZEN', 500, 'admin-2'),
    ]);

    const rows = state.auditRows
      .filter((r: any) => r.escrowId === 'esc-2')
      .sort((a: any, b: any) => a.sequenceNumber - b.sequenceNumber);
    expect(rows.map((r: any) => r.sequenceNumber)).toEqual([0, 1]);
    expect((await verifyAuditChain('esc-2')).valid).toBe(true);
  });

  test('retry is bounded: a position that never frees exhausts after 5 attempts', async () => {
    // A create that always conflicts — as if a hostile interleaving kept
    // stealing every recomputed position.
    (db.escrowAuditLog.create as jest.Mock).mockImplementation(async () => {
      const err: any = new Error('Unique constraint failed');
      err.code = 'P2002';
      throw err;
    });

    await expect(
      db.$transaction((tx: any) =>
        appendAuditEntryTx(tx, 'esc-3', 'RELEASED', 100, 'x'),
      ),
    ).rejects.toMatchObject({ code: 'P2002' });
    expect(db.escrowAuditLog.create).toHaveBeenCalledTimes(5);
  });

  test('non-P2002 errors are NOT retried — they propagate and roll back the caller', async () => {
    (db.escrowAuditLog.create as jest.Mock).mockImplementationOnce(async () => {
      throw new Error('db unavailable');
    });

    await expect(
      db.$transaction((tx: any) =>
        appendAuditEntryTx(tx, 'esc-4', 'RELEASED', 100, 'x'),
      ),
    ).rejects.toThrow('db unavailable');
    expect(db.escrowAuditLog.create).toHaveBeenCalledTimes(1);
  });
});
