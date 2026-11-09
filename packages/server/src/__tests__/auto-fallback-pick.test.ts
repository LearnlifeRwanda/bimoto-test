jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    journey: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    bid: {
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    user: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  },
}));

jest.mock('../socket', () => ({ emitToJourney: jest.fn() }));
jest.mock('../services/sms.service', () => ({ sendSms: jest.fn().mockResolvedValue({ success: true }) }));

import { processAutoFallbackPick } from '../jobs/auto-fallback-pick.job';
import { encrypt } from '../utils/crypto';
import prisma from '../prisma';
import { emitToJourney } from '../socket';
import { sendSms } from '../services/sms.service';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

beforeEach(() => {
  jest.clearAllMocks();
  (mockPrisma.$transaction as jest.Mock).mockImplementation(async (cb: any) => cb(mockPrisma));
});

describe('auto-fallback-pick job', () => {
  test('matches lowest valid bid and emits scheduled-ride-matched', async () => {
    const scheduledFor = new Date(Date.now() + 30 * 60 * 1000);
    (mockPrisma.journey.findMany as jest.Mock).mockResolvedValue([
      { id: 'j1', status: 'REQUESTED', scheduledFor, customerId: 'c1' },
    ]);
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue({ id: 'j1' });
    (mockPrisma.bid.findMany as jest.Mock).mockResolvedValue([
      { id: 'b1', price: 1000, etaMinutes: 5, driverId: 'd1' },
    ]);
    (mockPrisma.bid.update as jest.Mock).mockResolvedValue({});
    (mockPrisma.bid.updateMany as jest.Mock).mockResolvedValue({});
    (mockPrisma.journey.update as jest.Mock).mockResolvedValue({});

    const r = await processAutoFallbackPick();
    expect(r.matched).toBe(1);
    expect(r.expired).toBe(0);
    expect(emitToJourney).toHaveBeenCalledWith(
      'j1',
      'scheduled-ride-matched',
      expect.objectContaining({ autoFallback: true }),
    );
  });

  test('expires journey + SMS + emits when no valid bid', async () => {
    const scheduledFor = new Date(Date.now() + 30 * 60 * 1000);
    (mockPrisma.journey.findMany as jest.Mock).mockResolvedValue([
      { id: 'j1', status: 'REQUESTED', scheduledFor, customerId: 'c1' },
    ]);
    (mockPrisma.bid.findMany as jest.Mock).mockResolvedValue([]);
    (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({ phoneEncrypted: encrypt('+250788000000') });
    (mockPrisma.journey.update as jest.Mock).mockResolvedValue({});

    const r = await processAutoFallbackPick();
    expect(r.matched).toBe(0);
    expect(r.expired).toBe(1);
    expect(emitToJourney).toHaveBeenCalledWith('j1', 'scheduled-ride-expired', expect.any(Object));
    expect(sendSms).toHaveBeenCalled();
    // DECRYPT v3 — the expiry notice must be addressed to a number the
    // customer's handset can receive, not to the stored ciphertext.
    expect((sendSms as jest.Mock).mock.calls[0][0]).toBe('+250788000000');
  });

  test('idempotent: empty result when no journeys ready', async () => {
    (mockPrisma.journey.findMany as jest.Mock).mockResolvedValue([]);
    const r = await processAutoFallbackPick();
    expect(r.matched).toBe(0);
    expect(r.expired).toBe(0);
  });

  test('per-journey errors do not break the loop', async () => {
    const scheduledFor = new Date(Date.now() + 30 * 60 * 1000);
    (mockPrisma.journey.findMany as jest.Mock).mockResolvedValue([
      { id: 'j1', status: 'REQUESTED', scheduledFor, customerId: 'c1' },
      { id: 'j2', status: 'REQUESTED', scheduledFor, customerId: 'c2' },
    ]);
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue({ id: 'jX' });
    (mockPrisma.bid.findMany as jest.Mock)
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce([]);
    (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({ phoneEncrypted: encrypt('+250788000000') });
    (mockPrisma.journey.update as jest.Mock).mockResolvedValue({});

    const r = await processAutoFallbackPick();
    expect(r.expired).toBe(1);
  });

  test('skips bid whose ETA does not fit before scheduledFor', async () => {
    const scheduledFor = new Date(Date.now() + 10 * 60 * 1000);
    (mockPrisma.journey.findMany as jest.Mock).mockResolvedValue([
      { id: 'j1', status: 'REQUESTED', scheduledFor, customerId: 'c1' },
    ]);
    (mockPrisma.bid.findMany as jest.Mock).mockResolvedValue([
      { id: 'b1', price: 1000, etaMinutes: 60, driverId: 'd1' },
    ]);
    (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({ phoneEncrypted: encrypt('+250788000000') });
    (mockPrisma.journey.update as jest.Mock).mockResolvedValue({});

    const r = await processAutoFallbackPick();
    expect(r.matched).toBe(0);
    expect(r.expired).toBe(1);
  });
});
