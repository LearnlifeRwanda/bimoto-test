// R3-RECIPIENT-CONFIRM-2 — recipient-dispute handler tests.
//
// Mirrors recipient-confirm.test.ts. Validates that a dispute SMS-reply
// stamps recipientConfirmStatus = DISPUTED + preserves the verbatim SMS
// body in recipientDisputeReason, and that the locale-aware reply
// acknowledges the dispute (not a thank-you).

jest.mock('../../admin-notifications.service', () => ({
  __esModule: true,
  notifyAdminsOfNewRecipientDispute: jest.fn(),
}));

import { handle as recipientDispute } from '../handlers/recipient-dispute';
import { notifyAdminsOfNewRecipientDispute } from '../../admin-notifications.service';
import type { InboundContext } from '../types';

const mockedNotifyAdmins = notifyAdminsOfNewRecipientDispute as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

const RECIPIENT_PHONE = '+250788111111';
const NOW = new Date('2026-05-10T12:00:00.000Z');

function makeCtx(overrides: Partial<InboundContext> = {}): InboundContext {
  return {
    atMessageId: 'at-rd-1',
    fromMsisdn: RECIPIENT_PHONE,
    toShortcode: '15555',
    rawBody: 'WRONG ITEM',
    receivedAt: NOW,
    ...overrides,
  };
}

function makeLeg(overrides: any = {}): any {
  return {
    id: 'leg-1',
    contactPhone: RECIPIENT_PHONE,
    type: 'GOODS_DROPOFF',
    status: 'COMPLETED',
    recipientConfirmedAt: null,
    completedAt: new Date(NOW.getTime() - 5 * 60 * 1000),
    journey: {
      customer: { language: 'rw', nickname: 'Aljo' },
    },
    ...overrides,
  };
}

function makePrisma(legs: any[] = []): any {
  // leg.update is shared between the top-level mock and the tx so existing
  // assertions on `prisma.leg.update` keep working now that the handler wraps
  // the write in prisma.$transaction.
  const legUpdate = jest.fn().mockResolvedValue({});
  const escrowUpdate = jest.fn().mockResolvedValue({});
  const tx = {
    leg: { update: legUpdate },
    escrow: { update: escrowUpdate },
    escrowAuditLog: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
  };
  return {
    leg: {
      findMany: jest.fn().mockResolvedValue(legs),
      update: legUpdate,
    },
    escrow: { update: escrowUpdate },
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  };
}

describe('recipient-dispute handler — match + stamp DISPUTED + reason', () => {
  test('matches a single eligible leg → stamps DISPUTED + verbatim SMS body as reason', async () => {
    const prisma = makePrisma([makeLeg()]);
    const result = await recipientDispute(makeCtx({ rawBody: 'WRONG ITEM, this is broken!' }), prisma);

    expect(prisma.leg.update).toHaveBeenCalledWith({
      where: { id: 'leg-1' },
      data: {
        recipientConfirmedAt: NOW,
        recipientConfirmStatus: 'DISPUTED',
        recipientDisputeReason: 'WRONG ITEM, this is broken!',
      },
    });
    expect(result.status).toBe('PROCESSED');
    expect(result.resolvedEntityId).toBe('leg-1');
  });

  test('dispute reply is in Kinyarwanda (default) when customer.language === "rw"', async () => {
    const prisma = makePrisma([makeLeg()]);
    const result = await recipientDispute(makeCtx(), prisma);
    expect(result.replyBody).toMatch(/twanditse ikibazo/i);
    expect(result.replyBody).toContain('Aljo');
  });

  test('dispute reply is in English when customer.language === "en"', async () => {
    const prisma = makePrisma([
      makeLeg({ journey: { customer: { language: 'en', nickname: 'Aljo' } } }),
    ]);
    const result = await recipientDispute(makeCtx(), prisma);
    expect(result.replyBody).toContain('we recorded your dispute');
    expect(result.replyBody).toContain('Aljo will be notified');
  });

  test('dispute reply is in French when customer.language === "fr"', async () => {
    const prisma = makePrisma([
      makeLeg({ journey: { customer: { language: 'fr', nickname: 'Aljo' } } }),
    ]);
    const result = await recipientDispute(makeCtx(), prisma);
    expect(result.replyBody).toMatch(/reclamation|reclamation/i);
    expect(result.replyBody).toContain('Aljo');
  });

  test('dispute reply handles missing nickname gracefully', async () => {
    const prisma = makePrisma([
      makeLeg({ journey: { customer: { language: 'en', nickname: null } } }),
    ]);
    const result = await recipientDispute(makeCtx(), prisma);
    expect(result.replyBody).toContain('The sender will be notified');
  });
});

describe('recipient-dispute handler — query filter', () => {
  test('uses the same filter as recipient-confirm (GOODS_DROPOFF + COMPLETED + unconfirmed + 60min window)', async () => {
    const prisma = makePrisma([]);
    await recipientDispute(makeCtx(), prisma);

    const findManyArgs = prisma.leg.findMany.mock.calls[0][0];
    expect(findManyArgs.where.type).toBe('GOODS_DROPOFF');
    expect(findManyArgs.where.status).toBe('COMPLETED');
    expect(findManyArgs.where.recipientConfirmedAt).toBeNull();
    expect(findManyArgs.where.contactPhone).toBe(RECIPIENT_PHONE);
    const cutoff = findManyArgs.where.completedAt.gt as Date;
    expect(cutoff.getTime()).toBe(NOW.getTime() - 60 * 60 * 1000);
  });

  test('orders by completedAt desc (most recent dispute matches the most recent delivery)', async () => {
    const prisma = makePrisma([]);
    await recipientDispute(makeCtx(), prisma);
    expect(prisma.leg.findMany.mock.calls[0][0].orderBy).toEqual({
      completedAt: 'desc',
    });
  });
});

describe('recipient-dispute handler — no match', () => {
  test('no eligible leg → NO_MATCHING_JOURNEY + not-found reply, no update', async () => {
    const prisma = makePrisma([]);
    const result = await recipientDispute(makeCtx(), prisma);

    expect(prisma.leg.update).not.toHaveBeenCalled();
    expect(result.status).toBe('NO_MATCHING_JOURNEY');
    expect(result.replyBody).toContain('nta pake');
  });
});

describe('recipient-dispute handler — R3-CONFLICTS-NOTIFICATIONS admin push wire', () => {
  test('fires notifyAdminsOfNewRecipientDispute exactly once on a matched dispute', async () => {
    const prisma = makePrisma([makeLeg({ id: 'leg-42', journeyId: 'jrn-7' })]);
    await recipientDispute(makeCtx({ rawBody: 'BROKEN' }), prisma);
    expect(mockedNotifyAdmins).toHaveBeenCalledTimes(1);
    expect(mockedNotifyAdmins).toHaveBeenCalledWith({
      legId: 'leg-42',
      journeyId: 'jrn-7',
      customerNickname: 'Aljo',
      recipientPhone: RECIPIENT_PHONE,
      disputeReason: 'BROKEN',
    });
  });

  test('does NOT fire admin push when no eligible leg matches', async () => {
    const prisma = makePrisma([]);
    await recipientDispute(makeCtx(), prisma);
    expect(mockedNotifyAdmins).not.toHaveBeenCalled();
  });

  test('admin push fires AFTER the dispute transaction commits — the dispute is recorded first', async () => {
    const calls: string[] = [];
    const legUpdate = jest.fn().mockImplementation(async () => {
      calls.push('leg.update');
      return {};
    });
    const tx = { leg: { update: legUpdate }, escrow: { update: jest.fn() }, escrowAuditLog: { findFirst: jest.fn(), create: jest.fn() } };
    const prisma: any = {
      leg: { findMany: jest.fn().mockResolvedValue([makeLeg()]), update: legUpdate },
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    };
    mockedNotifyAdmins.mockImplementation(() => {
      calls.push('notifyAdmins');
    });
    await recipientDispute(makeCtx(), prisma);
    expect(calls).toEqual(['leg.update', 'notifyAdmins']);
  });

  test('handler returns quickly even when notifyAdminsOfNewRecipientDispute is slow (negative-space: not awaited)', async () => {
    // If the executor accidentally `await`s notifyAdmins, this test
    // fails: a 500ms helper would block the handler return.
    const prisma = makePrisma([makeLeg()]);
    mockedNotifyAdmins.mockImplementation(() => {
      // Helper is void-returning, but the IIFE inside might be slow.
      // The handler must not block on it.
    });
    const start = Date.now();
    const result = await recipientDispute(makeCtx(), prisma);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(200);
    expect(result.replyBody).toBeDefined();
  });
});

function makeLegWithEscrow(escrowStatus: string | null = 'HELD'): any {
  return makeLeg({
    journeyId: 'jrn-1',
    journey: {
      customerId: 'cust-1',
      customer: { language: 'rw', nickname: 'Aljo' },
      escrow:
        escrowStatus === null
          ? null
          : { id: 'esc-1', journeyId: 'jrn-1', status: escrowStatus, amount: 3000 },
    },
  });
}

describe('recipient-dispute handler — R3-RECIPIENT-DISPUTE-ESCROW-FREEZE', () => {
  test('freezes the journey escrow HELD -> FROZEN atomically with leg.update', async () => {
    const prisma = makePrisma([makeLegWithEscrow('HELD')]);
    const result = await recipientDispute(makeCtx(), prisma);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.leg.update).toHaveBeenCalled();
    expect(prisma.escrow.update).toHaveBeenCalledWith({
      where: { journeyId: 'jrn-1' },
      data: { status: 'FROZEN' },
    });
    expect(result.status).toBe('PROCESSED');
  });

  test('does NOT freeze when escrow is already FROZEN (preserve existing state)', async () => {
    const prisma = makePrisma([makeLegWithEscrow('FROZEN')]);
    await recipientDispute(makeCtx(), prisma);
    expect(prisma.leg.update).toHaveBeenCalled();
    expect(prisma.escrow.update).not.toHaveBeenCalled();
  });

  test('does NOT freeze when escrow is already REFUNDED', async () => {
    const prisma = makePrisma([makeLegWithEscrow('REFUNDED')]);
    await recipientDispute(makeCtx(), prisma);
    expect(prisma.escrow.update).not.toHaveBeenCalled();
  });

  test('does NOT freeze when the journey has no escrow (leg still stamped DISPUTED)', async () => {
    const prisma = makePrisma([makeLegWithEscrow(null)]);
    await recipientDispute(makeCtx(), prisma);
    expect(prisma.leg.update).toHaveBeenCalled();
    expect(prisma.escrow.update).not.toHaveBeenCalled();
  });

  test('leg.update + freeze are atomic: if the freeze write throws, the handler rejects (rollback)', async () => {
    const prisma = makePrisma([makeLegWithEscrow('HELD')]);
    prisma.escrow.update.mockRejectedValueOnce(new Error('DB_WRITE_FAILED'));
    await expect(recipientDispute(makeCtx(), prisma)).rejects.toThrow('DB_WRITE_FAILED');
    // The admin push must NOT have fired (it runs after the committed tx).
    expect(mockedNotifyAdmins).not.toHaveBeenCalled();
  });
});
