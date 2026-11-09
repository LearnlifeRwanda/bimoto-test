import { JourneyStatus, EscrowStatus } from '@bimoto/shared';
import { encrypt } from '../utils/crypto';

jest.mock('../prisma', () => {
  const db: any = {
    journey: {
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
    },
    user: { update: jest.fn() },
    driverProfile: { update: jest.fn() },
    escrow: { findMany: jest.fn().mockResolvedValue([]) },
    escrowAuditLog: { findFirst: jest.fn() },
    // MONEY-ATOMIC-2 — the per-journey settlement transaction now spans the
    // CONFIRMED stamp, the audit entry, the release and both counters, so
    // the tx handed to the callback proxies every model through to the same
    // top-level mocks (same jest.fn instances) and the assertions below
    // read through unchanged. The escrow-side sub-mocks the release path
    // uses are kept.
    $transaction: jest.fn(async (fn: any) =>
      fn({
        ...db,
        escrow: { ...db.escrow, update: jest.fn() },
        escrowAuditLog: { findFirst: jest.fn(), create: jest.fn() },
      }),
    ),
  };
  return { __esModule: true, default: db };
});

jest.mock('../socket', () => ({
  emitToJourney: jest.fn(),
}));

jest.mock('../services/escrow-audit.service', () => ({
  appendAuditEntry: jest.fn().mockResolvedValue(undefined),
  appendAuditEntryTx: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../services/journey-validation.service', () => ({
  validateJourneyPlausibility: jest.fn().mockResolvedValue({ valid: true, flags: [] }),
}));

jest.mock('../services/sms.service', () => ({
  sendSms: jest.fn().mockResolvedValue({ success: true }),
}));

import prisma from '../prisma';
import { appendAuditEntry, appendAuditEntryTx } from '../services/escrow-audit.service';
import * as smsService from '../services/sms.service';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

beforeEach(() => {
  jest.clearAllMocks();
  // Reset to a clean slate for the iteration calls in each test.
  (mockPrisma.journey.findMany as jest.Mock).mockResolvedValue([]);
  (mockPrisma.escrow.findMany as jest.Mock).mockResolvedValue([]);
});

import { processAutoConfirm } from '../jobs/auto-confirm.job';

describe('auto-confirm.job — flagged rows (silence-equals-consent)', () => {
  const now = Date.now();

  test('1. normal row auto-COMPLETES at 2h (regression check)', async () => {
    const endedAt = new Date(now - 3 * 60 * 60 * 1000);
    (mockPrisma.journey.findMany as jest.Mock)
      .mockResolvedValueOnce([
        {
          id: 'jn1',
          status: JourneyStatus.AWAITING_CONFIRMATION,
          endedAt,
          customerInitiatedCompletion: false,
          lateCompletion: false,
          customerId: 'c1',
          driverId: 'd1',
          escrow: null,
        },
      ])
      .mockResolvedValueOnce([]); // reminder scan

    await processAutoConfirm();
    expect(mockPrisma.journey.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'jn1' },
        data: expect.objectContaining({ status: JourneyStatus.COMPLETED }),
      }),
    );
  });

  test('2. customerInitiated row auto-COMPLETES at 24h (status COMPLETED, NOT DISPUTED)', async () => {
    const endedAt = new Date(now - 25 * 60 * 60 * 1000);
    const dueAt = new Date(endedAt.getTime() + 24 * 60 * 60 * 1000);
    (mockPrisma.journey.findMany as jest.Mock)
      .mockResolvedValueOnce([
        {
          id: 'jc1',
          status: JourneyStatus.AWAITING_CONFIRMATION,
          endedAt,
          dueAt,
          customerInitiatedCompletion: true,
          lateCompletion: false,
          customerId: 'c1',
          driverId: 'd1',
          escrow: { id: 'e1', amount: 1000, status: EscrowStatus.HELD },
        },
      ])
      .mockResolvedValueOnce([]);

    await processAutoConfirm();
    const updateCall = (mockPrisma.journey.update as jest.Mock).mock.calls.find(
      ([arg]) => arg.where.id === 'jc1',
    );
    expect(updateCall?.[0].data.status).toBe(JourneyStatus.COMPLETED);
    expect(updateCall?.[0].data.status).not.toBe(JourneyStatus.DISPUTED);
    // MONEY-ATOMIC-2 — the AUTO_CONFIRM entry now joins the settlement's
    // transaction, so the composed *Tx variant is what gets called.
    expect(appendAuditEntryTx).toHaveBeenCalledWith(
      expect.anything(),
      'e1',
      'AUTO_CONFIRM',
      1000,
      'SYSTEM',
      expect.objectContaining({ autoConfirmedSource: 'customerInitiated', driverDidNotDispute: true }),
    );
  });

  test('3. customerInitiated row pre-dueAt is NOT processed (silence window still open)', async () => {
    const endedAt = new Date(now - 1 * 60 * 60 * 1000);
    const dueAt = new Date(now + 23 * 60 * 60 * 1000);
    // Empty findMany simulates the WHERE filter excluding pre-dueAt rows.
    (mockPrisma.journey.findMany as jest.Mock)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await processAutoConfirm();
    expect(mockPrisma.journey.update).not.toHaveBeenCalled();
    // Verify the WHERE clause uses dueAt < now for flagged rows
    const findCall = (mockPrisma.journey.findMany as jest.Mock).mock.calls[0][0];
    const customerInitiatedBranch = findCall.where.OR.find(
      (b: any) => b.customerInitiatedCompletion === true,
    );
    expect(customerInitiatedBranch.dueAt.lt).toBeInstanceOf(Date);
    void endedAt; void dueAt;
  });

  test('4. lateCompletion row auto-COMPLETES at 24h with audit metadata', async () => {
    const endedAt = new Date(now - 25 * 60 * 60 * 1000);
    const dueAt = new Date(endedAt.getTime() + 24 * 60 * 60 * 1000);
    (mockPrisma.journey.findMany as jest.Mock)
      .mockResolvedValueOnce([
        {
          id: 'jl1',
          status: JourneyStatus.AWAITING_CONFIRMATION,
          endedAt,
          dueAt,
          customerInitiatedCompletion: false,
          lateCompletion: true,
          customerId: 'c1',
          driverId: 'd1',
          escrow: { id: 'e2', amount: 2000, status: EscrowStatus.HELD },
        },
      ])
      .mockResolvedValueOnce([]);

    await processAutoConfirm();
    expect(appendAuditEntryTx).toHaveBeenCalledWith(
      expect.anything(),
      'e2',
      'AUTO_CONFIRM',
      2000,
      'SYSTEM',
      expect.objectContaining({ autoConfirmedSource: 'lateCompletion', customerDidNotDispute: true }),
    );
  });

  test('5. 12-hour reminder fires once and sets lastReminderSentAt (idempotent)', async () => {
    const endedAt = new Date(now - 13 * 60 * 60 * 1000);
    const dueAt = new Date(now + 11 * 60 * 60 * 1000);
    (mockPrisma.journey.findMany as jest.Mock)
      .mockResolvedValueOnce([]) // auto-confirm scan: nothing past dueAt
      .mockResolvedValueOnce([   // reminder scan
        {
          id: 'jr1',
          status: JourneyStatus.AWAITING_CONFIRMATION,
          endedAt,
          dueAt,
          customerInitiatedCompletion: true,
          lateCompletion: false,
          destinationName: 'Kacyiru',
          customer: { phoneEncrypted: encrypt('+250788111111') },
          driver: { phoneEncrypted: encrypt('+250788222222') },
        },
      ]);

    await processAutoConfirm();
    expect(smsService.sendSms).toHaveBeenCalledTimes(1);
    expect(smsService.sendSms).toHaveBeenCalledWith('+250788222222', expect.stringContaining('Kacyiru'));
    expect(mockPrisma.journey.update).toHaveBeenCalledWith({
      where: { id: 'jr1' },
      data: { lastReminderSentAt: expect.any(Date) },
    });
  });

  test('6. reminder query filters lastReminderSentAt:null for idempotency', async () => {
    (mockPrisma.journey.findMany as jest.Mock)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await processAutoConfirm();
    const reminderCall = (mockPrisma.journey.findMany as jest.Mock).mock.calls[1][0];
    expect(reminderCall.where.lastReminderSentAt).toBeNull();
    expect(reminderCall.where.OR).toEqual(
      expect.arrayContaining([
        { customerInitiatedCompletion: true },
        { lateCompletion: true },
      ]),
    );
  });

  test('7. silent path never produces a DISPUTED row from auto-confirm.job', async () => {
    const endedAt = new Date(now - 25 * 60 * 60 * 1000);
    const dueAt = new Date(endedAt.getTime() + 24 * 60 * 60 * 1000);
    (mockPrisma.journey.findMany as jest.Mock)
      .mockResolvedValueOnce([
        {
          id: 'jq1',
          status: JourneyStatus.AWAITING_CONFIRMATION,
          endedAt,
          dueAt,
          customerInitiatedCompletion: true,
          lateCompletion: false,
          customerId: 'c1',
          driverId: 'd1',
          escrow: null,
        },
      ])
      .mockResolvedValueOnce([]);

    await processAutoConfirm();
    const updateCalls = (mockPrisma.journey.update as jest.Mock).mock.calls;
    for (const [arg] of updateCalls) {
      if (arg.data?.status) {
        expect(arg.data.status).not.toBe(JourneyStatus.DISPUTED);
      }
    }
  });
});
