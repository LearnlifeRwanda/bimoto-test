import crypto from 'crypto';

jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    escrowAuditLog: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  },
}));

import prisma from '../prisma';
import { appendAuditEntry, verifyAuditChain } from '../services/escrow-audit.service';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

function computeHash(data: {
  sequenceNumber: number;
  action: string;
  escrowId: string;
  amount: number;
  timestamp: string;
  previousHash: string;
}): string {
  const payload = JSON.stringify({
    seq: data.sequenceNumber,
    act: data.action,
    eid: data.escrowId,
    amt: data.amount,
    ts: data.timestamp,
    prev: data.previousHash,
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Escrow Audit Chain', () => {
  test('creates genesis entry with GENESIS previousHash', async () => {
    (mockPrisma.escrowAuditLog.findFirst as jest.Mock).mockResolvedValue(null);
    (mockPrisma.escrowAuditLog.create as jest.Mock).mockResolvedValue({});

    await appendAuditEntry('e1', 'CREATED', 2000, 'c1');

    expect(mockPrisma.escrowAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        escrowId: 'e1',
        sequenceNumber: 0,
        action: 'CREATED',
        previousHash: 'GENESIS',
        amount: 2000,
        triggeredBy: 'c1',
      }),
    });
  });

  test('chains entries with previous entry hash', async () => {
    const firstEntry = {
      sequenceNumber: 0,
      entryHash: 'abc123',
      action: 'CREATED',
    };
    (mockPrisma.escrowAuditLog.findFirst as jest.Mock).mockResolvedValue(firstEntry);
    (mockPrisma.escrowAuditLog.create as jest.Mock).mockResolvedValue({});

    await appendAuditEntry('e1', 'HELD', 2000, 'c1');

    expect(mockPrisma.escrowAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sequenceNumber: 1,
        previousHash: 'abc123',
      }),
    });
  });

  test('verifyAuditChain returns valid for correct chain', async () => {
    const ts1 = '2024-01-01T10:00:00.000Z';
    const ts2 = '2024-01-01T10:01:00.000Z';

    const hash1 = computeHash({
      sequenceNumber: 0, action: 'CREATED', escrowId: 'e1',
      amount: 2000, timestamp: ts1, previousHash: 'GENESIS',
    });
    const hash2 = computeHash({
      sequenceNumber: 1, action: 'RELEASED', escrowId: 'e1',
      amount: 2000, timestamp: ts2, previousHash: hash1,
    });

    (mockPrisma.escrowAuditLog.findMany as jest.Mock).mockResolvedValue([
      {
        sequenceNumber: 0, action: 'CREATED', escrowId: 'e1',
        amount: 2000, createdAt: new Date(ts1), previousHash: 'GENESIS',
        entryHash: hash1,
      },
      {
        sequenceNumber: 1, action: 'RELEASED', escrowId: 'e1',
        amount: 2000, createdAt: new Date(ts2), previousHash: hash1,
        entryHash: hash2,
      },
    ]);

    const result = await verifyAuditChain('e1');
    expect(result.valid).toBe(true);
    expect(result.entries).toBe(2);
  });

  test('verifyAuditChain detects tampering', async () => {
    const ts1 = '2024-01-01T10:00:00.000Z';
    const ts2 = '2024-01-01T10:01:00.000Z';

    const hash1 = computeHash({
      sequenceNumber: 0, action: 'CREATED', escrowId: 'e1',
      amount: 2000, timestamp: ts1, previousHash: 'GENESIS',
    });

    (mockPrisma.escrowAuditLog.findMany as jest.Mock).mockResolvedValue([
      {
        sequenceNumber: 0, action: 'CREATED', escrowId: 'e1',
        amount: 2000, createdAt: new Date(ts1), previousHash: 'GENESIS',
        entryHash: hash1,
      },
      {
        sequenceNumber: 1, action: 'RELEASED', escrowId: 'e1',
        amount: 2000, createdAt: new Date(ts2), previousHash: hash1,
        entryHash: 'tampered-hash', // <-- tampered!
      },
    ]);

    const result = await verifyAuditChain('e1');
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(1);
  });

  test('verifyAuditChain detects broken previousHash', async () => {
    const ts1 = '2024-01-01T10:00:00.000Z';
    const ts2 = '2024-01-01T10:01:00.000Z';

    const hash1 = computeHash({
      sequenceNumber: 0, action: 'CREATED', escrowId: 'e1',
      amount: 2000, timestamp: ts1, previousHash: 'GENESIS',
    });
    const hash2 = computeHash({
      sequenceNumber: 1, action: 'RELEASED', escrowId: 'e1',
      amount: 2000, timestamp: ts2, previousHash: 'wrong-previous-hash',
    });

    (mockPrisma.escrowAuditLog.findMany as jest.Mock).mockResolvedValue([
      {
        sequenceNumber: 0, action: 'CREATED', escrowId: 'e1',
        amount: 2000, createdAt: new Date(ts1), previousHash: 'GENESIS',
        entryHash: hash1,
      },
      {
        sequenceNumber: 1, action: 'RELEASED', escrowId: 'e1',
        amount: 2000, createdAt: new Date(ts2), previousHash: 'wrong-previous-hash',
        entryHash: hash2,
      },
    ]);

    const result = await verifyAuditChain('e1');
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(1);
  });

  test('verifyAuditChain returns valid for empty chain', async () => {
    (mockPrisma.escrowAuditLog.findMany as jest.Mock).mockResolvedValue([]);

    const result = await verifyAuditChain('e1');
    expect(result.valid).toBe(true);
    expect(result.entries).toBe(0);
  });
});
