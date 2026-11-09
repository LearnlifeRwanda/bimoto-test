// Cooperative store tests — exercise CRUD + leader assignment +
// driver association via an in-memory Prisma stub. The mock keeps
// the same shape the real code uses (cooperative / user /
// driverProfile + $transaction) so the store code under test runs
// unchanged.

const cooperativeRows = new Map<string, any>();
const userRows = new Map<string, any>();
const driverProfileRows = new Map<string, any>();

function uniqueOrThrow(field: string, value: any, table: Map<string, any>) {
  for (const row of table.values()) {
    if (row[field] === value) {
      const err: any = new Error('UNIQUE_CONSTRAINT');
      err.code = 'P2002';
      throw err;
    }
  }
}

const tx = {
  cooperative: {
    create: jest.fn(async ({ data }: any) => {
      uniqueOrThrow('name', data.name, cooperativeRows);
      const id = `coop-${cooperativeRows.size + 1}`;
      const row = {
        id,
        name: data.name,
        registrationNumber: data.registrationNumber ?? null,
        leaderId: null,
        commissionRate: data.commissionRate ?? 0.0,
        currency: data.currency ?? 'RWF',
        metadata: data.metadata ?? {},
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      cooperativeRows.set(id, row);
      return row;
    }),
    findUnique: jest.fn(async ({ where }: any) => {
      if (where.id) return cooperativeRows.get(where.id) ?? null;
      if (where.name) {
        for (const r of cooperativeRows.values()) {
          if (r.name === where.name) return r;
        }
        return null;
      }
      return null;
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = cooperativeRows.get(where.id);
      if (!row) throw new Error('not-found');
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    }),
  },
  user: {
    findUnique: jest.fn(async ({ where }: any) => userRows.get(where.id) ?? null),
    update: jest.fn(async ({ where, data }: any) => {
      const row = userRows.get(where.id);
      if (!row) throw new Error('not-found');
      Object.assign(row, data);
      return row;
    }),
  },
  driverProfile: {
    findUnique: jest.fn(async ({ where }: any) =>
      driverProfileRows.get(where.id) ?? null,
    ),
    findMany: jest.fn(async ({ where = {}, take, skip }: any = {}) => {
      const all = Array.from(driverProfileRows.values()).filter((r: any) => {
        if (where.cooperativeId !== undefined) {
          return r.cooperativeId === where.cooperativeId;
        }
        return true;
      });
      const start = skip ?? 0;
      return all.slice(start, take ? start + take : undefined);
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = driverProfileRows.get(where.id);
      if (!row) throw new Error('not-found');
      Object.assign(row, data);
      return row;
    }),
  },
};

jest.mock('../../../prisma', () => ({
  __esModule: true,
  default: {
    ...tx,
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  },
}));

import prisma from '../../../prisma';
import {
  createCooperative,
  findCooperativeById,
  findCooperativeByName,
  setCooperativeLeader,
  addDriverToCooperative,
  removeDriverFromCooperative,
  listDriversInCooperative,
} from '../cooperative-store';

beforeEach(() => {
  cooperativeRows.clear();
  userRows.clear();
  driverProfileRows.clear();
  jest.clearAllMocks();
});

describe('cooperative-store', () => {
  test('createCooperative persists with metadata={} and active=true', async () => {
    const coop = await createCooperative(prisma as any, { name: 'FERWACOTAMO' });
    expect(coop.name).toBe('FERWACOTAMO');
    expect(coop.active).toBe(true);
    expect(coop.metadata).toEqual({});
  });

  test('createCooperative duplicate name → unique constraint violation', async () => {
    await createCooperative(prisma as any, { name: 'COOPACTRA' });
    await expect(
      createCooperative(prisma as any, { name: 'COOPACTRA' }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  test('findCooperativeByName returns null for non-existent name', async () => {
    expect(await findCooperativeByName(prisma as any, 'GHOST')).toBeNull();
  });

  test('findCooperativeById returns null for unknown id', async () => {
    expect(await findCooperativeById(prisma as any, 'nope')).toBeNull();
  });

  test('setCooperativeLeader: DRIVER becomes BOTH (preserves driver capability)', async () => {
    const coop = await createCooperative(prisma as any, { name: 'FERWACOTAMO' });
    userRows.set('u1', { id: 'u1', role: 'DRIVER' });
    const updated = await setCooperativeLeader(prisma as any, coop.id, 'u1');
    expect(updated.leaderId).toBe('u1');
    expect(userRows.get('u1').role).toBe('BOTH');
    expect(userRows.get('u1').cooperativeId).toBe(coop.id);
  });

  test('setCooperativeLeader: CUSTOMER becomes COOPERATIVE_LEADER', async () => {
    const coop = await createCooperative(prisma as any, { name: 'COOPACTRA' });
    userRows.set('u2', { id: 'u2', role: 'CUSTOMER' });
    await setCooperativeLeader(prisma as any, coop.id, 'u2');
    expect(userRows.get('u2').role).toBe('COOPERATIVE_LEADER');
  });

  test('setCooperativeLeader: ADMIN keeps ADMIN role', async () => {
    const coop = await createCooperative(prisma as any, { name: 'COOPACTRA' });
    userRows.set('admin1', { id: 'admin1', role: 'ADMIN' });
    await setCooperativeLeader(prisma as any, coop.id, 'admin1');
    expect(userRows.get('admin1').role).toBe('ADMIN');
    expect(userRows.get('admin1').cooperativeId).toBe(coop.id);
  });

  test('setCooperativeLeader: non-existent userId throws USER_NOT_FOUND', async () => {
    const coop = await createCooperative(prisma as any, { name: 'COOPACTRA' });
    await expect(
      setCooperativeLeader(prisma as any, coop.id, 'ghost-user'),
    ).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
  });

  test('addDriverToCooperative updates both cooperativeId and cooperativeName', async () => {
    const coop = await createCooperative(prisma as any, { name: 'FERWACOTAMO' });
    driverProfileRows.set('dp1', { id: 'dp1', cooperativeId: null, cooperativeName: null });
    const updated = await addDriverToCooperative(prisma as any, coop.id, 'dp1');
    expect(updated.cooperativeId).toBe(coop.id);
    expect(updated.cooperativeName).toBe('FERWACOTAMO');
  });

  test('removeDriverFromCooperative clears both fields', async () => {
    const coop = await createCooperative(prisma as any, { name: 'FERWACOTAMO' });
    driverProfileRows.set('dp1', {
      id: 'dp1',
      cooperativeId: coop.id,
      cooperativeName: 'FERWACOTAMO',
    });
    const updated = await removeDriverFromCooperative(prisma as any, 'dp1');
    expect(updated.cooperativeId).toBeNull();
    expect(updated.cooperativeName).toBeNull();
  });

  test('listDriversInCooperative paginates and scopes', async () => {
    const a = await createCooperative(prisma as any, { name: 'FERWACOTAMO' });
    const b = await createCooperative(prisma as any, { name: 'COOPACTRA' });
    for (let i = 0; i < 5; i++) {
      driverProfileRows.set(`a${i}`, { id: `a${i}`, cooperativeId: a.id });
    }
    driverProfileRows.set('b1', { id: 'b1', cooperativeId: b.id });

    const page = await listDriversInCooperative(prisma as any, a.id, {
      limit: 3,
      offset: 0,
    });
    expect(page).toHaveLength(3);
    expect(page.every((r: any) => r.cooperativeId === a.id)).toBe(true);

    const page2 = await listDriversInCooperative(prisma as any, a.id, {
      limit: 3,
      offset: 3,
    });
    expect(page2).toHaveLength(2);
  });
});
