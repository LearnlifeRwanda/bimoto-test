import { EscrowStatus } from '@bimoto/shared';

jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    $transaction: jest.fn(),
    escrow: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    driverProfile: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    escrowAuditLog: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    journey: {
      update: jest.fn(),
    },
    bid: {
      updateMany: jest.fn(),
    },
  },
}));

import prisma from '../prisma';
import * as escrowService from '../services/escrow.service';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Escrow Service', () => {
  describe('createEscrow', () => {
    test('creates escrow with tiered commission and payout', async () => {
      (mockPrisma.$transaction as jest.Mock).mockImplementation(async (fn: Function) => {
        const tx = {
          escrow: {
            create: jest.fn().mockResolvedValue({
              id: 'e1',
              journeyId: 'j1',
              customerId: 'c1',
              driverId: 'd1',
              amount: 2000,
              commission: 100,
              driverPayout: 1900,
              driverTier: 'PRO',
              customerTier: 'SUPER',
              driverCommissionRate: 0.025,
              customerCommissionRate: 0.025,
              status: EscrowStatus.HELD,
            }),
          },
          escrowAuditLog: {
            findFirst: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue({}),
          },
        };
        return fn(tx);
      });

      const result = await escrowService.createEscrow('j1', 'c1', 'd1', 2000, {
        totalCommissionAmount: 100,
        driverPayout: 1900,
        driverTier: { tier: 'PRO', commissionRate: 0.025 },
        customerTier: { tier: 'SUPER', commissionRate: 0.025 },
      });

      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });
  });

  describe('releaseEscrow', () => {
    test('transitions HELD escrow to RELEASED', async () => {
      (mockPrisma.escrow.findUnique as jest.Mock).mockResolvedValue({
        id: 'e1',
        journeyId: 'j1',
        driverId: 'd1',
        amount: 2000,
        status: EscrowStatus.HELD,
      });

      (mockPrisma.$transaction as jest.Mock).mockImplementation(async (fn: Function) => {
        const tx = {
          escrow: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            findUnique: jest.fn().mockResolvedValue({
              id: 'e1',
              status: EscrowStatus.RELEASED,
            }),
          },
          driverProfile: {
            update: jest.fn().mockResolvedValue({}),
          },
          user: {
            update: jest.fn().mockResolvedValue({}),
          },
          driverBalance: {
            upsert: jest.fn().mockResolvedValue({}),
          },
          escrowAuditLog: {
            findFirst: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue({}),
          },
        };
        return fn(tx);
      });

      const result = await escrowService.releaseEscrow('j1', 'c1');

      expect(result.status).toBe(EscrowStatus.RELEASED);
    });

    test('throws when escrow not found', async () => {
      (mockPrisma.escrow.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(escrowService.releaseEscrow('j1', 'c1'))
        .rejects.toThrow('errors.escrowNotFound');
    });
  });

  describe('refundEscrow', () => {
    test('transitions HELD escrow to REFUNDED', async () => {
      (mockPrisma.escrow.findUnique as jest.Mock).mockResolvedValue({
        id: 'e1',
        journeyId: 'j1',
        amount: 2000,
        status: EscrowStatus.HELD,
      });

      (mockPrisma.$transaction as jest.Mock).mockImplementation(async (fn: Function) => {
        const tx = {
          escrow: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            findUnique: jest.fn().mockResolvedValue({
              id: 'e1',
              status: EscrowStatus.REFUNDED,
            }),
          },
          escrowAuditLog: {
            findFirst: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue({}),
          },
        };
        return fn(tx);
      });

      const result = await escrowService.refundEscrow('j1', 'c1');

      expect(result.status).toBe(EscrowStatus.REFUNDED);
    });
  });

  describe('freezeEscrow', () => {
    test('transitions HELD escrow to FROZEN', async () => {
      (mockPrisma.escrow.findUnique as jest.Mock).mockResolvedValue({
        id: 'e1',
        journeyId: 'j1',
        amount: 2000,
        status: EscrowStatus.HELD,
      });

      (mockPrisma.$transaction as jest.Mock).mockImplementation(async (fn: Function) => {
        const tx = {
          escrow: {
            update: jest.fn().mockResolvedValue({
              id: 'e1',
              status: EscrowStatus.FROZEN,
            }),
          },
          escrowAuditLog: {
            findFirst: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue({}),
          },
        };
        return fn(tx);
      });

      const result = await escrowService.freezeEscrow('j1', 'c1');

      expect(result.status).toBe(EscrowStatus.FROZEN);
    });

    test('returns existing escrow if already FROZEN without updating', async () => {
      const frozenEscrow = {
        id: 'e1',
        journeyId: 'j1',
        amount: 2000,
        status: EscrowStatus.FROZEN,
      };
      (mockPrisma.escrow.findUnique as jest.Mock).mockResolvedValue(frozenEscrow);

      const result = await escrowService.freezeEscrow('j1', 'c1');

      expect(result.status).toBe(EscrowStatus.FROZEN);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
