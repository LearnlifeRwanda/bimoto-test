// R3-CONFLICTS-RECIPIENT-DISPUTE — recipient-dispute conflict module tests.

import {
  ALL_CONFLICT_TYPES,
  conflictModuleByType,
} from '..';
import { recipientDisputeModule } from '../conflicts/recipient-dispute';
import { refundMomo } from '../../../payment/refund';

// R3-FLW-RECIPIENT-DISPUTE-REFUND-INTEGRATION — decide(RESOLVED_REFUND) fires
// the Flutterwave refund gateway pre-transaction. Mock it so unit tests never
// hit a real (or stub) gateway and can assert the call / skip behaviour.
jest.mock('../../../payment/refund', () => ({ refundMomo: jest.fn() }));
const mockRefundMomo = refundMomo as jest.Mock;

function buildPrisma() {
  const legs = new Map<string, any>();
  const journeys = new Map<string, any>();
  const escrows = new Map<string, any>(); // keyed by journeyId
  const adminActionRows: any[] = [];
  const escrowAuditRows: any[] = [];

  const tx: any = {
    leg: {
      findUnique: jest.fn(async ({ where }: any) => {
        const l = legs.get(where.id);
        if (!l) return null;
        const journey = l.journeyId ? journeys.get(l.journeyId) : null;
        const escrow = l.journeyId ? escrows.get(l.journeyId) ?? null : null;
        // Nest the escrow under journey so the pre-$transaction read
        // (leg.findUnique include journey.escrow) sees it — even when only the
        // escrow (not a full journey row) was seeded.
        return {
          ...l,
          journey:
            journey || escrow
              ? { ...(journey ?? { id: l.journeyId }), escrow }
              : null,
        };
      }),
      findMany: jest.fn(async ({ where = {}, orderBy: _ob, take }: any = {}) => {
        const rows = Array.from(legs.values()).filter((l: any) => {
          if (
            where.recipientConfirmStatus &&
            l.recipientConfirmStatus !== where.recipientConfirmStatus
          ) {
            return false;
          }
          return true;
        });
        return take ? rows.slice(0, take) : rows;
      }),
    },
    adminAction: {
      findFirst: jest.fn(async () =>
        adminActionRows.length === 0
          ? null
          : adminActionRows[adminActionRows.length - 1],
      ),
      findMany: jest.fn(async ({ where = {} }: any = {}) => {
        return adminActionRows.filter((r) => {
          if (where.action && r.action !== where.action) return false;
          if (where.targetType && r.targetType !== where.targetType)
            return false;
          if (where.targetId?.in && !where.targetId.in.includes(r.targetId))
            return false;
          if (
            typeof where.targetId === 'string' &&
            r.targetId !== where.targetId
          ) {
            return false;
          }
          return true;
        });
      }),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `aa-${adminActionRows.length + 1}`, ...data };
        adminActionRows.push(row);
        return row;
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
    driverProfile: { update: jest.fn(async () => ({})) },
    user: { update: jest.fn(async () => ({})) },
    driverBalance: { upsert: jest.fn(async () => ({})) },
  };
  const prisma = {
    ...tx,
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  };
  return { prisma, tx, legs, journeys, escrows, adminActionRows, escrowAuditRows };
}

function buildEscrow(overrides: Partial<any> = {}) {
  return {
    id: 'esc-1',
    journeyId: 'journey-1',
    status: 'FROZEN',
    amount: 5000,
    driverId: 'drv-1',
    driverPayout: 4000,
    customerId: 'cust-1',
    flwTxId: null, // default: no real gateway tx → refundMomo is skipped
    ...overrides,
  };
}

function buildLeg(overrides: Partial<any> = {}) {
  return {
    id: 'leg-1',
    journeyId: 'journey-1',
    sequence: 2,
    type: 'GOODS_DROPOFF',
    contactName: 'Aline',
    contactPhone: '+250788111222',
    parcelSize: 'SMALL',
    parcelCategory: 'OTHER',
    recipientConfirmStatus: 'DISPUTED',
    recipientConfirmedAt: new Date('2026-05-11T10:00:00Z'),
    recipientDisputeReason: 'WRONG ITEM - received yellow envelope not red',
    completedAt: new Date('2026-05-11T09:30:00Z'),
    createdAt: new Date('2026-05-11T08:00:00Z'),
    updatedAt: new Date('2026-05-11T10:00:00Z'),
    ...overrides,
  };
}

function buildJourney(overrides: Partial<any> = {}) {
  return {
    id: 'journey-1',
    type: 'GOODS_DELIVERY',
    agreedPrice: 5000,
    status: 'COMPLETED',
    createdAt: new Date('2026-05-11T07:00:00Z'),
    customer: { id: 'cust-1', nickname: 'Eric' },
    driver: { id: 'drv-1', nickname: 'Bosco' },
    ...overrides,
  };
}

describe('recipientDisputeModule — R3-CONFLICTS-RECIPIENT-DISPUTE', () => {
  test('registers RECIPIENT_DISPUTE in ALL_CONFLICT_TYPES', () => {
    // TEAM-ANSWERS G3 added RIDE_REPORT as the tenth type.
    expect(ALL_CONFLICT_TYPES.length).toBe(10);
    expect(ALL_CONFLICT_TYPES).toContain('RECIPIENT_DISPUTE');
    expect(conflictModuleByType.RECIPIENT_DISPUTE.type).toBe(
      'RECIPIENT_DISPUTE',
    );
    expect(conflictModuleByType.RECIPIENT_DISPUTE).toBe(recipientDisputeModule);
  });

  test('validDecisions are the 4 recipient-dispute resolution options', () => {
    expect([...recipientDisputeModule.validDecisions].sort()).toEqual([
      'NO_ACTION',
      'RESOLVED_PAY',
      'RESOLVED_REFUND',
      'RESOLVED_SPLIT',
    ]);
  });

  test('listOpen returns DISPUTED legs, excluding ones with prior admin actions', async () => {
    const { prisma, legs, adminActionRows } = buildPrisma();
    legs.set('leg-1', buildLeg());
    legs.set('leg-2', buildLeg({ id: 'leg-2', sequence: 3 }));
    legs.set(
      'leg-3',
      buildLeg({ id: 'leg-3', recipientConfirmStatus: 'EXPLICIT_REPLY' }),
    );
    legs.set(
      'leg-4',
      buildLeg({ id: 'leg-4', recipientConfirmStatus: 'AUTO_TIMEOUT' }),
    );
    adminActionRows.push({
      action: 'RESOLVE_RECIPIENT_DISPUTE',
      targetType: 'LEG',
      targetId: 'leg-2',
    });

    const items = await recipientDisputeModule.listOpen(prisma, { limit: 50 });
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('leg-1');
    expect(items[0].type).toBe('RECIPIENT_DISPUTE');
    expect(items[0].metadata).toMatchObject({
      journeyId: 'journey-1',
      sequence: 2,
      contactPhone: '+250788111222',
    });
  });

  test('listOpen truncates long dispute reasons in summary', async () => {
    const { prisma, legs } = buildPrisma();
    const longReason =
      'DAMAGED - the parcel was completely soaked and torn open along multiple seams making contents unusable';
    legs.set('leg-1', buildLeg({ recipientDisputeReason: longReason }));
    const items = await recipientDisputeModule.listOpen(prisma, { limit: 50 });
    expect(items[0].summary).toContain('…');
    expect(items[0].summary.length).toBeLessThan(longReason.length + 40);
  });

  test('countOpen mirrors listOpen length', async () => {
    const { prisma, legs } = buildPrisma();
    legs.set('leg-1', buildLeg());
    legs.set('leg-2', buildLeg({ id: 'leg-2' }));
    expect(await recipientDisputeModule.countOpen(prisma)).toBe(2);
  });

  test('getDetail returns full leg + journey + customer + driver context', async () => {
    const { prisma, legs, journeys } = buildPrisma();
    legs.set('leg-1', buildLeg());
    journeys.set('journey-1', buildJourney());

    const detail = await recipientDisputeModule.getDetail(prisma, 'leg-1');
    expect(detail).not.toBeNull();
    expect(detail!.id).toBe('leg-1');
    expect(detail!.type).toBe('RECIPIENT_DISPUTE');
    expect((detail!.data as any).leg.recipientDisputeReason).toBe(
      'WRONG ITEM - received yellow envelope not red',
    );
    expect((detail!.data as any).customer.nickname).toBe('Eric');
    expect((detail!.data as any).driver.nickname).toBe('Bosco');
  });

  // DECRYPT v3 G5 — the thawed #181 finding. This key used to be read off
  // a `stopType` column that does not exist, so every real dispute shipped
  // it as undefined; the old fixture invented the column and kept the
  // suite green. It now comes from Leg.type, and the fixture is
  // schema-true, so the assertion and production agree.
  test('getDetail carries the real LegType, not an undefined stopType', async () => {
    const { prisma, legs, journeys } = buildPrisma();
    legs.set('leg-1', buildLeg());
    journeys.set('journey-1', buildJourney());

    const detail = await recipientDisputeModule.getDetail(prisma, 'leg-1');
    expect((detail!.data as any).leg.stopType).toBe('GOODS_DROPOFF');
    expect((detail!.data as any).leg.stopType).toBeDefined();
  });

  test('getDetail returns null for non-existent legId', async () => {
    const { prisma } = buildPrisma();
    expect(await recipientDisputeModule.getDetail(prisma, 'missing')).toBeNull();
  });

  test('getDetail returns null for non-disputed leg', async () => {
    const { prisma, legs } = buildPrisma();
    legs.set(
      'leg-1',
      buildLeg({ recipientConfirmStatus: 'EXPLICIT_REPLY' }),
    );
    expect(await recipientDisputeModule.getDetail(prisma, 'leg-1')).toBeNull();
  });

  test('getDetail includes prior admin actions on the leg', async () => {
    const { prisma, legs, journeys, adminActionRows } = buildPrisma();
    legs.set('leg-1', buildLeg());
    journeys.set('journey-1', buildJourney());
    adminActionRows.push({
      id: 'aa-prior',
      action: 'RESOLVE_RECIPIENT_DISPUTE',
      targetType: 'LEG',
      targetId: 'leg-1',
      adminId: 'admin-99',
      conflictDecision: 'RESOLVED_REFUND',
      reason: 'Customer refunded; sender confirmed wrong parcel.',
      createdAt: new Date('2026-05-11T11:00:00Z'),
    });

    const detail = await recipientDisputeModule.getDetail(prisma, 'leg-1');
    expect((detail!.data as any).priorActions).toHaveLength(1);
    expect((detail!.data as any).priorActions[0].conflictDecision).toBe(
      'RESOLVED_REFUND',
    );
  });

  test('decide records AdminAction with conflictType + decision + reason', async () => {
    const { prisma, legs, escrows, adminActionRows } = buildPrisma();
    legs.set('leg-1', buildLeg());
    escrows.set('journey-1', buildEscrow());

    const action = await recipientDisputeModule.decide(
      {
        id: 'leg-1',
        decision: 'RESOLVED_REFUND',
        reason: 'Recipient verified; wrong parcel delivered; customer refunded.',
        adminId: 'admin-1',
      },
      prisma as any,
    );

    expect(adminActionRows).toHaveLength(1);
    expect(adminActionRows[0]).toMatchObject({
      action: 'RESOLVE_RECIPIENT_DISPUTE',
      targetType: 'LEG',
      targetId: 'leg-1',
      conflictType: 'RECIPIENT_DISPUTE',
      conflictDecision: 'RESOLVED_REFUND',
    });
    expect(action.action).toBe('RESOLVE_RECIPIENT_DISPUTE');
    expect(adminActionRows[0].entryHash).toBeDefined();
    expect(adminActionRows[0].prevHash).toBe('');
  });

  test('decide preserves the verbatim disputeReason in AdminAction payload', async () => {
    const { prisma, legs, adminActionRows } = buildPrisma();
    legs.set(
      'leg-1',
      buildLeg({
        recipientDisputeReason:
          'DAMAGED - box arrived with corner crushed and contents broken',
      }),
    );

    await recipientDisputeModule.decide(
      {
        id: 'leg-1',
        decision: 'RESOLVED_SPLIT',
        reason: 'Driver mishandled but customer also packed poorly.',
        adminId: 'admin-1',
      },
      prisma as any,
    );

    expect(adminActionRows[0].payload).toMatchObject({
      journeyId: 'journey-1',
      sequence: 2,
      disputeReason:
        'DAMAGED - box arrived with corner crushed and contents broken',
    });
  });

  test('decide does NOT mutate leg.recipientConfirmStatus (dispute preserved forever)', async () => {
    const { prisma, legs } = buildPrisma();
    legs.set('leg-1', buildLeg());

    await recipientDisputeModule.decide(
      {
        id: 'leg-1',
        decision: 'NO_ACTION',
        reason: 'Closed without financial movement.',
        adminId: 'admin-1',
      },
      prisma as any,
    );

    // The status on the underlying row is still DISPUTED — the AdminAction
    // is the resolution layer above it, not a status mutation.
    expect(legs.get('leg-1').recipientConfirmStatus).toBe('DISPUTED');
  });

  test('decide rejects non-valid decisions', async () => {
    const { prisma, legs } = buildPrisma();
    legs.set('leg-1', buildLeg());

    await expect(
      recipientDisputeModule.decide(
        {
          id: 'leg-1',
          decision: 'OVERTURN_FLAG',
          reason: 'wrong decision type for this module',
          adminId: 'admin-1',
        },
        prisma as any,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_DECISION' });
  });

  test('decide throws LEG_NOT_FOUND when leg does not exist', async () => {
    const { prisma } = buildPrisma();
    await expect(
      recipientDisputeModule.decide(
        {
          id: 'missing',
          decision: 'RESOLVED_PAY',
          reason: 'should fail before any write',
          adminId: 'admin-1',
        },
        prisma as any,
      ),
    ).rejects.toMatchObject({ code: 'LEG_NOT_FOUND' });
  });

  test('decide throws LEG_NOT_DISPUTED when leg is not in DISPUTED state', async () => {
    const { prisma, legs } = buildPrisma();
    legs.set(
      'leg-1',
      buildLeg({ recipientConfirmStatus: 'EXPLICIT_REPLY' }),
    );

    await expect(
      recipientDisputeModule.decide(
        {
          id: 'leg-1',
          decision: 'RESOLVED_PAY',
          reason: 'not actually disputed',
          adminId: 'admin-1',
        },
        prisma as any,
      ),
    ).rejects.toMatchObject({ code: 'LEG_NOT_DISPUTED' });
  });

  // R3-RECIPIENT-DISPUTE-WIRING-FIX — escrow-only settlement.
  describe('escrow-only settlement', () => {
    test('RESOLVED_REFUND flips escrow FROZEN -> REFUNDED + writes ADMIN_RECIPIENT_DISPUTE_REFUND; journey untouched', async () => {
      const { prisma, legs, journeys, escrows, escrowAuditRows, adminActionRows } = buildPrisma();
      legs.set('leg-1', buildLeg());
      journeys.set('journey-1', buildJourney({ status: 'AWAITING_CONFIRMATION' }));
      escrows.set('journey-1', buildEscrow({ status: 'FROZEN' }));

      await recipientDisputeModule.decide(
        { id: 'leg-1', decision: 'RESOLVED_REFUND', reason: 'wrong parcel; refund sender', adminId: 'admin-1' },
        prisma as any,
      );

      expect(escrows.get('journey-1').status).toBe('REFUNDED');
      expect(escrowAuditRows.map((r) => r.action)).toContain('ADMIN_RECIPIENT_DISPUTE_REFUND');
      // Journey state is intentionally NOT touched (no transitionJourney).
      expect(journeys.get('journey-1').status).toBe('AWAITING_CONFIRMATION');
      // AdminAction cross-links the domain-specific audit entry.
      expect(adminActionRows[0].crossLinkedEscrowAuditLogId).toBe('ea-1');
    });

    test('RESOLVED_PAY flips escrow FROZEN -> RELEASED + credits driver + writes ADMIN_RECIPIENT_DISPUTE_PAY; journey untouched', async () => {
      const { prisma, legs, journeys, escrows, escrowAuditRows, tx } = buildPrisma();
      legs.set('leg-1', buildLeg());
      journeys.set('journey-1', buildJourney({ status: 'COMPLETED' }));
      escrows.set('journey-1', buildEscrow({ status: 'FROZEN' }));

      await recipientDisputeModule.decide(
        { id: 'leg-1', decision: 'RESOLVED_PAY', reason: 'driver delivered; recipient mistaken', adminId: 'admin-1' },
        prisma as any,
      );

      expect(escrows.get('journey-1').status).toBe('RELEASED');
      expect(escrowAuditRows.map((r) => r.action)).toContain('ADMIN_RECIPIENT_DISPUTE_PAY');
      // releaseEscrowTx credits the driver via creditDriverBalance -> driverBalance.upsert.
      expect(tx.driverBalance.upsert).toHaveBeenCalledTimes(1);
      expect(tx.driverBalance.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { driverId: 'drv-1' } }),
      );
      expect(journeys.get('journey-1').status).toBe('COMPLETED');
    });

    test('runtime guard: RESOLVED_REFUND throws ESCROW_NOT_FROZEN on a RELEASED escrow (manual-confirm edge); nothing mutated', async () => {
      const { prisma, legs, escrows, escrowAuditRows, adminActionRows } = buildPrisma();
      legs.set('leg-1', buildLeg());
      escrows.set('journey-1', buildEscrow({ status: 'RELEASED' }));

      await expect(
        recipientDisputeModule.decide(
          { id: 'leg-1', decision: 'RESOLVED_REFUND', reason: 'escrow already released', adminId: 'admin-1' },
          prisma as any,
        ),
      ).rejects.toMatchObject({ code: 'ESCROW_NOT_FROZEN' });

      expect(escrows.get('journey-1').status).toBe('RELEASED'); // unchanged
      expect(escrowAuditRows).toHaveLength(0);
      expect(adminActionRows).toHaveLength(0);
    });

    test('runtime guard: RESOLVED_PAY throws ESCROW_NOT_FROZEN on a HELD escrow (freeze never fired)', async () => {
      const { prisma, legs, escrows, adminActionRows } = buildPrisma();
      legs.set('leg-1', buildLeg());
      escrows.set('journey-1', buildEscrow({ status: 'HELD' }));

      await expect(
        recipientDisputeModule.decide(
          { id: 'leg-1', decision: 'RESOLVED_PAY', reason: 'escrow not frozen', adminId: 'admin-1' },
          prisma as any,
        ),
      ).rejects.toMatchObject({ code: 'ESCROW_NOT_FROZEN' });
      expect(escrows.get('journey-1').status).toBe('HELD');
      expect(adminActionRows).toHaveLength(0);
    });

    test('NO_ACTION remains audit-only — no escrow load, AdminAction still written', async () => {
      const { prisma, legs, escrows, adminActionRows } = buildPrisma();
      legs.set('leg-1', buildLeg());
      escrows.set('journey-1', buildEscrow({ status: 'FROZEN' }));

      await recipientDisputeModule.decide(
        { id: 'leg-1', decision: 'NO_ACTION', reason: 'duplicate report', adminId: 'admin-1' },
        prisma as any,
      );
      // Escrow untouched; AdminAction recorded.
      expect(escrows.get('journey-1').status).toBe('FROZEN');
      expect(adminActionRows).toHaveLength(1);
    });
  });

  // R3-FLW-RECIPIENT-DISPUTE-REFUND-INTEGRATION — Flutterwave refund gateway.
  describe('FLW gateway integration (RESOLVED_REFUND)', () => {
    beforeEach(() => {
      mockRefundMomo.mockReset();
      mockRefundMomo.mockResolvedValue({ flwRefundTxId: 'rfd_xxx', status: 'SUCCESS' });
      delete process.env.E2E_FAKE_PAYMENTS;
    });
    afterAll(() => {
      delete process.env.E2E_FAKE_PAYMENTS;
    });

    test('real-money path: calls refundMomo with the escrow flwTxId + amount; threads flwRefundTxId to refundEscrowTx', async () => {
      const { prisma, legs, escrows, escrowAuditRows } = buildPrisma();
      legs.set('leg-1', buildLeg());
      escrows.set('journey-1', buildEscrow({ status: 'FROZEN', flwTxId: 'flw-orig-1' }));

      await recipientDisputeModule.decide(
        { id: 'leg-1', decision: 'RESOLVED_REFUND', reason: 'wrong parcel; refund', adminId: 'admin-1' },
        prisma as any,
      );

      expect(mockRefundMomo).toHaveBeenCalledTimes(1);
      expect(mockRefundMomo).toHaveBeenCalledWith({
        flwTxId: 'flw-orig-1',
        amount: 5000,
        escrowId: 'esc-1',
        reason: 'recipient-dispute-resolved-refund',
      });
      // The gateway tx id reaches refundEscrowTx → REFUNDED audit metadata.
      const refundedEntry = escrowAuditRows.find((r) => r.action === 'REFUNDED');
      expect(refundedEntry?.metadata).toEqual({ flwRefundTxId: 'rfd_xxx' });
      // Gateway fired BEFORE the transaction opened (pre-tx ordering).
      const refundOrder = mockRefundMomo.mock.invocationCallOrder[0];
      const txOrder = (prisma.$transaction as jest.Mock).mock.invocationCallOrder[0];
      expect(refundOrder).toBeLessThan(txOrder);
      expect(escrows.get('journey-1').status).toBe('REFUNDED');
    });

    test('skips refundMomo when E2E_FAKE_PAYMENTS=1; refundEscrowTx gets undefined; settlement still applies', async () => {
      process.env.E2E_FAKE_PAYMENTS = '1';
      const { prisma, legs, escrows, escrowAuditRows } = buildPrisma();
      legs.set('leg-1', buildLeg());
      escrows.set('journey-1', buildEscrow({ status: 'FROZEN', flwTxId: 'flw-orig-1' }));

      await recipientDisputeModule.decide(
        { id: 'leg-1', decision: 'RESOLVED_REFUND', reason: 'e2e refund', adminId: 'admin-1' },
        prisma as any,
      );

      expect(mockRefundMomo).not.toHaveBeenCalled();
      expect(escrows.get('journey-1').status).toBe('REFUNDED');
      const refundedEntry = escrowAuditRows.find((r) => r.action === 'REFUNDED');
      expect(refundedEntry?.metadata ?? undefined).toBeUndefined();
    });

    test('skips refundMomo when escrow.flwTxId is null', async () => {
      const { prisma, legs, escrows } = buildPrisma();
      legs.set('leg-1', buildLeg());
      escrows.set('journey-1', buildEscrow({ status: 'FROZEN', flwTxId: null }));

      await recipientDisputeModule.decide(
        { id: 'leg-1', decision: 'RESOLVED_REFUND', reason: 'null tx id', adminId: 'admin-1' },
        prisma as any,
      );
      expect(mockRefundMomo).not.toHaveBeenCalled();
      expect(escrows.get('journey-1').status).toBe('REFUNDED'); // system-side settle still runs
    });

    test("skips refundMomo when escrow.flwTxId is a synthetic 'e2e-' id", async () => {
      const { prisma, legs, escrows } = buildPrisma();
      legs.set('leg-1', buildLeg());
      escrows.set('journey-1', buildEscrow({ status: 'FROZEN', flwTxId: 'e2e-test-abc' }));

      await recipientDisputeModule.decide(
        { id: 'leg-1', decision: 'RESOLVED_REFUND', reason: 'synthetic id', adminId: 'admin-1' },
        prisma as any,
      );
      expect(mockRefundMomo).not.toHaveBeenCalled();
      expect(escrows.get('journey-1').status).toBe('REFUNDED');
    });

    test('PENDING gateway response: flwRefundTxId stays undefined; settlement proceeds', async () => {
      mockRefundMomo.mockResolvedValue({ flwRefundTxId: null, status: 'PENDING' });
      const { prisma, legs, escrows, escrowAuditRows } = buildPrisma();
      legs.set('leg-1', buildLeg());
      escrows.set('journey-1', buildEscrow({ status: 'FROZEN', flwTxId: 'flw-orig-2' }));

      await recipientDisputeModule.decide(
        { id: 'leg-1', decision: 'RESOLVED_REFUND', reason: 'pending refund', adminId: 'admin-1' },
        prisma as any,
      );

      expect(mockRefundMomo).toHaveBeenCalledTimes(1);
      expect(escrows.get('journey-1').status).toBe('REFUNDED');
      const refundedEntry = escrowAuditRows.find((r) => r.action === 'REFUNDED');
      // null coerced to undefined → no flwRefundTxId metadata.
      expect(refundedEntry?.metadata ?? undefined).toBeUndefined();
    });

    test('non-FROZEN escrow (RELEASED) does NOT call refundMomo and still throws ESCROW_NOT_FROZEN', async () => {
      const { prisma, legs, escrows, adminActionRows } = buildPrisma();
      legs.set('leg-1', buildLeg());
      escrows.set('journey-1', buildEscrow({ status: 'RELEASED', flwTxId: 'flw-orig-3' }));

      await expect(
        recipientDisputeModule.decide(
          { id: 'leg-1', decision: 'RESOLVED_REFUND', reason: 'manual-confirm edge', adminId: 'admin-1' },
          prisma as any,
        ),
      ).rejects.toMatchObject({ code: 'ESCROW_NOT_FROZEN' });
      expect(mockRefundMomo).not.toHaveBeenCalled();
      expect(escrows.get('journey-1').status).toBe('RELEASED');
      expect(adminActionRows).toHaveLength(0);
    });
  });
});
