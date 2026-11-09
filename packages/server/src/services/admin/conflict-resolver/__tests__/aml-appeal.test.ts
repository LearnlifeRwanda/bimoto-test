import { amlAppealModule } from '../conflicts/aml-appeal';

function buildPrisma() {
  const adminActionRows: any[] = [];
  const flags = new Map<string, any>();
  const userIsFlagged = new Map<string, boolean>();

  const tx: any = {
    amlFlag: {
      findMany: jest.fn(async ({ where = {} }: any = {}) => {
        return Array.from(flags.values()).filter((f: any) => {
          if (where.severity && f.severity !== where.severity) return false;
          if (where.status && f.status !== where.status) return false;
          if (where.userId && f.userId !== where.userId) return false;
          if (where.NOT?.id && f.id === where.NOT.id) return false;
          if (
            where.user?.isFlagged !== undefined &&
            (userIsFlagged.get(f.userId) ?? false) !== where.user.isFlagged
          ) {
            return false;
          }
          return true;
        });
      }),
      findUnique: jest.fn(async ({ where }: any) => flags.get(where.id) ?? null),
      update: jest.fn(async ({ where, data }: any) => {
        const f = flags.get(where.id);
        if (f) Object.assign(f, data);
        return f;
      }),
      count: jest.fn(async ({ where = {} }: any = {}) => {
        return Array.from(flags.values()).filter((f: any) => {
          if (where.userId && f.userId !== where.userId) return false;
          if (where.severity && f.severity !== where.severity) return false;
          if (where.status && f.status !== where.status) return false;
          if (where.NOT?.id && f.id === where.NOT.id) return false;
          return true;
        }).length;
      }),
    },
    user: {
      update: jest.fn(async ({ where, data }: any) => {
        if (data.isFlagged !== undefined) userIsFlagged.set(where.id, data.isFlagged);
        return { id: where.id };
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
          if (where.targetType && r.targetType !== where.targetType) return false;
          if (where.targetId?.in && !where.targetId.in.includes(r.targetId))
            return false;
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

describe('aml-appeal conflict module', () => {
  test('listOpen returns only flags without a prior RESOLVE_AML_APPEAL action', async () => {
    const { prisma, flags, userIsFlagged, adminActionRows } = buildPrisma();
    flags.set('f1', {
      id: 'f1',
      userId: 'u1',
      type: 'HARD_LIMIT_EXCEEDED',
      severity: 'CRITICAL',
      status: 'OPEN',
      detectedAt: new Date(),
      user: { id: 'u1', nickname: 'Alice', isFlagged: true },
    });
    flags.set('f2', {
      id: 'f2',
      userId: 'u2',
      type: 'HARD_LIMIT_EXCEEDED',
      severity: 'CRITICAL',
      status: 'OPEN',
      detectedAt: new Date(),
      user: { id: 'u2', nickname: 'Bob', isFlagged: true },
    });
    userIsFlagged.set('u1', true);
    userIsFlagged.set('u2', true);
    adminActionRows.push({
      action: 'RESOLVE_AML_APPEAL',
      targetType: 'AML_FLAG',
      targetId: 'f2',
    });

    const items = await amlAppealModule.listOpen(prisma, { limit: 50 });
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('f1');
  });

  test('UPHOLD_FLAG marks status RESOLVED but does not change User.isFlagged', async () => {
    const { prisma, tx, flags, userIsFlagged } = buildPrisma();
    flags.set('f1', {
      id: 'f1',
      userId: 'u1',
      type: 'HARD_LIMIT_EXCEEDED',
      severity: 'CRITICAL',
      status: 'OPEN',
      detectedAt: new Date(),
    });
    userIsFlagged.set('u1', true);
    await amlAppealModule.decide(
      {
        id: 'f1',
        decision: 'UPHOLD_FLAG',
        reason: 'reviewed and confirmed',
        adminId: 'admin-1',
      },
      prisma,
    );
    expect(flags.get('f1').status).toBe('RESOLVED');
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(userIsFlagged.get('u1')).toBe(true);
  });

  test('OVERTURN_FLAG clears User.isFlagged when no other CRITICAL is open', async () => {
    const { prisma, flags, userIsFlagged } = buildPrisma();
    flags.set('f1', {
      id: 'f1',
      userId: 'u1',
      type: 'HARD_LIMIT_EXCEEDED',
      severity: 'CRITICAL',
      status: 'OPEN',
      detectedAt: new Date(),
    });
    userIsFlagged.set('u1', true);
    await amlAppealModule.decide(
      {
        id: 'f1',
        decision: 'OVERTURN_FLAG',
        reason: 'reviewed — false positive',
        adminId: 'admin-1',
      },
      prisma,
    );
    expect(flags.get('f1').status).toBe('DISMISSED');
    expect(userIsFlagged.get('u1')).toBe(false);
  });

  test('OVERTURN_FLAG keeps User.isFlagged when another CRITICAL is still open', async () => {
    const { prisma, flags, userIsFlagged } = buildPrisma();
    flags.set('f1', {
      id: 'f1',
      userId: 'u1',
      type: 'HARD_LIMIT_EXCEEDED',
      severity: 'CRITICAL',
      status: 'OPEN',
      detectedAt: new Date(),
    });
    flags.set('f2', {
      id: 'f2',
      userId: 'u1',
      type: 'VELOCITY_EXCEEDED',
      severity: 'CRITICAL',
      status: 'OPEN',
      detectedAt: new Date(),
    });
    userIsFlagged.set('u1', true);
    await amlAppealModule.decide(
      {
        id: 'f1',
        decision: 'OVERTURN_FLAG',
        reason: 'reviewed — false positive',
        adminId: 'admin-1',
      },
      prisma,
    );
    expect(flags.get('f1').status).toBe('DISMISSED');
    expect(userIsFlagged.get('u1')).toBe(true);
  });
});
