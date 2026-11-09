// R3-N-4 — driver-no-show-dispute conflict module tests.

// G6(a) — asserted helpers keep their own jest.fn()s; the rest of the
// module auto-stubs beneath them.
jest.mock('../../../notification.service', () =>
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('../../../../__tests__/helpers/notification-service-mock').autoStubbedModule({
    notifyDriverDisputeUpheld: jest.fn(),
    notifyDriverDisputeRejected: jest.fn(),
    notifyDriverDisputeClosedNoAction: jest.fn(),
  }),
);

import {
  ALL_CONFLICT_TYPES,
  conflictModuleByType,
} from '..';
import { driverNoShowDisputeModule } from '../conflicts/driver-no-show-dispute';
import {
  notifyDriverDisputeUpheld,
  notifyDriverDisputeRejected,
  notifyDriverDisputeClosedNoAction,
} from '../../../notification.service';

function buildPrisma() {
  const journeys = new Map<string, any>();
  const adminActionRows: any[] = [];
  const userUpdates: any[] = [];

  const tx: any = {
    journey: {
      findUnique: jest.fn(async ({ where }: any) => journeys.get(where.id) ?? null),
      findMany: jest.fn(async ({ where = {}, orderBy: _ob, take }: any = {}) => {
        const rows = Array.from(journeys.values()).filter((j: any) => {
          if (where.cancelReason && j.cancelReason !== where.cancelReason)
            return false;
          if (
            where.driverDisputedAt?.not !== undefined &&
            j.driverDisputedAt === null
          ) {
            return false;
          }
          return true;
        });
        return take ? rows.slice(0, take) : rows;
      }),
    },
    user: {
      update: jest.fn(async (args: any) => {
        userUpdates.push(args);
        return { id: args.where.id };
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
  return { prisma, tx, journeys, adminActionRows, userUpdates };
}

function buildJourney(overrides: Partial<any> = {}) {
  return {
    id: 'j1',
    customerId: 'c1',
    driverId: 'd1abcdef-1234',
    cancelReason: 'DRIVER_NO_SHOW',
    cancelledAt: new Date(Date.now() - 60 * 60 * 1000),
    matchedAt: new Date(Date.now() - 90 * 60 * 1000),
    pickupName: 'Kacyiru',
    driverDisputedAt: new Date(),
    ...overrides,
  };
}

describe('driverNoShowDisputeModule — R3-N-4', () => {
  beforeEach(() => {
    (notifyDriverDisputeUpheld as jest.Mock).mockClear();
    (notifyDriverDisputeRejected as jest.Mock).mockClear();
    (notifyDriverDisputeClosedNoAction as jest.Mock).mockClear();
  });

  test('registers DRIVER_NO_SHOW_DISPUTE in ALL_CONFLICT_TYPES', () => {
    // TEAM-ANSWERS G3 added RIDE_REPORT as the tenth type.
    expect(ALL_CONFLICT_TYPES.length).toBe(10);
    expect(ALL_CONFLICT_TYPES).toContain('DRIVER_NO_SHOW_DISPUTE');
    expect(conflictModuleByType.DRIVER_NO_SHOW_DISPUTE.type).toBe(
      'DRIVER_NO_SHOW_DISPUTE',
    );
    expect(conflictModuleByType.DRIVER_NO_SHOW_DISPUTE).toBe(
      driverNoShowDisputeModule,
    );
  });

  test('listOpen returns disputed DRIVER_NO_SHOW journeys, excluding decided ones', async () => {
    const { prisma, journeys, adminActionRows } = buildPrisma();
    journeys.set('j1', buildJourney());
    journeys.set('j2', buildJourney({ id: 'j2', driverId: 'd2abc' }));
    journeys.set(
      'j3',
      buildJourney({ id: 'j3', cancelReason: 'CUSTOMER_CHANGED_MIND' }),
    );
    journeys.set(
      'j4',
      buildJourney({ id: 'j4', driverDisputedAt: null }),
    );
    adminActionRows.push({
      action: 'RESOLVE_DRIVER_NO_SHOW_DISPUTE',
      targetType: 'JOURNEY',
      targetId: 'j2',
    });

    const items = await driverNoShowDisputeModule.listOpen(prisma, { limit: 50 });
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('j1');
    expect(items[0].type).toBe('DRIVER_NO_SHOW_DISPUTE');
  });

  test('countOpen mirrors listOpen length', async () => {
    const { prisma, journeys } = buildPrisma();
    journeys.set('j1', buildJourney());
    journeys.set('j2', buildJourney({ id: 'j2' }));
    expect(await driverNoShowDisputeModule.countOpen(prisma)).toBe(2);
  });

  test('getDetail returns null for non-disputed journey', async () => {
    const { prisma, journeys } = buildPrisma();
    journeys.set('j1', buildJourney({ driverDisputedAt: null }));
    expect(await driverNoShowDisputeModule.getDetail(prisma, 'j1')).toBeNull();
  });

  test('decide OVERTURN_FLAG decrements driver.noShowCount and writes audit row', async () => {
    const { prisma, journeys, adminActionRows, userUpdates } = buildPrisma();
    journeys.set('j1', buildJourney());

    const action = await driverNoShowDisputeModule.decide(
      {
        id: 'j1',
        decision: 'OVERTURN_FLAG',
        reason: 'GPS shows driver was at pickup',
        adminId: 'admin-1',
      },
      prisma as any,
    );

    expect(userUpdates).toHaveLength(1);
    expect(userUpdates[0]).toEqual({
      where: { id: 'd1abcdef-1234' },
      data: { noShowCount: { decrement: 1 } },
    });
    expect(adminActionRows).toHaveLength(1);
    expect(adminActionRows[0]).toMatchObject({
      action: 'RESOLVE_DRIVER_NO_SHOW_DISPUTE',
      targetType: 'JOURNEY',
      targetId: 'j1',
      conflictType: 'DRIVER_NO_SHOW_DISPUTE',
      conflictDecision: 'OVERTURN_FLAG',
    });
    expect(action.action).toBe('RESOLVE_DRIVER_NO_SHOW_DISPUTE');
  });

  test('decide UPHOLD_FLAG writes audit row but leaves noShowCount untouched', async () => {
    const { prisma, journeys, userUpdates } = buildPrisma();
    journeys.set('j1', buildJourney());

    await driverNoShowDisputeModule.decide(
      {
        id: 'j1',
        decision: 'UPHOLD_FLAG',
        reason: 'driver evidence not credible',
        adminId: 'admin-1',
      },
      prisma as any,
    );

    expect(userUpdates).toHaveLength(0);
  });

  test('decide rejects non-valid decisions', async () => {
    const { prisma, journeys } = buildPrisma();
    journeys.set('j1', buildJourney());

    await expect(
      driverNoShowDisputeModule.decide(
        {
          id: 'j1',
          decision: 'RESOLVED_REFUND',
          reason: 'x',
          adminId: 'admin-1',
        },
        prisma as any,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_DECISION' });
  });

  test('validDecisions are exactly [OVERTURN_FLAG, UPHOLD_FLAG, NO_ACTION]', () => {
    expect([...driverNoShowDisputeModule.validDecisions].sort()).toEqual(
      ['NO_ACTION', 'OVERTURN_FLAG', 'UPHOLD_FLAG'],
    );
  });

  // R3-N-5 — dispute-resolution push fires AFTER the tx commits, with
  // the right helper for each decision. Pushes are fire-and-forget.
  test('decide OVERTURN_FLAG fires notifyDriverDisputeUpheld post-tx', async () => {
    const { prisma, journeys } = buildPrisma();
    journeys.set('j1', buildJourney());

    await driverNoShowDisputeModule.decide(
      { id: 'j1', decision: 'OVERTURN_FLAG', reason: 'gps ok', adminId: 'admin-1' },
      prisma as any,
    );

    expect(notifyDriverDisputeUpheld).toHaveBeenCalledTimes(1);
    expect(notifyDriverDisputeUpheld).toHaveBeenCalledWith('d1abcdef-1234', 'j1');
    expect(notifyDriverDisputeRejected).not.toHaveBeenCalled();
    expect(notifyDriverDisputeClosedNoAction).not.toHaveBeenCalled();
  });

  test('decide UPHOLD_FLAG fires notifyDriverDisputeRejected post-tx', async () => {
    const { prisma, journeys } = buildPrisma();
    journeys.set('j1', buildJourney());

    await driverNoShowDisputeModule.decide(
      { id: 'j1', decision: 'UPHOLD_FLAG', reason: 'no evidence', adminId: 'admin-1' },
      prisma as any,
    );

    expect(notifyDriverDisputeRejected).toHaveBeenCalledTimes(1);
    expect(notifyDriverDisputeRejected).toHaveBeenCalledWith('d1abcdef-1234', 'j1');
    expect(notifyDriverDisputeUpheld).not.toHaveBeenCalled();
    expect(notifyDriverDisputeClosedNoAction).not.toHaveBeenCalled();
  });

  test('decide NO_ACTION fires notifyDriverDisputeClosedNoAction post-tx', async () => {
    const { prisma, journeys } = buildPrisma();
    journeys.set('j1', buildJourney());

    await driverNoShowDisputeModule.decide(
      { id: 'j1', decision: 'NO_ACTION', reason: 'closed', adminId: 'admin-1' },
      prisma as any,
    );

    expect(notifyDriverDisputeClosedNoAction).toHaveBeenCalledTimes(1);
    expect(notifyDriverDisputeClosedNoAction).toHaveBeenCalledWith('d1abcdef-1234', 'j1');
    expect(notifyDriverDisputeUpheld).not.toHaveBeenCalled();
    expect(notifyDriverDisputeRejected).not.toHaveBeenCalled();
  });

  test('does not fire push when journey not found mid-tx (rollback safety)', async () => {
    const { prisma } = buildPrisma();
    // No journey seeded — findUnique returns null inside the tx.

    await expect(
      driverNoShowDisputeModule.decide(
        { id: 'missing', decision: 'OVERTURN_FLAG', reason: 'x', adminId: 'admin-1' },
        prisma as any,
      ),
    ).rejects.toMatchObject({ code: 'JOURNEY_NOT_FOUND' });

    expect(notifyDriverDisputeUpheld).not.toHaveBeenCalled();
    expect(notifyDriverDisputeRejected).not.toHaveBeenCalled();
    expect(notifyDriverDisputeClosedNoAction).not.toHaveBeenCalled();
  });
});
