// SERVICES/CUSTOMER-MODES/__TESTS__/BID-HOOK.TEST.TS
//
// Dispatch K3 group 5 — verifies the createBid → tryAutoAcceptBid
// fire-and-forget hook fires correctly, swallows errors without
// blocking createBid, and fires exactly once per bid (race-safe).

jest.mock('../../bid.service', () => {
  const actual = jest.requireActual('../../bid.service');
  return {
    ...actual,
    acceptBid: jest.fn(),
  };
});

jest.mock('../../../prisma', () => ({
  __esModule: true,
  default: {
    journey: { findUnique: jest.fn() },
    bid: { findUnique: jest.fn(), create: jest.fn() },
    driverProfile: { findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  },
}));

jest.mock('../../../config', () => ({
  config: { SKIP_DRIVER_VERIFICATION: true },
}));

jest.mock('../auto-accept', () => ({
  tryAutoAcceptBid: jest.fn(),
}));

import prisma from '../../../prisma';
import * as autoAcceptMock from '../auto-accept';
import * as bidService from '../../bid.service';

const mockPrisma = prisma as any;
const mockTryAutoAccept = autoAcceptMock.tryAutoAcceptBid as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

function flushSetImmediate(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function setupHappyMocks() {
  mockPrisma.journey.findUnique.mockResolvedValue({
    id: 'j1',
    status: 'REQUESTED',
    vehiclePreference: null,
    bookingMode: 'IMMEDIATE',
  });
  mockPrisma.bid.findUnique.mockResolvedValue(null);
  mockPrisma.driverProfile.findUnique.mockResolvedValue({
    userId: 'd1',
    vehicleType: 'MOTO',
    verificationStatus: 'VERIFIED',
  });
  mockPrisma.bid.create.mockResolvedValue({
    id: 'b1',
    journeyId: 'j1',
    driverId: 'd1',
    price: 2400,
    etaMinutes: 5,
    status: 'PENDING',
  });
}

describe('createBid → auto-accept hook', () => {
  it('fires tryAutoAcceptBid in setImmediate after bid creation', async () => {
    setupHappyMocks();
    mockTryAutoAccept.mockResolvedValue({
      triggered: true,
      bidId: 'b1',
      reason: 'auto-accepted',
    });

    const bid = await bidService.createBid('j1', 'd1', 2400, 5);

    expect(bid.id).toBe('b1');
    // The hook is fire-and-forget — flush microtasks/setImmediate.
    expect(mockTryAutoAccept).not.toHaveBeenCalled();
    await flushSetImmediate();
    expect(mockTryAutoAccept).toHaveBeenCalledTimes(1);
    expect(mockTryAutoAccept).toHaveBeenCalledWith(
      prisma,
      'j1',
      'b1',
      expect.any(Date),
    );
  });

  it('createBid succeeds even when auto-accept hook throws', async () => {
    setupHappyMocks();
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockTryAutoAccept.mockRejectedValue(new Error('boom'));

    const bid = await bidService.createBid('j1', 'd1', 2400, 5);
    await flushSetImmediate();
    // Allow the rejected promise's catch handler to run.
    await flushSetImmediate();

    expect(bid.id).toBe('b1');
    expect(warnSpy).toHaveBeenCalledWith(
      '[K3] auto-accept-hook-failed',
      expect.objectContaining({ journeyId: 'j1', bidId: 'b1' }),
    );
    warnSpy.mockRestore();
  });

  it('does not call auto-accept if bid creation itself fails', async () => {
    mockPrisma.journey.findUnique.mockResolvedValue(null);
    await expect(bidService.createBid('j1', 'd1', 2400, 5)).rejects.toThrow();
    await flushSetImmediate();
    expect(mockTryAutoAccept).not.toHaveBeenCalled();
  });
});
