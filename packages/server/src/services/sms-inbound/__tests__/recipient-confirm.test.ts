// R3-RECIPIENT-CONFIRM — handler unit tests.
//
// The handler matches inbound non-Bimoto-user phones to recently-completed
// GOODS_DROPOFF legs and stamps recipientConfirmedAt. These tests cover the
// match filter (correct leg type, status, time window, and unconfirmed-only),
// the localized reply, the most-recent-tiebreak, and the no-match branch.

import { handle as recipientConfirm } from '../handlers/recipient-confirm';
import type { InboundContext } from '../types';

const RECIPIENT_PHONE = '+250788111111';
const NOW = new Date('2026-05-10T12:00:00.000Z');

function makeCtx(overrides: Partial<InboundContext> = {}): InboundContext {
  return {
    atMessageId: 'at-rc-1',
    fromMsisdn: RECIPIENT_PHONE,
    toShortcode: '15555',
    rawBody: 'RECEIVED',
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
  return {
    leg: {
      findMany: jest.fn().mockResolvedValue(legs),
      update: jest.fn().mockResolvedValue({}),
    },
  };
}

describe('recipient-confirm handler — match + update + reply', () => {
  test('matches a single eligible leg → stamps recipientConfirmedAt + replies thank-you (rw default)', async () => {
    const prisma = makePrisma([makeLeg()]);
    const result = await recipientConfirm(makeCtx(), prisma);

    expect(prisma.leg.update).toHaveBeenCalledWith({
      where: { id: 'leg-1' },
      data: { recipientConfirmedAt: NOW, recipientConfirmStatus: 'EXPLICIT_REPLY' },
    });
    expect(result.status).toBe('PROCESSED');
    expect(result.resolvedEntityId).toBe('leg-1');
    expect(result.replyBody).toContain('murakoze');
    expect(result.replyBody).toContain('Aljo');
  });

  test('thank-you is in English when customer.language === "en"', async () => {
    const prisma = makePrisma([
      makeLeg({ journey: { customer: { language: 'en', nickname: 'Aljo' } } }),
    ]);
    const result = await recipientConfirm(makeCtx(), prisma);
    expect(result.replyBody).toContain('thanks for confirming receipt');
    expect(result.replyBody).toContain('Aljo will be notified');
  });

  test('thank-you is in French when customer.language === "fr"', async () => {
    const prisma = makePrisma([
      makeLeg({ journey: { customer: { language: 'fr', nickname: 'Aljo' } } }),
    ]);
    const result = await recipientConfirm(makeCtx(), prisma);
    expect(result.replyBody).toContain('merci');
    expect(result.replyBody).toContain('Aljo');
  });

  test('thank-you handles missing nickname gracefully', async () => {
    const prisma = makePrisma([
      makeLeg({ journey: { customer: { language: 'en', nickname: null } } }),
    ]);
    const result = await recipientConfirm(makeCtx(), prisma);
    expect(result.replyBody).toContain('The sender will be notified');
  });
});

describe('recipient-confirm handler — query filter (smallest-wrongness §8)', () => {
  test('passes the where-filter that excludes already-confirmed legs', async () => {
    const prisma = makePrisma([]);
    await recipientConfirm(makeCtx(), prisma);

    const findManyArgs = prisma.leg.findMany.mock.calls[0][0];
    expect(findManyArgs.where.recipientConfirmedAt).toBeNull();
    expect(findManyArgs.where.type).toBe('GOODS_DROPOFF');
    expect(findManyArgs.where.status).toBe('COMPLETED');
    expect(findManyArgs.where.contactPhone).toBe(RECIPIENT_PHONE);
  });

  test('passes a 60-minute time window in the where-filter', async () => {
    const prisma = makePrisma([]);
    await recipientConfirm(makeCtx(), prisma);

    const findManyArgs = prisma.leg.findMany.mock.calls[0][0];
    const cutoff = findManyArgs.where.completedAt.gt as Date;
    expect(cutoff.getTime()).toBe(NOW.getTime() - 60 * 60 * 1000);
  });

  test('orders by completedAt desc so multiple matches resolve to most recent', async () => {
    const prisma = makePrisma([]);
    await recipientConfirm(makeCtx(), prisma);

    const findManyArgs = prisma.leg.findMany.mock.calls[0][0];
    expect(findManyArgs.orderBy).toEqual({ completedAt: 'desc' });
  });
});

describe('recipient-confirm handler — no match', () => {
  test('no eligible leg → NO_MATCHING_JOURNEY + not-found reply (default rw)', async () => {
    const prisma = makePrisma([]);
    const result = await recipientConfirm(makeCtx(), prisma);

    expect(prisma.leg.update).not.toHaveBeenCalled();
    expect(result.status).toBe('NO_MATCHING_JOURNEY');
    expect(result.replyBody).toContain('nta pake');
  });

  test('no eligible leg → does NOT stamp recipientConfirmedAt anywhere', async () => {
    const prisma = makePrisma([]);
    await recipientConfirm(makeCtx(), prisma);
    expect(prisma.leg.update).not.toHaveBeenCalled();
  });
});

describe('recipient-confirm handler — most-recent tiebreak', () => {
  test('multiple matches → confirms the first (DB sort by completedAt desc)', async () => {
    const recent = makeLeg({
      id: 'leg-recent',
      completedAt: new Date(NOW.getTime() - 2 * 60 * 1000),
    });
    const older = makeLeg({
      id: 'leg-older',
      completedAt: new Date(NOW.getTime() - 30 * 60 * 1000),
    });
    const prisma = makePrisma([recent, older]);

    const result = await recipientConfirm(makeCtx(), prisma);
    expect(prisma.leg.update).toHaveBeenCalledWith({
      where: { id: 'leg-recent' },
      data: { recipientConfirmedAt: NOW, recipientConfirmStatus: 'EXPLICIT_REPLY' },
    });
    expect(result.resolvedEntityId).toBe('leg-recent');
  });
});
