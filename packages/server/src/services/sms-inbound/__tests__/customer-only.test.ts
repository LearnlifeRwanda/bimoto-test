// SENDER-MATCH-2 G3 — CONFIRM/DISPUTE are customer-side only.
//
// #193's census reported this as finding 4: journey-reply matched
// `OR: [{customerId}, {driverId}]` and then called
// confirmJourney(journey.id, journey.customerId) — supplying the customer's
// id as the actor whoever the sender was, so confirmJourney's own ownership
// guard could never fire. A driver texting YES confirmed his passenger's
// ride and released his own payment, on caller-ID authentication, against
// #177's customerOnly model.
//
// The tier gates it in the pilot. This closes it at the MATCHER, so the
// capability is gone even under SMS_COMMAND_TIER=full.

import { handle as journeyReply } from '../handlers/journey-reply';
import { REPLY_TEMPLATES } from '../config';
import type { InboundContext, ParsedMessage } from '../types';

jest.mock('../../journey.service', () => ({
  confirmJourney: jest.fn().mockResolvedValue({}),
  disputeJourney: jest.fn().mockResolvedValue({}),
  cancelScheduledJourney: jest.fn().mockResolvedValue({}),
}));

const journeyService = require('../../journey.service');

const ctx: InboundContext = {
  atMessageId: 'at-co-1',
  fromMsisdn: '+250788111111',
  toShortcode: '15555',
  rawBody: 'YES',
  receivedAt: new Date(),
};

const CONFIRM: ParsedMessage = { intent: 'CONFIRM_JOURNEY', raw: 'YES', normalised: 'YES' };
const DISPUTE: ParsedMessage = { intent: 'DISPUTE_JOURNEY', raw: 'NO', normalised: 'NO' };

const customer: any = { id: 'cust-1', role: 'CUSTOMER', smsOptOut: false };
const driver: any = { id: 'drv-1', role: 'DRIVER', smsOptOut: false };

/**
 * A prisma double that applies the handler's `where` clause honestly against
 * one stored journey — so the matcher's own scoping decides the outcome,
 * rather than a mock that answers regardless of what was asked.
 */
function honestPrisma(journey: any): any {
  return {
    journey: {
      findFirst: jest.fn(async ({ where }: any) => {
        if ('OR' in where) {
          const ids = where.OR.flatMap((c: any) => Object.values(c));
          return ids.includes(journey.customerId) || ids.includes(journey.driverId)
            ? journey
            : null;
        }
        return where.customerId === journey.customerId ? journey : null;
      }),
    },
  };
}

const RIDE = { id: 'j1', customerId: 'cust-1', driverId: 'drv-1', endedAt: new Date() };

beforeEach(() => jest.clearAllMocks());

describe('the matcher is scoped to the customer side', () => {
  test('the query asks for customerId and does NOT use an OR over both sides', async () => {
    const prisma = honestPrisma(RIDE);
    await journeyReply(ctx, customer, CONFIRM, prisma);
    const where = prisma.journey.findFirst.mock.calls[0][0].where;
    expect(where.customerId).toBe('cust-1');
    expect(where.OR).toBeUndefined();
  });
});

describe('the customer keeps the capability', () => {
  test('a customer texting YES confirms their ride', async () => {
    const result = await journeyReply(ctx, customer, CONFIRM, honestPrisma(RIDE));
    expect(journeyService.confirmJourney).toHaveBeenCalledWith('j1', 'cust-1');
    expect(result.replyBody).toBe(REPLY_TEMPLATES.CONFIRMED);
  });

  test('a customer texting NO disputes their ride', async () => {
    const result = await journeyReply(ctx, customer, DISPUTE, honestPrisma(RIDE));
    expect(journeyService.disputeJourney).toHaveBeenCalledWith(
      'j1',
      'cust-1',
      'Disputed via inbound SMS',
    );
    expect(result.replyBody).toBe(REPLY_TEMPLATES.DISPUTED);
  });
});

describe('the driver loses it — finding 4, closed at the matcher', () => {
  test('the driver of that very ride texting YES matches NOTHING', async () => {
    const result = await journeyReply(ctx, driver, CONFIRM, honestPrisma(RIDE));
    expect(journeyService.confirmJourney).not.toHaveBeenCalled();
    expect(result.status).toBe('NO_MATCHING_JOURNEY');
    expect(result.replyBody).toBe(REPLY_TEMPLATES.NO_MATCHING_JOURNEY);
  });

  test('no escrow is released on the driver\'s behalf — the self-release is gone', async () => {
    await journeyReply(ctx, driver, CONFIRM, honestPrisma(RIDE));
    expect(journeyService.confirmJourney).not.toHaveBeenCalled();
    expect(journeyService.disputeJourney).not.toHaveBeenCalled();
  });

  test('the driver texting NO cannot dispute the customer\'s ride either', async () => {
    const result = await journeyReply(ctx, driver, DISPUTE, honestPrisma(RIDE));
    expect(journeyService.disputeJourney).not.toHaveBeenCalled();
    expect(result.status).toBe('NO_MATCHING_JOURNEY');
  });

  test('a BOTH-role user still confirms rides they took as a passenger', async () => {
    const both: any = { id: 'cust-1', role: 'BOTH', smsOptOut: false };
    await journeyReply(ctx, both, CONFIRM, honestPrisma(RIDE));
    expect(journeyService.confirmJourney).toHaveBeenCalledWith('j1', 'cust-1');
  });

  test('the OLD matcher would have let the driver through — the regression pin', async () => {
    // Proof that the honest double is actually discriminating: fed the old
    // OR-shaped where clause, it returns the ride for the driver.
    const prisma = honestPrisma(RIDE);
    const oldShape = await prisma.journey.findFirst({
      where: { OR: [{ customerId: 'drv-1' }, { driverId: 'drv-1' }] },
    });
    expect(oldShape).not.toBeNull();
    const newShape = await prisma.journey.findFirst({ where: { customerId: 'drv-1' } });
    expect(newShape).toBeNull();
  });
});
