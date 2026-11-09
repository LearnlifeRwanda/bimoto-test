import { JourneyStatus, BidStatus } from '@bimoto/shared';

jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    journey: { findUnique: jest.fn() },
    bid: { findUnique: jest.fn(), create: jest.fn() },
    driverProfile: { findUnique: jest.fn() },
    // R3-N-4 added a suspension check in bid.service.createBid that
    // calls prisma.user.findUnique. These verification-gate tests
    // predate the feature; default to "not suspended" so the gate
    // passes through to the verification logic under test.
    user: { findUnique: jest.fn().mockResolvedValue({ suspendedUntil: null }) },
  },
}));

jest.mock('../services/escrow.service', () => ({
  createEscrow: jest.fn().mockResolvedValue({}),
}));

// Must mock config BEFORE importing bid service
jest.mock('../config', () => ({
  config: {
    SKIP_DRIVER_VERIFICATION: false,
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

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

beforeEach(() => {
  jest.clearAllMocks();
  (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({ suspendedUntil: null });
});

describe('Driver Verification Gate', () => {
  test('MOTO driver with PENDING status cannot bid', async () => {
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue({
      id: 'j1',
      status: JourneyStatus.REQUESTED,
      vehiclePreference: null,
    });
    (mockPrisma.bid.findUnique as jest.Mock).mockResolvedValue(null);
    (mockPrisma.driverProfile.findUnique as jest.Mock).mockResolvedValue({
      userId: 'd1',
      vehicleType: 'MOTO',
      totalRides: 5,
      verificationStatus: 'PENDING',
    });

    await expect(bidService.createBid('j1', 'd1', 1500, 5))
      .rejects.toThrow('errors.driverNotVerified');
  });

  test('MOTO driver with VERIFIED status can bid', async () => {
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue({
      id: 'j1',
      status: JourneyStatus.REQUESTED,
      vehiclePreference: null,
    });
    (mockPrisma.bid.findUnique as jest.Mock).mockResolvedValue(null);
    (mockPrisma.driverProfile.findUnique as jest.Mock).mockResolvedValue({
      userId: 'd1',
      vehicleType: 'MOTO',
      totalRides: 5,
      verificationStatus: 'VERIFIED',
      drivingLicenseNumber: 'DL-123',
      ruraAuthorizationNumber: 'RURA-456',
      cooperativeName: 'Test Coop',
      insuranceConfirmed: true,
      registrationPlate: 'RAC 123A',
    });
    (mockPrisma.bid.create as jest.Mock).mockResolvedValue({
      id: 'b1',
      journeyId: 'j1',
      driverId: 'd1',
      price: 1500,
      etaMinutes: 5,
      status: BidStatus.PENDING,
    });

    const result = await bidService.createBid('j1', 'd1', 1500, 5);
    expect(result.status).toBe(BidStatus.PENDING);
  });

  test('MOTO driver with UNDER_REVIEW status cannot bid', async () => {
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue({
      id: 'j1',
      status: JourneyStatus.REQUESTED,
      vehiclePreference: null,
    });
    (mockPrisma.bid.findUnique as jest.Mock).mockResolvedValue(null);
    (mockPrisma.driverProfile.findUnique as jest.Mock).mockResolvedValue({
      userId: 'd1',
      vehicleType: 'MOTO',
      totalRides: 5,
      verificationStatus: 'UNDER_REVIEW',
    });

    await expect(bidService.createBid('j1', 'd1', 1500, 5))
      .rejects.toThrow('errors.driverNotVerified');
  });

  test('MOTO driver with REVOKED status cannot bid (DRIVER-ID v3)', async () => {
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue({
      id: 'j1',
      status: JourneyStatus.REQUESTED,
      vehiclePreference: null,
    });
    (mockPrisma.bid.findUnique as jest.Mock).mockResolvedValue(null);
    (mockPrisma.driverProfile.findUnique as jest.Mock).mockResolvedValue({
      userId: 'd1',
      vehicleType: 'MOTO',
      totalRides: 5,
      verificationStatus: 'REVOKED',
    });

    await expect(bidService.createBid('j1', 'd1', 1500, 5))
      .rejects.toThrow('errors.driverNotVerified');
  });

  test('REVOKED blocks bidding even for BIKE (no regulatory requirements) — revocation is absolute', async () => {
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue({
      id: 'j1',
      status: JourneyStatus.REQUESTED,
      vehiclePreference: null,
    });
    (mockPrisma.bid.findUnique as jest.Mock).mockResolvedValue(null);
    (mockPrisma.driverProfile.findUnique as jest.Mock).mockResolvedValue({
      userId: 'd1',
      vehicleType: 'BIKE',
      totalRides: 0,
      verificationStatus: 'REVOKED',
    });

    await expect(bidService.createBid('j1', 'd1', 500, 5))
      .rejects.toThrow('errors.driverNotVerified');
  });

  test('BIKE driver can bid without verification (no regulatory requirements)', async () => {
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue({
      id: 'j1',
      status: JourneyStatus.REQUESTED,
      vehiclePreference: null,
    });
    (mockPrisma.bid.findUnique as jest.Mock).mockResolvedValue(null);
    (mockPrisma.driverProfile.findUnique as jest.Mock).mockResolvedValue({
      userId: 'd1',
      vehicleType: 'BIKE',
      totalRides: 0,
      verificationStatus: 'PENDING',
    });
    (mockPrisma.bid.create as jest.Mock).mockResolvedValue({
      id: 'b1',
      journeyId: 'j1',
      driverId: 'd1',
      price: 500,
      etaMinutes: 10,
      status: BidStatus.PENDING,
    });

    const result = await bidService.createBid('j1', 'd1', 500, 10);
    expect(result.status).toBe(BidStatus.PENDING);
  });

  test('E_BIKE driver can bid without verification (no regulatory requirements currently)', async () => {
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue({
      id: 'j1',
      status: JourneyStatus.REQUESTED,
      vehiclePreference: null,
    });
    (mockPrisma.bid.findUnique as jest.Mock).mockResolvedValue(null);
    (mockPrisma.driverProfile.findUnique as jest.Mock).mockResolvedValue({
      userId: 'd1',
      vehicleType: 'E_BIKE',
      totalRides: 0,
      verificationStatus: 'PENDING',
    });
    (mockPrisma.bid.create as jest.Mock).mockResolvedValue({
      id: 'b1',
      journeyId: 'j1',
      driverId: 'd1',
      price: 800,
      etaMinutes: 8,
      status: BidStatus.PENDING,
    });

    const result = await bidService.createBid('j1', 'd1', 800, 8);
    expect(result.status).toBe(BidStatus.PENDING);
  });
});
