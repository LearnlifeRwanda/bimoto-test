import { handle as journeyReply } from '../handlers/journey-reply';
import { handle as scheduledReply } from '../handlers/scheduled-reply';
import { handle as bidReply } from '../handlers/bid-reply';
import { handle as statusHandler } from '../handlers/status';
import { handle as balanceHandler } from '../handlers/balance';
import { handle as helpStop } from '../handlers/help-stop';
import { handle as unknownHandler } from '../handlers/unknown';
import { REPLY_TEMPLATES, helpReply } from '../config';
import type { InboundContext, ParsedMessage } from '../types';

jest.mock('../../journey.service', () => ({
  confirmJourney: jest.fn().mockResolvedValue({}),
  disputeJourney: jest.fn().mockResolvedValue({}),
  cancelScheduledJourney: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../bid.service', () => ({
  withdrawBid: jest.fn().mockResolvedValue({}),
}));

const journeyService = require('../../journey.service');
const bidService = require('../../bid.service');

const ctx: InboundContext = {
  atMessageId: 'at-1',
  fromMsisdn: '+250788111111',
  toShortcode: '15555',
  rawBody: '1',
  receivedAt: new Date(),
};

const customer: any = { id: 'user-1', role: 'CUSTOMER', smsOptOut: false };
const driver: any = { id: 'user-2', role: 'DRIVER', smsOptOut: false };

function makePrisma(overrides: Partial<any> = {}): any {
  return {
    journey: { findFirst: jest.fn().mockResolvedValue(null) },
    bid: { findFirst: jest.fn().mockResolvedValue(null) },
    driverBalance: { findUnique: jest.fn().mockResolvedValue(null) },
    user: { update: jest.fn().mockResolvedValue({}) },
    ...overrides,
  };
}

beforeEach(() => jest.clearAllMocks());

describe('journey-reply handler', () => {
  test('CONFIRM_JOURNEY transitions and replies CONFIRMED', async () => {
    const prisma = makePrisma({
      journey: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'j1', customerId: 'user-1', endedAt: new Date() }),
      },
    });
    const parsed: ParsedMessage = { intent: 'CONFIRM_JOURNEY', raw: '1', normalised: '1' };
    const result = await journeyReply(ctx, customer, parsed, prisma);
    expect(journeyService.confirmJourney).toHaveBeenCalledWith('j1', 'user-1');
    expect(result.replyBody).toBe(REPLY_TEMPLATES.CONFIRMED);
    expect(result.status).toBe('PROCESSED');
  });

  test('DISPUTE_JOURNEY transitions and replies DISPUTED', async () => {
    const prisma = makePrisma({
      journey: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'j2', customerId: 'user-1', endedAt: new Date() }),
      },
    });
    const parsed: ParsedMessage = { intent: 'DISPUTE_JOURNEY', raw: '2', normalised: '2' };
    const result = await journeyReply(ctx, customer, parsed, prisma);
    expect(journeyService.disputeJourney).toHaveBeenCalled();
    expect(result.replyBody).toBe(REPLY_TEMPLATES.DISPUTED);
  });

  test('no recent journey → NO_MATCHING_JOURNEY', async () => {
    const prisma = makePrisma();
    const parsed: ParsedMessage = { intent: 'CONFIRM_JOURNEY', raw: '1', normalised: '1' };
    const result = await journeyReply(ctx, customer, parsed, prisma);
    expect(result.status).toBe('NO_MATCHING_JOURNEY');
    expect(result.replyBody).toBe(REPLY_TEMPLATES.NO_MATCHING_JOURNEY);
  });

  test('handler error returns ERROR with message', async () => {
    journeyService.confirmJourney.mockRejectedValueOnce(new Error('boom'));
    const prisma = makePrisma({
      journey: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'j3', customerId: 'user-1', endedAt: new Date() }),
      },
    });
    const parsed: ParsedMessage = { intent: 'CONFIRM_JOURNEY', raw: '1', normalised: '1' };
    const result = await journeyReply(ctx, customer, parsed, prisma);
    expect(result.status).toBe('ERROR');
    expect(result.errorMessage).toBe('boom');
  });
});

describe('scheduled-reply handler', () => {
  test('CANCEL_SCHEDULED cancels the soonest upcoming ride', async () => {
    const prisma = makePrisma({
      journey: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'sj1', customerId: 'user-1' }),
      },
    });
    const parsed: ParsedMessage = { intent: 'CANCEL_SCHEDULED', raw: 'CANCEL', normalised: 'CANCEL' };
    const result = await scheduledReply(ctx, customer, parsed, prisma);
    expect(journeyService.cancelScheduledJourney).toHaveBeenCalledWith('sj1', 'user-1');
    expect(result.replyBody).toBe(REPLY_TEMPLATES.SCHEDULED_CANCELLED);
  });

  test('no upcoming → NO_MATCHING_SCHEDULED', async () => {
    const prisma = makePrisma();
    const parsed: ParsedMessage = { intent: 'CANCEL_SCHEDULED', raw: 'CANCEL', normalised: 'CANCEL' };
    const result = await scheduledReply(ctx, customer, parsed, prisma);
    expect(result.status).toBe('NO_MATCHING_SCHEDULED');
  });
});

describe('bid-reply handler', () => {
  test('DECLINE_BID withdraws bid', async () => {
    const prisma = makePrisma({
      bid: { findFirst: jest.fn().mockResolvedValue({ id: 'b1', driverId: 'user-2' }) },
    });
    const parsed: ParsedMessage = { intent: 'DECLINE_BID', raw: 'NO', normalised: 'NO' };
    const result = await bidReply(ctx, driver, parsed, prisma);
    expect(bidService.withdrawBid).toHaveBeenCalledWith('b1', 'user-2', 'USER');
    expect(result.replyBody).toBe(REPLY_TEMPLATES.BID_DECLINED);
  });

  test('no recent bid → NO_MATCHING_BID', async () => {
    const prisma = makePrisma();
    const parsed: ParsedMessage = { intent: 'ACCEPT_BID', raw: 'YES', normalised: 'YES' };
    const result = await bidReply(ctx, driver, parsed, prisma);
    expect(result.status).toBe('NO_MATCHING_BID');
  });
});

describe('status handler', () => {
  test('active journey → composed reply with destination', async () => {
    const prisma = makePrisma({
      journey: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({ id: 'j9', destinationName: 'Kacyiru', status: 'IN_PROGRESS' }),
      },
    });
    const parsed: ParsedMessage = { intent: 'STATUS_QUERY', raw: 'STATUS', normalised: 'STATUS' };
    const result = await statusHandler(ctx, customer, parsed, prisma);
    expect(result.status).toBe('PROCESSED');
    expect(result.replyBody).toContain('Kacyiru');
  });
});

describe('balance handler', () => {
  test('non-driver → restricted reply', async () => {
    const prisma = makePrisma();
    const parsed: ParsedMessage = { intent: 'BALANCE_QUERY', raw: 'BAL', normalised: 'BALANCE' };
    const result = await balanceHandler(ctx, customer, parsed, prisma);
    expect(result.replyBody).toContain('drivers only');
  });

  test('driver → pending balance shown', async () => {
    const prisma = makePrisma({
      driverBalance: { findUnique: jest.fn().mockResolvedValue({ pendingAmount: 12345 }) },
    });
    const parsed: ParsedMessage = { intent: 'BALANCE_QUERY', raw: 'BAL', normalised: 'BALANCE' };
    const result = await balanceHandler(ctx, driver, parsed, prisma);
    expect(result.replyBody).toContain('12,345');
  });

  describe('next-disbursement line follows the effective preference', () => {
    const parsed: ParsedMessage = { intent: 'BALANCE_QUERY', raw: 'BAL', normalised: 'BALANCE' };
    const prismaWithBalance = () =>
      makePrisma({
        driverBalance: { findUnique: jest.fn().mockResolvedValue({ pendingAmount: 5000 }) },
      });
    // Africa/Kigali is UTC+2 (no DST).
    const atKigali = (utcIso: string): InboundContext => ({ ...ctx, receivedAt: new Date(utcIso) });
    const shiftEndDriver: any = { ...driver, payoutPreference: 'AT_SHIFT_END', completedShifts: 5 };
    const twiceDailyDriver: any = { ...driver, payoutPreference: 'TWICE_DAILY', completedShifts: 5 };
    const daily22Driver: any = { ...driver, payoutPreference: 'DAILY_22H', completedShifts: 5 };

    test('AT_SHIFT_END → "when you end your shift"', async () => {
      const result = await balanceHandler(ctx, shiftEndDriver, parsed, prismaWithBalance());
      expect(result.replyBody).toContain('when you end your shift');
    });

    test('TWICE_DAILY before 06:00 Kigali → today 06:00', async () => {
      const result = await balanceHandler(
        atKigali('2026-05-04T02:00:00.000Z'), // 04:00 Kigali
        twiceDailyDriver,
        parsed,
        prismaWithBalance(),
      );
      expect(result.replyBody).toContain('today 06:00');
    });

    test('TWICE_DAILY between 06:00 and 18:00 Kigali → today 18:00', async () => {
      const result = await balanceHandler(
        atKigali('2026-05-04T10:00:00.000Z'), // 12:00 Kigali
        twiceDailyDriver,
        parsed,
        prismaWithBalance(),
      );
      expect(result.replyBody).toContain('today 18:00');
    });

    test('TWICE_DAILY after 18:00 Kigali → tomorrow 06:00', async () => {
      const result = await balanceHandler(
        atKigali('2026-05-04T17:00:00.000Z'), // 19:00 Kigali
        twiceDailyDriver,
        parsed,
        prismaWithBalance(),
      );
      expect(result.replyBody).toContain('tomorrow 06:00');
    });

    test('DAILY_22H before 22:00 Kigali → today 22:00', async () => {
      const result = await balanceHandler(
        atKigali('2026-05-04T10:00:00.000Z'), // 12:00 Kigali
        daily22Driver,
        parsed,
        prismaWithBalance(),
      );
      expect(result.replyBody).toContain('today 22:00');
    });

    test('DAILY_22H after 22:00 Kigali → tomorrow 22:00', async () => {
      const result = await balanceHandler(
        atKigali('2026-05-04T20:30:00.000Z'), // 22:30 Kigali
        daily22Driver,
        parsed,
        prismaWithBalance(),
      );
      expect(result.replyBody).toContain('tomorrow 22:00');
    });

    test('training wheels: new AT_SHIFT_END driver (<3 shifts) gets TWICE_DAILY times', async () => {
      const newDriver: any = { ...driver, payoutPreference: 'AT_SHIFT_END', completedShifts: 1 };
      const result = await balanceHandler(
        atKigali('2026-05-04T10:00:00.000Z'), // 12:00 Kigali
        newDriver,
        parsed,
        prismaWithBalance(),
      );
      expect(result.replyBody).toContain('today 18:00');
      expect(result.replyBody).not.toContain('end your shift');
    });

    test('reply stays under 160 chars (single SMS)', async () => {
      const prisma = makePrisma({
        driverBalance: {
          findUnique: jest.fn().mockResolvedValue({ pendingAmount: 12_345_678 }),
        },
      });
      const result = await balanceHandler(ctx, shiftEndDriver, parsed, prisma);
      expect(result.replyBody!.length).toBeLessThan(160);
    });
  });
});

describe('help-stop handler', () => {
  test('STOP sets smsOptOut and replies STOP_RECORDED', async () => {
    const prisma = makePrisma();
    const parsed: ParsedMessage = { intent: 'STOP', raw: 'STOP', normalised: 'STOP' };
    const result = await helpStop(ctx, customer, parsed, prisma);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { smsOptOut: true },
    });
    expect(result.status).toBe('OPT_OUT_RECORDED');
    expect(result.replyBody).toBe(REPLY_TEMPLATES.STOP_RECORDED);
  });

  test('HELP returns help template', async () => {
    const prisma = makePrisma();
    const parsed: ParsedMessage = { intent: 'HELP', raw: 'HELP', normalised: 'HELP' };
    const result = await helpStop(ctx, customer, parsed, prisma);
    expect(result.status).toBe('PROCESSED');
    // SENDER-MATCH-2 — HELP is built now, not looked up: it names the
    // commands the running tier actually accepts, and carries a real support
    // number or none. tier.test.ts pins both shapes.
    expect(result.replyBody).toBe(helpReply());
  });
});

describe('unknown handler', () => {
  test('always replies UNKNOWN_INTENT', async () => {
    const prisma = makePrisma();
    const parsed: ParsedMessage = { intent: 'UNKNOWN', raw: 'gibberish', normalised: 'GIBBERISH' };
    const result = await unknownHandler(ctx, customer, parsed, prisma);
    expect(result.status).toBe('UNKNOWN_INTENT');
    expect(result.replyBody).toBe(REPLY_TEMPLATES.UNKNOWN_INTENT);
  });
});
