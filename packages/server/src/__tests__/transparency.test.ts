import {
  calculateCommission,
  getDriverTier,
  getCustomerTier,
  DRIVER_TIERS,
  CUSTOMER_TIERS,
} from '@bimoto/shared';

jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    journey: { findUnique: jest.fn() },
    bid: { findMany: jest.fn() },
    user: { findUnique: jest.fn() },
    driverProfile: { findUnique: jest.fn() },
    // DRIVER-ID v3 G4 — getBidsForJourney consults the vehicle-change
    // ledger for the "updated recently" flag; default to no changes.
    vehicleChangeLog: { findMany: jest.fn().mockResolvedValue([]) },
    // LAUNCH-TRUTH G3 — getBidsForJourney resolves fee waivers per
    // bidding driver; default to no waiver.
    feeWaiver: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
  },
}));

jest.mock('../services/escrow.service', () => ({
  createEscrow: jest.fn().mockResolvedValue({}),
}));

jest.mock('../config', () => ({
  config: {
    SKIP_DRIVER_VERIFICATION: true,
    DATABASE_URL: 'test',
    JWT_SECRET: 'test-jwt-secret-at-least-16-chars',
    JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-16-chars',
    ENCRYPTION_KEY: 'a'.repeat(64),
    PORT: 3000,
    CLIENT_URL: 'http://localhost:5173',
    NODE_ENV: 'test',
  },
}));

import prisma from '../prisma';
import * as bidService from '../services/bid.service';
import type { FullCommissionBreakdown } from '../services/commission-view';

/**
 * CUTGUARD v2 G3 — narrow a bid-list breakdown to the DRIVER shape.
 *
 * `commissionBreakdown` is now a union: a customer receives the branded
 * customer-safe four, a driver receives the full ladder. That union is
 * the fix — an inline literal can no longer be handed to a passenger —
 * and it means a test reading `driverPayout` has to SAY it is looking at
 * the driver's view. Which is a better test than the one it replaces:
 * it now proves the shape as well as the numbers.
 */
function driverView(breakdown: unknown): FullCommissionBreakdown {
  const b = breakdown as FullCommissionBreakdown;
  expect(b).toBeDefined();
  expect(b.driverPayout).toBeDefined();
  return b;
}

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Price Transparency', () => {
  describe('calculateCommission savings', () => {
    test('customerSavings and driverSavings are correct for all 16 tier combinations', () => {
      const bidPrice = 2000;
      const driverRideCounts = [0, 50, 200, 500];
      const customerRideCounts = [0, 20, 50, 100];

      const maxDriverRate = DRIVER_TIERS[0].commissionRate;   // 0.05
      const maxCustomerRate = CUSTOMER_TIERS[0].commissionRate; // 0.05

      for (const dr of driverRideCounts) {
        for (const cr of customerRideCounts) {
          const result = calculateCommission(bidPrice, dr, cr);
          const expectedDriverSavings = Math.round(bidPrice * (maxDriverRate - result.driverCommissionRate));
          const expectedCustomerSavings = Math.round(bidPrice * (maxCustomerRate - result.customerCommissionRate));

          expect(result.driverSavings).toBe(expectedDriverSavings);
          expect(result.customerSavings).toBe(expectedCustomerSavings);
        }
      }
    });

    test('NEW driver + REGULAR customer have zero savings', () => {
      const result = calculateCommission(2000, 0, 0);
      expect(result.driverSavings).toBe(0);
      expect(result.customerSavings).toBe(0);
    });

    test('ELITE driver + VIP customer have max savings', () => {
      const result = calculateCommission(2000, 500, 100);
      // ELITE: 1.5% vs NEW: 5% -> saves 3.5% of 2000 = 70
      expect(result.driverSavings).toBe(70);
      // VIP: 1.5% vs REGULAR: 5% -> saves 3.5% of 2000 = 70
      expect(result.customerSavings).toBe(70);
    });

    test('PRO driver savings on 2000 RWF bid', () => {
      const result = calculateCommission(2000, 200, 0);
      // PRO: 2.5% vs NEW: 5% -> saves 2.5% of 2000 = 50
      expect(result.driverSavings).toBe(50);
      expect(result.customerSavings).toBe(0); // REGULAR customer
    });
  });

  describe('Live payout range for driver', () => {
    test('PRO driver (2.5%) with 2000 RWF bid shows correct range', () => {
      const bidPrice = 2000;
      const driverTier = getDriverTier(200); // PRO
      expect(driverTier.commissionRate).toBe(0.025);

      const sortedCustomerTiers = [...CUSTOMER_TIERS].sort((a, b) => a.commissionRate - b.commissionRate);
      const minCustomerRate = sortedCustomerTiers[0].commissionRate; // VIP: 1.5%
      const maxCustomerRate = sortedCustomerTiers[sortedCustomerTiers.length - 1].commissionRate; // Regular: 5.0%

      expect(minCustomerRate).toBe(0.015);
      expect(maxCustomerRate).toBe(0.05);

      const maxTotalRate = driverTier.commissionRate + maxCustomerRate; // 7.5%
      const minTotalRate = driverTier.commissionRate + minCustomerRate; // 4.0%

      const minPayout = bidPrice - Math.round(bidPrice * maxTotalRate); // 2000 - 150 = 1850
      const maxPayout = bidPrice - Math.round(bidPrice * minTotalRate); // 2000 - 80 = 1920

      expect(minPayout).toBe(1850);
      expect(maxPayout).toBe(1920);
    });

    test('ELITE driver (1.5%) with 10000 RWF bid', () => {
      const bidPrice = 10000;
      const driverTier = getDriverTier(500); // ELITE
      expect(driverTier.commissionRate).toBe(0.015);

      const minPayout = bidPrice - Math.round(bidPrice * (0.015 + 0.05)); // 10000 - 650 = 9350
      const maxPayout = bidPrice - Math.round(bidPrice * (0.015 + 0.015)); // 10000 - 300 = 9700

      expect(minPayout).toBe(9350);
      expect(maxPayout).toBe(9700);
    });
  });

  describe('Commission breakdown in bid list', () => {
    // LIVE-WIRE G4 — the breakdown is the DRIVER's money, so it is
    // serialized for the driver who placed the bid. The customer-scoped
    // half of this contract is asserted in
    // __tests__/live-wire-role-scoped-payload.test.ts.
    test('getBidsForJourney includes commissionBreakdown on the bidding driver\'s own bid', async () => {
      (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue({
        id: 'j1',
        customerId: 'c1',
        status: 'REQUESTED',
      });
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'c1',
        completedRides: 50, // SUPER customer
      });
      (mockPrisma.bid.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'b1',
          journeyId: 'j1',
          driverId: 'd1',
          price: 2000,
          etaMinutes: 5,
          status: 'PENDING',
          createdAt: new Date(),
          updatedAt: new Date(),
          driver: {
            nickname: 'Jean',
            driverProfile: {
              avgRating: 4.5,
              totalRides: 200, // PRO driver
              vehicleType: 'MOTO',
              vehicleDescription: 'Honda',
              registrationPlate: 'RAB123',
              verificationStatus: 'VERIFIED',
              ruraAuthorizationNumber: 'RURA-001',
              insuranceConfirmed: true,
              cooperativeName: 'Coop A',
            },
          },
        },
      ]);

      const result = await bidService.getBidsForJourney('j1', 'd1');

      expect(result).toHaveLength(1);
      const breakdown = driverView(result[0].commissionBreakdown);
      expect(breakdown.bidPrice).toBe(2000);
      expect(breakdown.driverTier).toBe('PRO');
      expect(breakdown.customerTier).toBe('SUPER');
      expect(breakdown.driverCommissionRate).toBe(0.025);
      expect(breakdown.customerCommissionRate).toBe(0.025);
      expect(breakdown.totalCommissionRate).toBe(0.05);
      expect(breakdown.totalCommissionAmount).toBe(100);
      expect(breakdown.driverPayout).toBe(1900);
      expect(breakdown.customerSavings).toBe(50); // vs Regular 5%
      expect(breakdown.driverSavings).toBe(50);  // vs New 5%
    });
  });

  // LAUNCH-TRUTH G4 — the waived case stays truthful: the nominal
  // commission is still computed and shown; only the CHARGE is zeroed,
  // and the driver's payout is the whole fare.
  describe('Commission breakdown under a pilot fee waiver', () => {
    test('waived bid: nominal commission shown, charged 0, driver receives the full fare', async () => {
      (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue({
        id: 'j1',
        customerId: 'c1',
        status: 'REQUESTED',
      });
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'c1',
        completedRides: 50, // SUPER customer
      });
      ((mockPrisma as any).feeWaiver.findMany as jest.Mock).mockResolvedValue([
        { id: 'fw-1', driverId: 'd1', type: 'LIFETIME', expiresAt: null, revokedAt: null },
      ]);
      (mockPrisma.bid.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'b1',
          journeyId: 'j1',
          driverId: 'd1',
          price: 2000,
          etaMinutes: 5,
          status: 'PENDING',
          createdAt: new Date(),
          updatedAt: new Date(),
          driver: {
            nickname: 'Jean',
            driverProfile: {
              avgRating: 4.5,
              totalRides: 200, // PRO driver
              vehicleType: 'MOTO',
              vehicleDescription: 'Honda',
              verificationStatus: 'VERIFIED',
            },
          },
        },
      ]);

      const result = await bidService.getBidsForJourney('j1', 'd1');
      const breakdown = result[0].commissionBreakdown as any;

      // The nominal ladder is untouched — computed, never skipped.
      expect(breakdown.totalCommissionAmount).toBe(100);
      expect(breakdown.totalCommissionRate).toBe(0.05);
      // The charge is zeroed and shown as waived.
      expect(breakdown.feeWaiverApplied).toBe(true);
      expect(breakdown.chargedCommissionAmount).toBe(0);
      expect(breakdown.waivedCommissionAmount).toBe(100);
      // The driver keeps 100% of the fare.
      expect(breakdown.driverPayout).toBe(2000);
    });
  });

  describe('Tier status computation', () => {
    test('NEW driver tier at 0 rides', () => {
      const tier = getDriverTier(0);
      expect(tier.tier).toBe('NEW');
      expect(tier.commissionRate).toBe(0.05);
    });

    test('next tier for REGULAR driver at 50 rides is PRO at 200', () => {
      const tier = getDriverTier(50);
      expect(tier.tier).toBe('REGULAR');

      const sortedTiers = [...DRIVER_TIERS].sort((a, b) => a.minRides - b.minRides);
      const idx = sortedTiers.findIndex(t => t.tier === tier.tier);
      const nextTier = sortedTiers[idx + 1];
      expect(nextTier.tier).toBe('PRO');
      expect(nextTier.minRides).toBe(200);
      expect(200 - 50).toBe(150); // rides until next tier
    });

    test('ELITE driver has no next tier', () => {
      const tier = getDriverTier(500);
      expect(tier.tier).toBe('ELITE');

      const sortedTiers = [...DRIVER_TIERS].sort((a, b) => a.minRides - b.minRides);
      const idx = sortedTiers.findIndex(t => t.tier === tier.tier);
      expect(idx).toBe(sortedTiers.length - 1); // last tier
    });

    test('VIP customer has no next tier', () => {
      const tier = getCustomerTier(100);
      expect(tier.tier).toBe('VIP');

      const sortedTiers = [...CUSTOMER_TIERS].sort((a, b) => a.minRides - b.minRides);
      const idx = sortedTiers.findIndex(t => t.tier === tier.tier);
      expect(idx).toBe(sortedTiers.length - 1);
    });

    test('FREQUENT customer at 30 rides: 20 rides to SUPER', () => {
      const tier = getCustomerTier(30);
      expect(tier.tier).toBe('FREQUENT');

      const sortedTiers = [...CUSTOMER_TIERS].sort((a, b) => a.minRides - b.minRides);
      const idx = sortedTiers.findIndex(t => t.tier === tier.tier);
      const nextTier = sortedTiers[idx + 1];
      expect(nextTier.tier).toBe('SUPER');
      expect(nextTier.minRides - 30).toBe(20);
    });
  });
});
