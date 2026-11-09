// R3-RECONCILIATION-WIRING-FIX (Group 3) — journeyReconciliationModule.decide()
// now applies settlement (escrow + journey status flips) for RESOLVED_REFUND /
// RESOLVED_PAY, while RESOLVED_SPLIT / NO_ACTION stay audit-only.

import { journeyReconciliationModule } from '../conflicts/journey-reconciliation';
import { refundMomo } from '../../../payment/refund';

// R3-FLW-REFUND-INTEGRATION — decide(RESOLVED_REFUND) now calls the Flutterwave
// refund gateway before the transaction. Mock it so unit tests never hit a real
// (or stub) gateway and can assert the call / skip behaviour.
jest.mock('../../../payment/refund', () => ({ refundMomo: jest.fn() }));
const mockRefundMomo = refundMomo as jest.Mock;

function buildPrisma() {
  const adminActionRows: any[] = [];
  const escrowAuditRows: any[] = [];
  const journeys = new Map<string, any>();
  const escrows = new Map<string, any>(); // keyed by journeyId

  const tx: any = {
    journey: {
      findUnique: jest.fn(async ({ where, include }: any) => {
        const j = journeys.get(where.id);
        if (!j) return null;
        const out = { ...j };
        if (include?.escrow) out.escrow = escrows.get(where.id) ?? null;
        return out;
      }),
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
    driverProfile: { update: jest.fn(async () => ({})) },
    user: { update: jest.fn(async () => ({})) },
    driverBalance: { upsert: jest.fn(async () => ({})) },
  };
  const prisma = { ...tx, $transaction: jest.fn(async (fn: any) => fn(tx)) };
  return { prisma, journeys, escrows, adminActionRows, escrowAuditRows };
}

function seedDisputed(
  journeys: Map<string, any>,
  escrows: Map<string, any>,
  id = 'j1',
  flwTxId: string | null = null,
) {
  journeys.set(id, {
    id,
    status: 'DISPUTED',
    pickupName: 'A',
    destinationName: 'B',
    customerId: 'c1',
    driverId: 'd1',
  });
  escrows.set(id, {
    id: 'e-1',
    journeyId: id,
    amount: 5000,
    driverPayout: 4000,
    status: 'FROZEN',
    driverId: 'd1',
    customerId: 'c1',
    flwTxId,
  });
}

const reason = 'e2e admin decision: resolving disputed journey';

describe('journey-reconciliation decide() — settlement (R3-RECONCILIATION-WIRING-FIX)', () => {
  test('RESOLVED_REFUND flips journey DISPUTED -> CANCELLED via state machine', async () => {
    const { prisma, journeys, escrows } = buildPrisma();
    seedDisputed(journeys, escrows);
    await journeyReconciliationModule.decide(
      { id: 'j1', decision: 'RESOLVED_REFUND', reason, adminId: 'admin-1' },
      prisma,
    );
    expect(journeys.get('j1').status).toBe('CANCELLED');
  });

  test('RESOLVED_REFUND flips escrow FROZEN -> REFUNDED via escrow service', async () => {
    const { prisma, journeys, escrows } = buildPrisma();
    seedDisputed(journeys, escrows);
    await journeyReconciliationModule.decide(
      { id: 'j1', decision: 'RESOLVED_REFUND', reason, adminId: 'admin-1' },
      prisma,
    );
    expect(escrows.get('j1').status).toBe('REFUNDED');
  });

  test('RESOLVED_PAY flips journey -> COMPLETED and escrow -> RELEASED', async () => {
    const { prisma, journeys, escrows } = buildPrisma();
    seedDisputed(journeys, escrows);
    await journeyReconciliationModule.decide(
      { id: 'j1', decision: 'RESOLVED_PAY', reason, adminId: 'admin-1' },
      prisma,
    );
    expect(journeys.get('j1').status).toBe('COMPLETED');
    expect(escrows.get('j1').status).toBe('RELEASED');
  });

  test('RESOLVED_SPLIT does NOT flip status (audit-only, TODO marker in source)', async () => {
    const { prisma, journeys, escrows } = buildPrisma();
    seedDisputed(journeys, escrows);
    await journeyReconciliationModule.decide(
      { id: 'j1', decision: 'RESOLVED_SPLIT', reason, adminId: 'admin-1' },
      prisma,
    );
    expect(journeys.get('j1').status).toBe('DISPUTED');
    expect(escrows.get('j1').status).toBe('FROZEN');
  });

  test('NO_ACTION does NOT flip status (journey stays DISPUTED, escrow stays FROZEN)', async () => {
    const { prisma, journeys, escrows } = buildPrisma();
    seedDisputed(journeys, escrows);
    await journeyReconciliationModule.decide(
      { id: 'j1', decision: 'NO_ACTION', reason, adminId: 'admin-1' },
      prisma,
    );
    expect(journeys.get('j1').status).toBe('DISPUTED');
    expect(escrows.get('j1').status).toBe('FROZEN');
  });

  test('RESOLVED_REFUND writes EscrowAuditLog + journey + escrow + AdminAction atomically', async () => {
    const { prisma, journeys, escrows, adminActionRows, escrowAuditRows } = buildPrisma();
    seedDisputed(journeys, escrows);
    await journeyReconciliationModule.decide(
      { id: 'j1', decision: 'RESOLVED_REFUND', reason, adminId: 'admin-1' },
      prisma,
    );
    // Single transaction wraps everything.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    // AdminAction appended, cross-linked to the ADMIN_RESOLVED_REFUND audit entry.
    expect(adminActionRows).toHaveLength(1);
    expect(adminActionRows[0].action).toBe('RESOLVE_JOURNEY_RECONCILIATION');
    expect(adminActionRows[0].conflictDecision).toBe('RESOLVED_REFUND');
    expect(adminActionRows[0].crossLinkedEscrowAuditLogId).toBe('ea-1');
    // Two escrow-audit entries: the admin decision cross-link + the settlement.
    const actions = escrowAuditRows.map((r) => r.action);
    expect(actions).toContain('ADMIN_RESOLVED_REFUND');
    expect(actions).toContain('REFUNDED');
    // State settled.
    expect(journeys.get('j1').status).toBe('CANCELLED');
    expect(escrows.get('j1').status).toBe('REFUNDED');
  });
});

describe('journey-reconciliation decide() — Flutterwave refund (R3-FLW-REFUND-INTEGRATION)', () => {
  beforeEach(() => {
    mockRefundMomo.mockReset();
    mockRefundMomo.mockResolvedValue({ flwRefundTxId: 'flw-refund-xyz', status: 'SUCCESS' });
    delete process.env.E2E_FAKE_PAYMENTS;
  });
  afterAll(() => {
    delete process.env.E2E_FAKE_PAYMENTS;
  });

  test('calls refundMomo with the escrow flwTxId + amount when a real charge exists', async () => {
    const { prisma, journeys, escrows } = buildPrisma();
    seedDisputed(journeys, escrows, 'j1', 'flw-orig-1');
    await journeyReconciliationModule.decide(
      { id: 'j1', decision: 'RESOLVED_REFUND', reason, adminId: 'admin-1' },
      prisma,
    );
    expect(mockRefundMomo).toHaveBeenCalledTimes(1);
    expect(mockRefundMomo).toHaveBeenCalledWith({
      flwTxId: 'flw-orig-1',
      amount: 5000,
      escrowId: 'e-1',
      reason,
    });
    // Settlement still applied.
    expect(journeys.get('j1').status).toBe('CANCELLED');
    expect(escrows.get('j1').status).toBe('REFUNDED');
  });

  test('records flwRefundTxId in the REFUNDED EscrowAuditLog metadata', async () => {
    const { prisma, journeys, escrows, escrowAuditRows } = buildPrisma();
    seedDisputed(journeys, escrows, 'j1', 'flw-orig-1');
    await journeyReconciliationModule.decide(
      { id: 'j1', decision: 'RESOLVED_REFUND', reason, adminId: 'admin-1' },
      prisma,
    );
    const refundedEntry = escrowAuditRows.find((r) => r.action === 'REFUNDED');
    expect(refundedEntry).toBeTruthy();
    expect(refundedEntry.metadata).toEqual({ flwRefundTxId: 'flw-refund-xyz' });
  });

  test('skips refundMomo when E2E_FAKE_PAYMENTS=1', async () => {
    process.env.E2E_FAKE_PAYMENTS = '1';
    const { prisma, journeys, escrows } = buildPrisma();
    seedDisputed(journeys, escrows, 'j1', 'flw-orig-1');
    await journeyReconciliationModule.decide(
      { id: 'j1', decision: 'RESOLVED_REFUND', reason, adminId: 'admin-1' },
      prisma,
    );
    expect(mockRefundMomo).not.toHaveBeenCalled();
    // Settlement still applied (audit-only refund, no gateway).
    expect(journeys.get('j1').status).toBe('CANCELLED');
    expect(escrows.get('j1').status).toBe('REFUNDED');
  });

  test('skips refundMomo when escrow.flwTxId is null', async () => {
    const { prisma, journeys, escrows } = buildPrisma();
    seedDisputed(journeys, escrows, 'j1', null);
    await journeyReconciliationModule.decide(
      { id: 'j1', decision: 'RESOLVED_REFUND', reason, adminId: 'admin-1' },
      prisma,
    );
    expect(mockRefundMomo).not.toHaveBeenCalled();
    expect(journeys.get('j1').status).toBe('CANCELLED');
  });

  test("skips refundMomo when escrow.flwTxId is a synthetic 'e2e-' id", async () => {
    const { prisma, journeys, escrows } = buildPrisma();
    seedDisputed(journeys, escrows, 'j1', 'e2e-e-1-123456');
    await journeyReconciliationModule.decide(
      { id: 'j1', decision: 'RESOLVED_REFUND', reason, adminId: 'admin-1' },
      prisma,
    );
    expect(mockRefundMomo).not.toHaveBeenCalled();
    expect(journeys.get('j1').status).toBe('CANCELLED');
  });

  test('rolls back entirely when refundMomo throws (no state change, no audit, no AdminAction)', async () => {
    mockRefundMomo.mockRejectedValue(new Error('GATEWAY_DOWN'));
    const { prisma, journeys, escrows, adminActionRows, escrowAuditRows } = buildPrisma();
    seedDisputed(journeys, escrows, 'j1', 'flw-orig-1');
    await expect(
      journeyReconciliationModule.decide(
        { id: 'j1', decision: 'RESOLVED_REFUND', reason, adminId: 'admin-1' },
        prisma,
      ),
    ).rejects.toThrow('GATEWAY_DOWN');
    // The gateway call fires BEFORE the transaction — nothing was written.
    expect(journeys.get('j1').status).toBe('DISPUTED');
    expect(escrows.get('j1').status).toBe('FROZEN');
    expect(adminActionRows).toHaveLength(0);
    expect(escrowAuditRows).toHaveLength(0);
  });
});
