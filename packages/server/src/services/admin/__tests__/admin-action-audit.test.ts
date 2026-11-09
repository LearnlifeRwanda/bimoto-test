jest.mock('../../../prisma', () => {
  const rows: any[] = [];
  return {
    __esModule: true,
    default: {
      adminAction: {
        findFirst: jest.fn(async (args: any) => {
          if (rows.length === 0) return null;
          const sorted = [...rows].sort(
            (a, b) =>
              (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime(),
          );
          return sorted[0];
        }),
        findMany: jest.fn(async () =>
          [...rows].sort(
            (a, b) =>
              (a.createdAt as Date).getTime() - (b.createdAt as Date).getTime(),
          ),
        ),
        create: jest.fn(async ({ data }: any) => {
          const row = {
            id: `a-${rows.length + 1}`,
            ...data,
            payload: data.payload ?? {},
          };
          rows.push(row);
          return row;
        }),
        __rows: rows,
      },
      $transaction: jest.fn(async (fn: any) => fn((globalThis as any).__prismaMock)),
    },
  };
});

import prisma from '../../../prisma';
import {
  appendAdminAction,
  appendAdminActionTx,
  verifyAdminActionChain,
  computeAdminActionHash,
} from '../admin-action-audit.service';

const mockPrisma = prisma as any;
(globalThis as any).__prismaMock = mockPrisma;

beforeEach(() => {
  mockPrisma.adminAction.__rows.length = 0;
  jest.clearAllMocks();
});

describe('AdminAction hash chain', () => {
  test('first append uses empty prevHash', async () => {
    const row = await appendAdminAction({
      adminId: '00000000-0000-0000-0000-000000000001',
      action: 'FREEZE_USER',
      targetType: 'USER',
      targetId: 'u1',
      reason: 'AML CRITICAL',
    });
    expect(row.prevHash).toBe('');
    expect(row.entryHash).toMatch(/^[a-f0-9]{64}$/);
  });

  test('second append chains to first', async () => {
    const first = await appendAdminAction({
      adminId: '00000000-0000-0000-0000-000000000001',
      action: 'FREEZE_USER',
      targetType: 'USER',
      targetId: 'u1',
      reason: 'AML CRITICAL',
    });
    const second = await appendAdminAction({
      adminId: '00000000-0000-0000-0000-000000000001',
      action: 'UNFREEZE_USER',
      targetType: 'USER',
      targetId: 'u1',
      reason: 'cleared after appeal',
    });
    expect(second.prevHash).toBe(first.entryHash);
  });

  test('verifyAdminActionChain returns valid for a clean chain', async () => {
    await appendAdminAction({
      adminId: '00000000-0000-0000-0000-000000000001',
      action: 'FREEZE_USER',
      targetType: 'USER',
      targetId: 'u1',
      reason: 'AML CRITICAL',
    });
    await appendAdminAction({
      adminId: '00000000-0000-0000-0000-000000000001',
      action: 'UNFREEZE_USER',
      targetType: 'USER',
      targetId: 'u1',
      reason: 'cleared after appeal',
    });
    const result = await verifyAdminActionChain();
    expect(result.valid).toBe(true);
    expect(result.brokenAt).toBeNull();
    expect(result.entries).toBe(2);
  });

  test('tampered payload is detected', async () => {
    const a = await appendAdminAction({
      adminId: '00000000-0000-0000-0000-000000000001',
      action: 'FREEZE_USER',
      targetType: 'USER',
      targetId: 'u1',
      reason: 'AML CRITICAL',
    });
    // Direct mutation of stored row simulates DB tamper.
    mockPrisma.adminAction.__rows[0].reason = 'EVIL';
    const result = await verifyAdminActionChain();
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(a.id);
  });

  test('broken prevHash is detected', async () => {
    await appendAdminAction({
      adminId: '00000000-0000-0000-0000-000000000001',
      action: 'FREEZE_USER',
      targetType: 'USER',
      targetId: 'u1',
      reason: 'AML CRITICAL',
    });
    await appendAdminAction({
      adminId: '00000000-0000-0000-0000-000000000001',
      action: 'UNFREEZE_USER',
      targetType: 'USER',
      targetId: 'u1',
      reason: 'cleared after appeal',
    });
    // Break the second row's prevHash so chain link no longer matches.
    mockPrisma.adminAction.__rows[1].prevHash = 'deadbeef';
    const result = await verifyAdminActionChain();
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(mockPrisma.adminAction.__rows[1].id);
  });

  test('canonical hash is deterministic regardless of input key order', () => {
    const ts = '2026-05-04T20:00:00.000Z';
    const a = computeAdminActionHash({
      adminId: 'a',
      action: 'FREEZE_USER',
      targetType: 'USER',
      targetId: 'u',
      reason: 'r',
      payload: { y: 2, x: 1 },
      conflictType: null,
      conflictDecision: null,
      prevHash: '',
      timestamp: ts,
    });
    const b = computeAdminActionHash({
      timestamp: ts,
      prevHash: '',
      conflictDecision: null,
      conflictType: null,
      payload: { x: 1, y: 2 },
      reason: 'r',
      targetId: 'u',
      targetType: 'USER',
      action: 'FREEZE_USER',
      adminId: 'a',
    });
    expect(a).toBe(b);
  });
});
