jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    journey: { findMany: jest.fn(), update: jest.fn() },
  },
}));

jest.mock('../socket', () => ({ emitToJourney: jest.fn() }));
jest.mock('../services/sms.service', () => ({ sendSms: jest.fn().mockResolvedValue({ success: true }) }));

import { processScheduledRideReminders } from '../jobs/scheduled-ride-reminder.job';
import { encrypt } from '../utils/crypto';
import prisma from '../prisma';
import { emitToJourney } from '../socket';
import { sendSms } from '../services/sms.service';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

beforeEach(() => {
  jest.clearAllMocks();
  (mockPrisma.journey.update as jest.Mock).mockResolvedValue({});
});

const baseJourney = (scheduledFor: Date, lastReminderSentAt: Date | null = null) => ({
  id: 'j1',
  status: 'MATCHED',
  bookingMode: 'SCHEDULED',
  scheduledFor,
  pickupName: 'A',
  customerId: 'c1',
  driverId: 'd1',
  lastReminderSentAt,
  customer: { phoneEncrypted: encrypt('+250788000001'), nickname: 'Ana' },
  driver: { phoneEncrypted: encrypt('+250788000002'), nickname: 'Bob' },
});

describe('scheduled-ride-reminder job', () => {
  test('sends 60-min reminder to customer', async () => {
    const now = new Date('2026-05-04T13:01:00Z');
    const scheduledFor = new Date('2026-05-04T14:00:00Z');
    (mockPrisma.journey.findMany as jest.Mock).mockResolvedValue([baseJourney(scheduledFor)]);
    const sent = await processScheduledRideReminders(now);
    expect(sent).toBe(1);
    expect(sendSms).toHaveBeenCalledWith('+250788000001', expect.stringContaining('14:00'));
    expect(emitToJourney).toHaveBeenCalled();
  });

  test('sends 30-min reminder to driver', async () => {
    const now = new Date('2026-05-04T13:31:00Z');
    const scheduledFor = new Date('2026-05-04T14:00:00Z');
    (mockPrisma.journey.findMany as jest.Mock).mockResolvedValue([baseJourney(scheduledFor)]);
    const sent = await processScheduledRideReminders(now);
    expect(sent).toBe(1);
    expect(sendSms).toHaveBeenCalledWith('+250788000002', expect.stringContaining('14:00'));
  });

  test('sends 5-min reminder to driver', async () => {
    const now = new Date('2026-05-04T13:56:00Z');
    const scheduledFor = new Date('2026-05-04T14:00:00Z');
    (mockPrisma.journey.findMany as jest.Mock).mockResolvedValue([baseJourney(scheduledFor)]);
    const sent = await processScheduledRideReminders(now);
    expect(sent).toBe(1);
    expect(sendSms).toHaveBeenCalledWith('+250788000002', expect.stringContaining('5 min'));
  });

  test('idempotent: skips already-sent windows via lastReminderSentAt', async () => {
    const now = new Date('2026-05-04T13:01:00Z');
    const scheduledFor = new Date('2026-05-04T14:00:00Z');
    const lastSent = new Date('2026-05-04T13:00:30Z');
    (mockPrisma.journey.findMany as jest.Mock).mockResolvedValue([baseJourney(scheduledFor, lastSent)]);
    const sent = await processScheduledRideReminders(now);
    expect(sent).toBe(0);
    expect(sendSms).not.toHaveBeenCalled();
  });

  test('skips when scheduledFor not in any reminder window', async () => {
    const now = new Date('2026-05-04T10:00:00Z');
    const scheduledFor = new Date('2026-05-04T14:00:00Z');
    (mockPrisma.journey.findMany as jest.Mock).mockResolvedValue([]);
    const sent = await processScheduledRideReminders(now);
    expect(sent).toBe(0);
  });

  test('updates lastReminderSentAt after sending', async () => {
    const now = new Date('2026-05-04T13:01:00Z');
    const scheduledFor = new Date('2026-05-04T14:00:00Z');
    (mockPrisma.journey.findMany as jest.Mock).mockResolvedValue([baseJourney(scheduledFor)]);
    await processScheduledRideReminders(now);
    expect(mockPrisma.journey.update).toHaveBeenCalledWith({
      where: { id: 'j1' },
      data: { lastReminderSentAt: now },
    });
  });
});
