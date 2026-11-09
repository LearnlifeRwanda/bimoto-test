import { graphAnomalyModule } from '../conflicts/graph-anomaly';

function buildPrisma() {
  const adminActionRows: any[] = [];
  const flags = new Map<string, any>();
  const userIsFlagged = new Map<string, boolean>();

  const tx: any = {
    amlFlag: {
      findMany: jest.fn(async ({ where = {} }: any = {}) => {
        return Array.from(flags.values()).filter((f: any) => {
          if (where.type?.in && !where.type.in.includes(f.type)) return false;
          if (where.status && f.status !== where.status) return false;
          if (where.userId?.in && !where.userId.in.includes(f.userId)) return false;
          if (where.userId && typeof where.userId === 'string' && f.userId !== where.userId) return false;
          if (where.severity && f.severity !== where.severity) return false;
          return true;
        });
      }),
      findUnique: jest.fn(async ({ where }: any) => flags.get(where.id) ?? null),
      update: jest.fn(async ({ where, data }: any) => {
        const f = flags.get(where.id);
        if (f) Object.assign(f, data);
        return f;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const f of flags.values()) {
          if (where.type && f.type !== where.type) continue;
          if (where.status && f.status !== where.status) continue;
          if (where.userId?.in && !where.userId.in.includes(f.userId)) continue;
          Object.assign(f, data);
          count += 1;
        }
        return { count };
      }),
      count: jest.fn(async ({ where = {} }: any = {}) => {
        return Array.from(flags.values()).filter((f: any) => {
          if (where.userId && f.userId !== where.userId) return false;
          if (where.severity && f.severity !== where.severity) return false;
          if (where.status && f.status !== where.status) return false;
          return true;
        }).length;
      }),
    },
    user: {
      findMany: jest.fn(async ({ where }: any) => {
        const ids: string[] = where.id.in;
        return ids.map((id) => ({ id, nickname: id, role: 'CUSTOMER', isFlagged: userIsFlagged.get(id) ?? false }));
      }),
      update: jest.fn(async ({ where, data }: any) => {
        if (data.isFlagged !== undefined) userIsFlagged.set(where.id, data.isFlagged);
        return { id: where.id };
      }),
    },
    adminAction: {
      findFirst: jest.fn(async () =>
        adminActionRows.length === 0 ? null : adminActionRows[adminActionRows.length - 1],
      ),
      findMany: jest.fn(async ({ where = {} }: any = {}) => {
        return adminActionRows.filter((r) => {
          if (where.action && r.action !== where.action) return false;
          if (where.targetType && r.targetType !== where.targetType) return false;
          if (where.targetId?.in && !where.targetId.in.includes(r.targetId)) return false;
          return true;
        });
      }),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `aa-${adminActionRows.length + 1}`, ...data };
        adminActionRows.push(row);
        return row;
      }),
    },
  };
  const prisma = {
    ...tx,
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  };
  return { prisma, tx, flags, userIsFlagged, adminActionRows };
}

describe('graph-anomaly conflict module', () => {
  test('listOpen returns COLLUSION_RING flag with metadata.ringMembers populated', async () => {
    const { prisma, flags } = buildPrisma();
    flags.set('f1', {
      id: 'f1',
      userId: 'uA',
      type: 'COLLUSION_RING',
      severity: 'CRITICAL',
      status: 'OPEN',
      detectedAt: new Date('2026-05-03T10:00:00Z'),
      metadata: { ringMembers: ['uA', 'uB', 'uC'] },
      user: { id: 'uA', nickname: 'Alice', isFlagged: true },
    });
    const items = await graphAnomalyModule.listOpen(prisma, { limit: 50 });
    expect(items).toHaveLength(1);
    expect(items[0].metadata?.flagType).toBe('COLLUSION_RING');
  });

  test('UPHOLD_FLAG: AdminAction created, status RESOLVED, no User mutation', async () => {
    const { prisma, tx, flags, userIsFlagged, adminActionRows } = buildPrisma();
    flags.set('f1', {
      id: 'f1',
      userId: 'uA',
      type: 'COLLUSION_RING',
      severity: 'CRITICAL',
      status: 'OPEN',
      metadata: { ringMembers: ['uA', 'uB', 'uC'] },
    });
    userIsFlagged.set('uA', true);
    await graphAnomalyModule.decide(
      { id: 'f1', decision: 'UPHOLD_FLAG', reason: 'collusion confirmed', adminId: 'admin-1' },
      prisma,
    );
    expect(flags.get('f1').status).toBe('RESOLVED');
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(userIsFlagged.get('uA')).toBe(true);
    expect(adminActionRows[0].action).toBe('RESOLVE_GRAPH_ANOMALY');
    expect(adminActionRows[0].conflictType).toBe('GRAPH_ANOMALY');
    expect(adminActionRows[0].conflictDecision).toBe('UPHOLD_FLAG');
  });

  test('OVERTURN_FLAG: dismisses ALL ring members flags + clears isFlagged when no other CRITICAL', async () => {
    const { prisma, flags, userIsFlagged } = buildPrisma();
    for (const id of ['uA', 'uB', 'uC']) {
      flags.set(`f-${id}`, {
        id: `f-${id}`,
        userId: id,
        type: 'COLLUSION_RING',
        severity: 'CRITICAL',
        status: 'OPEN',
        metadata: { ringMembers: ['uA', 'uB', 'uC'] },
      });
      userIsFlagged.set(id, true);
    }
    await graphAnomalyModule.decide(
      { id: 'f-uA', decision: 'OVERTURN_FLAG', reason: 'false positive', adminId: 'admin-1' },
      prisma,
    );
    for (const id of ['uA', 'uB', 'uC']) {
      expect(flags.get(`f-${id}`).status).toBe('DISMISSED');
      expect(userIsFlagged.get(id)).toBe(false);
    }
  });

  test('OVERTURN_FLAG: keeps isFlagged for member with another open CRITICAL', async () => {
    const { prisma, flags, userIsFlagged } = buildPrisma();
    flags.set('f1', {
      id: 'f1',
      userId: 'uA',
      type: 'COLLUSION_RING',
      severity: 'CRITICAL',
      status: 'OPEN',
      metadata: { ringMembers: ['uA', 'uB'] },
    });
    flags.set('f2', {
      id: 'f2',
      userId: 'uA',
      type: 'HARD_LIMIT_EXCEEDED',
      severity: 'CRITICAL',
      status: 'OPEN',
      metadata: {},
    });
    flags.set('f3', {
      id: 'f3',
      userId: 'uB',
      type: 'COLLUSION_RING',
      severity: 'CRITICAL',
      status: 'OPEN',
      metadata: { ringMembers: ['uA', 'uB'] },
    });
    userIsFlagged.set('uA', true);
    userIsFlagged.set('uB', true);
    await graphAnomalyModule.decide(
      { id: 'f1', decision: 'OVERTURN_FLAG', reason: 'false positive', adminId: 'admin-1' },
      prisma,
    );
    expect(userIsFlagged.get('uA')).toBe(true);
    expect(userIsFlagged.get('uB')).toBe(false);
  });

  test('NO_ACTION: creates AdminAction without mutating any flag', async () => {
    const { prisma, flags, adminActionRows, tx } = buildPrisma();
    flags.set('f1', {
      id: 'f1',
      userId: 'uA',
      type: 'COLLUSION_RING',
      severity: 'CRITICAL',
      status: 'OPEN',
      metadata: { ringMembers: ['uA'] },
    });
    await graphAnomalyModule.decide(
      { id: 'f1', decision: 'NO_ACTION', reason: 'pending more info', adminId: 'admin-1' },
      prisma,
    );
    expect(flags.get('f1').status).toBe('OPEN');
    expect(tx.amlFlag.update).not.toHaveBeenCalled();
    expect(tx.amlFlag.updateMany).not.toHaveBeenCalled();
    expect(adminActionRows[0].conflictDecision).toBe('NO_ACTION');
  });
});
