jest.mock('../prisma', () => {
  const db: any = {
    journey: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    message: {
      create: jest.fn(),
    },
    escrow: {
      findUnique: jest.fn(),
    },
    // MONEY-ATOMIC G3 — disputeJourney now does its writes inside one
    // transaction. The tx handed to the callback is this same object, so
    // every assertion below still reads the same jest.fn call lists.
    $transaction: jest.fn(async (cb: any) => cb(db)),
  };
  return { __esModule: true, default: db };
});

jest.mock('../services/escrow.service', () => ({
  freezeEscrow: jest.fn().mockResolvedValue({}),
  freezeEscrowTx: jest.fn().mockResolvedValue({}),
}));

jest.mock('../services/escrow-audit.service', () => ({
  appendAuditEntry: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../services/journey-validation.service', () => ({
  validateJourneyPlausibility: jest.fn().mockResolvedValue({ valid: true, flags: [] }),
}));

import prisma from '../prisma';
import * as journeyService from '../services/journey.service';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

beforeEach(() => {
  jest.clearAllMocks();
  // The freeze now happens inside the dispute transaction from an escrow
  // row the service loads itself, rather than behind the standalone
  // freezeEscrow(journeyId) that used to load it.
  (mockPrisma.escrow.findUnique as jest.Mock).mockResolvedValue({
    id: 'e1',
    journeyId: 'j1',
    status: 'HELD',
    amount: 2000,
  });
});

describe('Dispute Rate Tracking', () => {
  test('user with 10 rides and 4 disputes (40%) is flagged', async () => {
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue({
      id: 'j1',
      customerId: 'c1',
      driverId: 'd1',
      status: 'AWAITING_CONFIRMATION',
    });
    (mockPrisma.journey.update as jest.Mock).mockResolvedValue({
      id: 'j1',
      status: 'DISPUTED',
    });
    (mockPrisma.message.create as jest.Mock).mockResolvedValue({});

    // After increment, disputeCount = 4 (this is the 4th dispute)
    (mockPrisma.user.update as jest.Mock)
      .mockResolvedValueOnce({
        id: 'c1',
        disputeCount: 4,
        completedRides: 10,
        disputeRate: 0.3,
        isFlagged: false,
      })
      .mockResolvedValueOnce({
        id: 'c1',
        disputeCount: 4,
        completedRides: 10,
        disputeRate: 0.4,
        isFlagged: true,
      });

    await journeyService.disputeJourney('j1', 'c1', 'overcharged');

    // Second user.update call should set isFlagged: true
    const secondCall = (mockPrisma.user.update as jest.Mock).mock.calls[1];
    expect(secondCall[0].data.disputeRate).toBe(0.4);
    expect(secondCall[0].data.isFlagged).toBe(true);
  });

  test('user with 10 rides and 2 disputes (20%) is NOT flagged', async () => {
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue({
      id: 'j1',
      customerId: 'c1',
      driverId: 'd1',
      status: 'AWAITING_CONFIRMATION',
    });
    (mockPrisma.journey.update as jest.Mock).mockResolvedValue({
      id: 'j1',
      status: 'DISPUTED',
    });
    (mockPrisma.message.create as jest.Mock).mockResolvedValue({});

    // After increment, disputeCount = 2
    (mockPrisma.user.update as jest.Mock)
      .mockResolvedValueOnce({
        id: 'c1',
        disputeCount: 2,
        completedRides: 10,
        disputeRate: 0.15,
        isFlagged: false,
      })
      .mockResolvedValueOnce({
        id: 'c1',
        disputeCount: 2,
        completedRides: 10,
        disputeRate: 0.2,
        isFlagged: false,
      });

    await journeyService.disputeJourney('j1', 'c1', 'issue');

    // Second user.update should NOT set isFlagged
    const secondCall = (mockPrisma.user.update as jest.Mock).mock.calls[1];
    expect(secondCall[0].data.disputeRate).toBe(0.2);
    expect(secondCall[0].data).not.toHaveProperty('isFlagged');
  });

  // PILOT-GUARD Item 1(b) — this test used to assert the opposite:
  // `.rejects.toThrow('errors.accountFlagged')`. That assertion encoded
  // the silent lockout, not a requirement — middleware/auth.ts:81-91
  // rules out flag→automatic-block-without-review in as many words, and
  // the flag path wrote no AmlFlag row, so the block had no review to
  // wait for. The dispute-rate threshold still RAISES the flag (the two
  // tests above); what it no longer does is end the account.
  //
  // The full both-ways proof lives in pilot-guard-flag-does-not-block.test.ts.
  test('flagged customer can still create a new journey (flag ≠ block)', async () => {
    (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: 'c1',
      isFlagged: true,
    });

    // Asserted by outcome, not by absence-of-throw: this harness mocks
    // only what disputeJourney needs, so createJourney may still fail
    // further down on an unmocked write. What must NOT happen is the
    // flag refusal.
    let thrown: unknown = null;
    try {
      await journeyService.createJourney('c1', {
        pickupLat: -1.94,
        pickupLng: 29.87,
        pickupName: 'Test',
        destinationLat: -1.95,
        destinationLng: 29.88,
        destinationName: 'Test 2',
      } as any);
    } catch (err) {
      thrown = err;
    }
    expect((thrown as { code?: string } | null)?.code).not.toBe('ACCOUNT_FLAGGED');
    expect((thrown as Error | null)?.message).not.toBe('errors.accountFlagged');
  });
});
