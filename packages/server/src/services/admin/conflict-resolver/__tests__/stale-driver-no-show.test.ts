// R3-STALE-NO-SHOW-WIRING-FIX — staleDriverNoShowModule.decide(RESOLVED_REFUND)
// now settles: escrow HELD → REFUNDED + journey MATCHED → CANCELLED + a
// cross-linked ADMIN_STALE_DRIVER_NO_SHOW_REFUND audit entry. NO_ACTION /
// FORCE_COMPLETE stay audit-only, and the settlement is guarded on the
// runtime-actual escrow/journey states.

import { staleDriverNoShowModule } from '../conflicts/stale-driver-no-show';
import { refundMomo } from '../../../payment/refund';

// R3-FLW-STALE-NO-SHOW-REFUND-INTEGRATION — decide(RESOLVED_REFUND) now fires
// the Flutterwave refund gateway before the transaction. Mock it so unit tests
// never hit a real (or stub) gateway and can assert the call / skip behaviour.
jest.mock('../../../payment/refund', () => ({ refundMomo: jest.fn() }));
const mockRefundMomo = refundMomo as jest.Mock;

function buildPrisma() {
  const adminActionRows: any[] = [];
  const escrowAuditRows: any[] = [];
  const journeys = new Map<string, any>();
  const escrows = new Map<string, any>(); // keyed by journeyId
  const bids = new Map<string, any>();

  const tx: any = {
    bid: {
      findUnique: jest.fn(async ({ where, include }: any) => {
        const b = bids.get(where.id);
        if (!b) return null;
        const out = { ...b };
        if (include?.journey) {
          const j = journeys.get(b.journeyId);
          out.journey = j
            ? { ...j, escrow: include.journey.include?.escrow ? escrows.get(b.journeyId) ?? null : undefined }
            : null;
        }
        return out;
      }),
    },
    journey: {
      update: jest.fn(async ({ where, data }: any) => {
        const updated = { ...journeys.get(where.id), ...data };
        journeys.set(where.id, updated);
        return updated;
      }),
    },
    escrow: {
      findUnique: jest.fn(async ({ where }: any) => escrows.get(where.journeyId) ?? null),
      update: jest.fn(async ({ where, data }: any) => {
        const updated = { ...escrows.get(where.journeyId), ...data };
        escrows.set(where.journeyId, updated);
        return updated;
      }),
      // G2 single-winner claim: honors the status predicate like Postgres.
      updateMany: jest.fn(async ({ where, data }: any) => {
        const row = escrows.get(where.journeyId);
        if (!row || (where.status !== undefined && row.status !== where.status)) {
          return { count: 0 };
        }
        escrows.set(where.journeyId, { ...row, ...data });
        return { count: 1 };
      }),
    },
    escrowAuditLog: {
      findFirst: jest.fn(async () =>
        escrowAuditRows.length === 0 ? null : escrowAuditRows[escrowAuditRows.length - 1],
      ),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `ea-${escrowAuditRows.length + 1}`, ...data };
        escrowAuditRows.push(row);
        return row;
      }),
    },
    adminAction: {
      findFirst: jest.fn(async () =>
        adminActionRows.length === 0 ? null : adminActionRows[adminActionRows.length - 1],
      ),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `aa-${adminActionRows.length + 1}`, ...data };
        adminActionRows.push(row);
        return row;
      }),
    },
  };
  const prisma = { ...tx, $transaction: jest.fn(async (fn: any) => fn(tx)) };
  return { prisma, journeys, escrows, bids, adminActionRows, escrowAuditRows };
}

function seedStale(
  journeys: Map<string, any>,
  escrows: Map<string, any>,
  bids: Map<string, any>,
  {
    journeyStatus = 'MATCHED',
    escrowStatus = 'HELD',
    flwTxId = null,
  }: { journeyStatus?: string; escrowStatus?: string; flwTxId?: string | null } = {},
) {
  journeys.set('j1', { id: 'j1', status: journeyStatus });
  escrows.set('j1', {
    id: 'e-1',
    journeyId: 'j1',
    status: escrowStatus,
    amount: 1500,
    driverId: 'd1',
    driverPayout: 1200,
    customerId: 'c1',
    flwTxId,
  });
  bids.set('b1', { id: 'b1', driverId: 'd1', journeyId: 'j1' });
}

const reason = 'e2e admin decision: driver ghosted, refund the customer';

describe('staleDriverNoShow decide() — settlement (R3-STALE-NO-SHOW-WIRING-FIX)', () => {
  test('RESOLVED_REFUND writes the ADMIN_STALE_DRIVER_NO_SHOW_REFUND audit entry', async () => {
    const { prisma, journeys, escrows, bids, escrowAuditRows } = buildPrisma();
    seedStale(journeys, escrows, bids);
    await staleDriverNoShowModule.decide(
      { id: 'b1', decision: 'RESOLVED_REFUND', reason, adminId: 'admin-1' },
      prisma,
    );
    const actions = escrowAuditRows.map((r) => r.action);
    expect(actions).toContain('ADMIN_STALE_DRIVER_NO_SHOW_REFUND');
  });

  test('RESOLVED_REFUND flips escrow HELD -> REFUNDED', async () => {
    const { prisma, journeys, escrows, bids } = buildPrisma();
    seedStale(journeys, escrows, bids);
    await staleDriverNoShowModule.decide(
      { id: 'b1', decision: 'RESOLVED_REFUND', reason, adminId: 'admin-1' },
      prisma,
    );
    expect(escrows.get('j1').status).toBe('REFUNDED');
  });

  test('RESOLVED_REFUND flips journey MATCHED -> CANCELLED', async () => {
    const { prisma, journeys, escrows, bids } = buildPrisma();
    seedStale(journeys, escrows, bids);
    await staleDriverNoShowModule.decide(
      { id: 'b1', decision: 'RESOLVED_REFUND', reason, adminId: 'admin-1' },
      prisma,
    );
    expect(journeys.get('j1').status).toBe('CANCELLED');
  });

  test('RESOLVED_REFUND writes audit + escrow + journey + AdminAction atomically, cross-linked', async () => {
    const { prisma, journeys, escrows, bids, adminActionRows, escrowAuditRows } = buildPrisma();
    seedStale(journeys, escrows, bids);
    await staleDriverNoShowModule.decide(
      { id: 'b1', decision: 'RESOLVED_REFUND', reason, adminId: 'admin-1' },
      prisma,
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(adminActionRows).toHaveLength(1);
    expect(adminActionRows[0].action).toBe('RESOLVE_STALE_DRIVER_NO_SHOW');
    expect(adminActionRows[0].targetType).toBe('BID');
    // Cross-link points at the domain-specific entry (written before REFUNDED).
    expect(adminActionRows[0].crossLinkedEscrowAuditLogId).toBe('ea-1');
    const actions = escrowAuditRows.map((r) => r.action);
    expect(actions).toEqual(['ADMIN_STALE_DRIVER_NO_SHOW_REFUND', 'REFUNDED']);
    expect(escrows.get('j1').status).toBe('REFUNDED');
    expect(journeys.get('j1').status).toBe('CANCELLED');
  });

  test('NO_ACTION does NOT change escrow or journey state (audit-only)', async () => {
    const { prisma, journeys, escrows, bids, adminActionRows, escrowAuditRows } = buildPrisma();
    seedStale(journeys, escrows, bids);
    await staleDriverNoShowModule.decide(
      { id: 'b1', decision: 'NO_ACTION', reason, adminId: 'admin-1' },
      prisma,
    );
    expect(escrows.get('j1').status).toBe('HELD');
    expect(journeys.get('j1').status).toBe('MATCHED');
    expect(escrowAuditRows).toHaveLength(0);
    expect(adminActionRows).toHaveLength(1);
  });

  test('FORCE_COMPLETE does NOT change escrow or journey state (audit-only; semantic ambiguity flagged in PR)', async () => {
    const { prisma, journeys, escrows, bids, escrowAuditRows } = buildPrisma();
    seedStale(journeys, escrows, bids);
    await staleDriverNoShowModule.decide(
      { id: 'b1', decision: 'FORCE_COMPLETE', reason, adminId: 'admin-1' },
      prisma,
    );
    expect(escrows.get('j1').status).toBe('HELD');
    expect(journeys.get('j1').status).toBe('MATCHED');
    expect(escrowAuditRows).toHaveLength(0);
  });

  test('RESOLVED_REFUND is a safe no-op on settlement if a race left the journey non-MATCHED', async () => {
    const { prisma, journeys, escrows, bids, adminActionRows, escrowAuditRows } = buildPrisma();
    // Driver actually started after the conflict surfaced → not a real no-show.
    seedStale(journeys, escrows, bids, { journeyStatus: 'IN_PROGRESS' });
    await staleDriverNoShowModule.decide(
      { id: 'b1', decision: 'RESOLVED_REFUND', reason, adminId: 'admin-1' },
      prisma,
    );
    // No settlement applied; AdminAction still recorded.
    expect(escrows.get('j1').status).toBe('HELD');
    expect(journeys.get('j1').status).toBe('IN_PROGRESS');
    expect(escrowAuditRows).toHaveLength(0);
    expect(adminActionRows).toHaveLength(1);
    // appendAdminActionTx normalizes the absent cross-link to null.
    expect(adminActionRows[0].crossLinkedEscrowAuditLogId ?? null).toBeNull();
  });

  test('RESOLVED_REFUND is a safe no-op on settlement if escrow already left HELD', async () => {
    const { prisma, journeys, escrows, bids, escrowAuditRows } = buildPrisma();
    seedStale(journeys, escrows, bids, { escrowStatus: 'REFUNDED' });
    await staleDriverNoShowModule.decide(
      { id: 'b1', decision: 'RESOLVED_REFUND', reason, adminId: 'admin-1' },
      prisma,
    );
    expect(escrows.get('j1').status).toBe('REFUNDED'); // unchanged
    expect(journeys.get('j1').status).toBe('MATCHED'); // unchanged
    expect(escrowAuditRows).toHaveLength(0);
  });
});

describe('staleDriverNoShow decide() — Flutterwave refund (R3-FLW-STALE-NO-SHOW-REFUND-INTEGRATION)', () => {
  beforeEach(() => {
    mockRefundMomo.mockReset();
    mockRefundMomo.mockResolvedValue({ flwRefundTxId: 'flw-refund-xyz', status: 'SUCCESS' });
    delete process.env.E2E_FAKE_PAYMENTS;
  });
  afterAll(() => {
    delete process.env.E2E_FAKE_PAYMENTS;
  });

  test('calls refundMomo with the escrow flwTxId + amount when a real charge exists', async () => {
    const { prisma, journeys, escrows, bids } = buildPrisma();
    seedStale(journeys, escrows, bids, { flwTxId: 'flw-orig-1' });
    await staleDriverNoShowModule.decide(
      { id: 'b1', decision: 'RESOLVED_REFUND', reason, adminId: 'admin-1' },
      prisma,
    );
    expect(mockRefundMomo).toHaveBeenCalledTimes(1);
    expect(mockRefundMomo).toHaveBeenCalledWith({
      flwTxId: 'flw-orig-1',
      amount: 1500,
      escrowId: 'e-1',
      reason,
    });
    // Settlement still applied.
    expect(escrows.get('j1').status).toBe('REFUNDED');
    expect(journeys.get('j1').status).toBe('CANCELLED');
  });

  test('records flwRefundTxId in the REFUNDED EscrowAuditLog metadata', async () => {
    const { prisma, journeys, escrows, bids, escrowAuditRows } = buildPrisma();
    seedStale(journeys, escrows, bids, { flwTxId: 'flw-orig-1' });
    await staleDriverNoShowModule.decide(
      { id: 'b1', decision: 'RESOLVED_REFUND', reason, adminId: 'admin-1' },
      prisma,
    );
    const refundedEntry = escrowAuditRows.find((r) => r.action === 'REFUNDED');
    expect(refundedEntry).toBeTruthy();
    expect(refundedEntry.metadata).toEqual({ flwRefundTxId: 'flw-refund-xyz' });
  });

  test('skips refundMomo when E2E_FAKE_PAYMENTS=1', async () => {
    process.env.E2E_FAKE_PAYMENTS = '1';
    const { prisma, journeys, escrows, bids } = buildPrisma();
    seedStale(journeys, escrows, bids, { flwTxId: 'flw-orig-1' });
    await staleDriverNoShowModule.decide(
      { id: 'b1', decision: 'RESOLVED_REFUND', reason, adminId: 'admin-1' },
      prisma,
    );
    expect(mockRefundMomo).not.toHaveBeenCalled();
    // Settlement still applies (system-side refund, no gateway).
    expect(escrows.get('j1').status).toBe('REFUNDED');
    expect(journeys.get('j1').status).toBe('CANCELLED');
  });

  test('skips refundMomo when escrow.flwTxId is null', async () => {
    const { prisma, journeys, escrows, bids } = buildPrisma();
    seedStale(journeys, escrows, bids, { flwTxId: null });
    await staleDriverNoShowModule.decide(
      { id: 'b1', decision: 'RESOLVED_REFUND', reason, adminId: 'admin-1' },
      prisma,
    );
    expect(mockRefundMomo).not.toHaveBeenCalled();
    expect(escrows.get('j1').status).toBe('REFUNDED'); // system-side settlement still runs
  });

  test("skips refundMomo when escrow.flwTxId is a synthetic 'e2e-' id", async () => {
    const { prisma, journeys, escrows, bids } = buildPrisma();
    seedStale(journeys, escrows, bids, { flwTxId: 'e2e-e-1-123456' });
    await staleDriverNoShowModule.decide(
      { id: 'b1', decision: 'RESOLVED_REFUND', reason, adminId: 'admin-1' },
      prisma,
    );
    expect(mockRefundMomo).not.toHaveBeenCalled();
    expect(escrows.get('j1').status).toBe('REFUNDED');
  });

  test('rolls back entirely when refundMomo throws (no state change, no audit, no AdminAction)', async () => {
    mockRefundMomo.mockRejectedValue(new Error('GATEWAY_DOWN'));
    const { prisma, journeys, escrows, bids, adminActionRows, escrowAuditRows } = buildPrisma();
    seedStale(journeys, escrows, bids, { flwTxId: 'flw-orig-1' });
    await expect(
      staleDriverNoShowModule.decide(
        { id: 'b1', decision: 'RESOLVED_REFUND', reason, adminId: 'admin-1' },
        prisma,
      ),
    ).rejects.toThrow('GATEWAY_DOWN');
    // Gateway fires before the transaction — nothing was written.
    expect(escrows.get('j1').status).toBe('HELD');
    expect(journeys.get('j1').status).toBe('MATCHED');
    expect(adminActionRows).toHaveLength(0);
    expect(escrowAuditRows).toHaveLength(0);
  });

  test('does not call refundMomo on the guard no-op (journey already started)', async () => {
    const { prisma, journeys, escrows, bids } = buildPrisma();
    seedStale(journeys, escrows, bids, { journeyStatus: 'IN_PROGRESS', flwTxId: 'flw-orig-1' });
    await staleDriverNoShowModule.decide(
      { id: 'b1', decision: 'RESOLVED_REFUND', reason, adminId: 'admin-1' },
      prisma,
    );
    // Not a real no-show → no gateway refund, no settlement.
    expect(mockRefundMomo).not.toHaveBeenCalled();
    expect(escrows.get('j1').status).toBe('HELD');
    expect(journeys.get('j1').status).toBe('IN_PROGRESS');
  });
});
