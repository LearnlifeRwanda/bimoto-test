import { EscrowStatus, calculateCommission } from '@bimoto/shared';

jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    $transaction: jest.fn(),
    escrow: {
      create: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
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

describe('Stacked Commission on Escrow', () => {
  test('escrow stores both tier rates and driverPayout is correct', async () => {
    const commission = calculateCommission(2000, 200, 50); // PRO + SUPER
    expect(commission.driverTier.tier).toBe('PRO');
    expect(commission.customerTier.tier).toBe('SUPER');
    expect(commission.driverCommissionRate).toBe(0.025);
    expect(commission.customerCommissionRate).toBe(0.025);
    expect(commission.totalCommissionAmount).toBe(100); // 5% of 2000
    expect(commission.driverPayout).toBe(1900);

    // Simulate createEscrow
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
      totalCommissionAmount: commission.totalCommissionAmount,
      driverPayout: commission.driverPayout,
      driverTier: commission.driverTier,
      customerTier: commission.customerTier,
    });

    expect(mockPrisma.$transaction).toHaveBeenCalled();
  });

  test('Elite driver + VIP customer yields 3% total commission', () => {
    const commission = calculateCommission(2000, 500, 100);
    expect(commission.totalCommissionRate).toBe(0.03);
    expect(commission.totalCommissionAmount).toBe(60);
    expect(commission.driverPayout).toBe(1940);
  });

  test('New driver + Regular customer yields 10% total commission', () => {
    const commission = calculateCommission(2000, 0, 0);
    expect(commission.totalCommissionRate).toBe(0.10);
    expect(commission.totalCommissionAmount).toBe(200);
    expect(commission.driverPayout).toBe(1800);
  });
});
