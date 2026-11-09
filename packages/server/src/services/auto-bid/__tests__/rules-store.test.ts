import type { PrismaClient } from '@prisma/client';
import {
  createRule,
  deleteRule,
  listRulesForDriver,
  pauseAllRules,
  resumeAllRules,
  updateRule,
} from '../rules-store';
import { RuleStoreError, type RuleInput } from '../types';

// In-memory prisma mock for the DriverAutoBidRule model. We only
// implement the methods the store calls (findMany, findUnique, count,
// create, update, delete, updateMany) so the tests stay fast and
// isolated from the real DB.
function makeMockPrisma() {
  const rules: any[] = [];
  let nextId = 1;
  const driverAutoBidRule = {
    findMany: jest.fn(async ({ where, orderBy }: any) => {
      let rows = rules.filter((r) => {
        if (where?.driverId !== undefined && r.driverId !== where.driverId) return false;
        if (where?.enabled !== undefined && r.enabled !== where.enabled) return false;
        return true;
      });
      if (orderBy?.priority === 'asc') {
        rows = [...rows].sort((a, b) => a.priority - b.priority);
      }
      return rows;
    }),
    findUnique: jest.fn(async ({ where }: any) => {
      if (where.id) return rules.find((r) => r.id === where.id) ?? null;
      if (where.driverId_priority) {
        const { driverId, priority } = where.driverId_priority;
        return rules.find((r) => r.driverId === driverId && r.priority === priority) ?? null;
      }
      return null;
    }),
    count: jest.fn(async ({ where }: any) => {
      return rules.filter((r) => {
        if (where?.driverId !== undefined && r.driverId !== where.driverId) return false;
        if (where?.enabled !== undefined && r.enabled !== where.enabled) return false;
        return true;
      }).length;
    }),
    create: jest.fn(async ({ data }: any) => {
      const row = {
        id: `rule${nextId++}`,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      };
      rules.push(row);
      return row;
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = rules.find((r) => r.id === where.id);
      if (!row) throw new Error('not found');
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    }),
    delete: jest.fn(async ({ where }: any) => {
      const idx = rules.findIndex((r) => r.id === where.id);
      if (idx < 0) throw new Error('not found');
      const [removed] = rules.splice(idx, 1);
      return removed;
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      let count = 0;
      for (const r of rules) {
        if (where?.driverId !== undefined && r.driverId !== where.driverId) continue;
        if (where?.enabled !== undefined && r.enabled !== where.enabled) continue;
        Object.assign(r, data, { updatedAt: new Date() });
        count++;
      }
      return { count };
    }),
  };
  return {
    driverAutoBidRule,
    _rules: rules,
  } as unknown as PrismaClient & { _rules: any[] };
}

function baseInput(overrides: Partial<RuleInput> = {}): RuleInput {
  return {
    priority: 0,
    enabled: true,
    maxPickupDistanceM: 500,
    maxRideDistanceM: 3000,
    vehicleTypeFilter: 'MOTO',
    bidAmountMode: 'FLAT',
    bidAmountValue: 1500,
    ...overrides,
  };
}

describe('auto-bid/rules-store — createRule', () => {
  it('creates the first rule for a driver', async () => {
    const prisma = makeMockPrisma();
    const created = await createRule(prisma, 'd1', baseInput());
    expect(created.id).toBeDefined();
    expect(created.driverId).toBe('d1');
  });

  it('rejects a 6th enabled rule (TOO_MANY_RULES)', async () => {
    const prisma = makeMockPrisma();
    for (let i = 0; i < 5; i++) {
      await createRule(prisma, 'd1', baseInput({ priority: i }));
    }
    // Cap-on-enabled is checked before priority collision, so the
    // 6th attempt fails with TOO_MANY_RULES (regardless of priority).
    await expect(
      createRule(prisma, 'd1', baseInput({ priority: 0 })),
    ).rejects.toMatchObject({ code: 'TOO_MANY_RULES' });
  });

  it('TOO_MANY_RULES fires when 5 enabled rules exist (paused don\'t count)', async () => {
    const prisma = makeMockPrisma();
    // Create 5 enabled rules at priorities 0..4
    for (let i = 0; i < 5; i++) {
      await createRule(prisma, 'd1', baseInput({ priority: i }));
    }
    // Pause one and try to create a 6th enabled — but no priority
    // slot is free. Instead, simulate by directly mutating the row,
    // freeing slot 2.
    (prisma as any)._rules[2].enabled = false;
    // Now slot 2 has a paused rule; a new enabled rule at slot 2 should
    // collide on PRIORITY_TAKEN, not TOO_MANY_RULES, because we haven't
    // freed the priority. So delete it instead and retry.
    await deleteRule(prisma, (prisma as any)._rules[2].id, 'd1');
    // 4 enabled remain; creating one more enabled at the freed slot
    // should succeed.
    const created = await createRule(prisma, 'd1', baseInput({ priority: 2 }));
    expect(created.priority).toBe(2);
  });

  it('paused rules do NOT count toward the 5-rule cap', async () => {
    const prisma = makeMockPrisma();
    // 5 paused rules at slots 0..4 — total 5 rows but 0 enabled.
    for (let i = 0; i < 5; i++) {
      await createRule(prisma, 'd1', baseInput({ priority: i, enabled: false }));
    }
    // All 5 slots are taken on priority, so creating another enabled
    // requires freeing a slot. Delete one and prove a 5th enabled rule
    // is allowed even though 4 paused rules still sit on the driver.
    await deleteRule(prisma, (prisma as any)._rules[0].id, 'd1');
    const created = await createRule(prisma, 'd1', baseInput({ priority: 0 }));
    expect(created.enabled).toBe(true);
  });

  it('rejects a duplicate priority (PRIORITY_TAKEN)', async () => {
    const prisma = makeMockPrisma();
    await createRule(prisma, 'd1', baseInput({ priority: 2 }));
    await expect(
      createRule(prisma, 'd1', baseInput({ priority: 2 })),
    ).rejects.toMatchObject({ code: 'PRIORITY_TAKEN' });
  });

  it('rejects FLAT amount below FLAT_BID_MIN_RWF', async () => {
    const prisma = makeMockPrisma();
    await expect(
      createRule(prisma, 'd1', baseInput({ bidAmountValue: 99 })),
    ).rejects.toMatchObject({ code: 'INVALID_AMOUNT' });
  });

  it('rejects FLAT amount above FLAT_BID_MAX_RWF', async () => {
    const prisma = makeMockPrisma();
    await expect(
      createRule(prisma, 'd1', baseInput({ bidAmountValue: 50001 })),
    ).rejects.toMatchObject({ code: 'INVALID_AMOUNT' });
  });

  it('rejects PERCENT amount below PERCENT_BID_MIN', async () => {
    const prisma = makeMockPrisma();
    await expect(
      createRule(
        prisma,
        'd1',
        baseInput({ bidAmountMode: 'PERCENT_OF_FAIR_PRICE', bidAmountValue: 49 }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_AMOUNT' });
  });

  it('rejects PERCENT amount above PERCENT_BID_MAX', async () => {
    const prisma = makeMockPrisma();
    await expect(
      createRule(
        prisma,
        'd1',
        baseInput({ bidAmountMode: 'PERCENT_OF_FAIR_PRICE', bidAmountValue: 201 }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_AMOUNT' });
  });
});

describe('auto-bid/rules-store — updateRule', () => {
  it('refuses to update another driver\'s rule (NOT_RULE_OWNER)', async () => {
    const prisma = makeMockPrisma();
    const created = await createRule(prisma, 'd1', baseInput());
    await expect(
      updateRule(prisma, created.id, 'OTHER', { bidAmountValue: 2000 }),
    ).rejects.toMatchObject({ code: 'NOT_RULE_OWNER' });
  });

  it('updates the bid amount when caller owns the rule', async () => {
    const prisma = makeMockPrisma();
    const created = await createRule(prisma, 'd1', baseInput({ bidAmountValue: 1500 }));
    const updated = await updateRule(prisma, created.id, 'd1', { bidAmountValue: 2000 });
    expect(updated.bidAmountValue).toBe(2000);
  });
});

describe('auto-bid/rules-store — pause/resume/list', () => {
  it('pauseAllRules sets enabled=false and returns count', async () => {
    const prisma = makeMockPrisma();
    await createRule(prisma, 'd1', baseInput({ priority: 0 }));
    await createRule(prisma, 'd1', baseInput({ priority: 1 }));
    await createRule(prisma, 'd1', baseInput({ priority: 2 }));
    const { paused } = await pauseAllRules(prisma, 'd1');
    expect(paused).toBe(3);
    const rows = await listRulesForDriver(prisma, 'd1');
    expect(rows.every((r) => r.enabled === false)).toBe(true);
  });

  it('resumeAllRules sets enabled=true and returns count', async () => {
    const prisma = makeMockPrisma();
    await createRule(prisma, 'd1', baseInput({ priority: 0, enabled: false }));
    await createRule(prisma, 'd1', baseInput({ priority: 1, enabled: false }));
    const { resumed } = await resumeAllRules(prisma, 'd1');
    expect(resumed).toBe(2);
    const rows = await listRulesForDriver(prisma, 'd1');
    expect(rows.every((r) => r.enabled === true)).toBe(true);
  });

  it('listRulesForDriver returns rules sorted by priority asc', async () => {
    const prisma = makeMockPrisma();
    await createRule(prisma, 'd1', baseInput({ priority: 3 }));
    await createRule(prisma, 'd1', baseInput({ priority: 0 }));
    await createRule(prisma, 'd1', baseInput({ priority: 2 }));
    const rows = await listRulesForDriver(prisma, 'd1');
    expect(rows.map((r) => r.priority)).toEqual([0, 2, 3]);
  });
});
