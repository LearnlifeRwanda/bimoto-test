// SENDER-MATCH-2 G2 — the tier, proven at every layer it exists in.
//
// The claim under test is narrow and load-bearing: under 'safe', no money
// or marketplace action is REACHABLE by SMS. Asserting the reply text alone
// would not prove that — a handler could run, move money, and still be
// followed by a "use the app" reply. So every gated case also asserts the
// service mock was never called.

import { encrypt, hashPhone } from '../../../utils/crypto';
import type { Intent } from '../types';
import { INTENT_TIER, isGatedIntent, type IntentTier } from '../tier';

jest.mock('../../sms.service', () => ({
  sendSms: jest.fn().mockResolvedValue({ success: true }),
}));
jest.mock('../../journey.service', () => ({
  confirmJourney: jest.fn().mockResolvedValue({}),
  disputeJourney: jest.fn().mockResolvedValue({}),
  cancelScheduledJourney: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../bid.service', () => ({
  withdrawBid: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../admin-notifications.service', () => ({
  notifyAdminsOfNewRecipientDispute: jest.fn(),
}));
jest.mock('../../escrow.service', () => ({
  freezeEscrowTx: jest.fn().mockResolvedValue({}),
}));

const CUSTOMER_PHONE = '+250788111111';
const DRIVER_PHONE = '+250788222222';
const STRANGER_PHONE = '+250788999999';

const state: any = {};

jest.mock('../../../prisma', () => ({
  __esModule: true,
  default: {
    smsInbound: {
      findUnique: jest.fn(async () => null),
      create: jest.fn(async () => ({ id: 'row1', status: 'PENDING' })),
      update: jest.fn(async (args: any) => {
        state.lastInboundUpdate = args.data;
        return {};
      }),
    },
    user: {
      findUnique: jest.fn(async ({ where }: any) => {
        const [[field, value]] = Object.entries(where);
        return (state.users as any[]).find((u: any) => u[field] === value) ?? null;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const u = (state.users as any[]).find((r: any) => r.id === where.id);
        Object.assign(u, data);
        return u;
      }),
    },
    journey: { findFirst: jest.fn(async () => state.journey ?? null) },
    bid: { findFirst: jest.fn(async () => state.bid ?? null) },
    driverBalance: { findUnique: jest.fn(async () => null) },
    leg: {
      findMany: jest.fn(async ({ where }: any) =>
        (state.legs ?? []).filter((l: any) => l.contactPhone === where.contactPhone),
      ),
      update: jest.fn(async (args: any) => {
        state.legUpdate = args;
        return {};
      }),
    },
    $transaction: jest.fn(async (fn: any) =>
      fn({
        leg: {
          update: jest.fn(async (args: any) => {
            state.legUpdate = args;
            return {};
          }),
        },
      }),
    ),
  },
}));

import { config } from '../../../config';
import { processInbound } from '../dispatcher';
import * as sms from '../../sms.service';
import * as journeyService from '../../journey.service';
import * as bidService from '../../bid.service';
import { REPLY_TEMPLATES, helpReply } from '../config';
import { assertSmsCommandTierSafety } from '../../../startup-guard';

function registered(id: string, phone: string, role: string) {
  return {
    id,
    phoneEncrypted: encrypt(phone),
    phoneHash: hashPhone(phone),
    role,
    smsOptOut: false,
    language: 'rw',
  };
}

let msgSeq = 0;
function ctx(from: string, body: string) {
  msgSeq += 1;
  return {
    atMessageId: `at-tier-${msgSeq}`,
    fromMsisdn: from,
    toShortcode: '15555',
    rawBody: body,
    receivedAt: new Date(),
  };
}

const ORIGINAL_TIER = config.SMS_COMMAND_TIER;
const ORIGINAL_SUPPORT = config.SUPPORT_PHONE;

function setTier(tier: 'safe' | 'full') {
  (config as any).SMS_COMMAND_TIER = tier;
}

beforeEach(() => {
  jest.clearAllMocks();
  const prismaMod = require('../../../prisma').default;
  prismaMod.journey.findFirst.mockImplementation(async () => state.journey ?? null);
  prismaMod.bid.findFirst.mockImplementation(async () => state.bid ?? null);
  setTier('safe');
  (config as any).SUPPORT_PHONE = ORIGINAL_SUPPORT;
  state.users = [
    registered('cust-1', CUSTOMER_PHONE, 'CUSTOMER'),
    registered('drv-1', DRIVER_PHONE, 'DRIVER'),
  ];
  state.journey = null;
  state.bid = null;
  state.legs = [];
  state.legUpdate = null;
  state.lastInboundUpdate = null;
});

afterAll(() => {
  (config as any).SMS_COMMAND_TIER = ORIGINAL_TIER;
  (config as any).SUPPORT_PHONE = ORIGINAL_SUPPORT;
});

// ---------------------------------------------------------------------------

describe('the tier table is exhaustive over the Intent union', () => {
  // The compile-time proof: this assignment only typechecks while INTENT_TIER
  // covers every member of Intent. Add an intent without a tier and the build
  // fails here, before any test runs.
  test('every Intent has a declared tier (compile-time ratchet)', () => {
    const exhaustive: Record<Intent, IntentTier> = INTENT_TIER;
    const declared = Object.keys(exhaustive).sort();
    expect(declared).toEqual(
      [
        'ACCEPT_BID',
        'BALANCE_QUERY',
        'CANCEL_SCHEDULED',
        'CONFIRM_JOURNEY',
        'CONFIRM_SCHEDULED',
        'DECLINE_BID',
        'DISPUTE_JOURNEY',
        'HELP',
        'RECIPIENT_CONFIRM',
        'RECIPIENT_DISPUTE',
        'STATUS_QUERY',
        'STOP',
        'UNKNOWN',
      ].sort(),
    );
  });

  test('the tier split is exactly the founder ruling', () => {
    const safe = Object.entries(INTENT_TIER)
      .filter(([, t]) => t === 'safe')
      .map(([i]) => i)
      .sort();
    const gated = Object.entries(INTENT_TIER)
      .filter(([, t]) => t === 'gated')
      .map(([i]) => i)
      .sort();
    expect(safe).toEqual(
      ['BALANCE_QUERY', 'HELP', 'RECIPIENT_CONFIRM', 'RECIPIENT_DISPUTE', 'STATUS_QUERY', 'STOP', 'UNKNOWN'].sort(),
    );
    expect(gated).toEqual(
      ['ACCEPT_BID', 'CANCEL_SCHEDULED', 'CONFIRM_JOURNEY', 'CONFIRM_SCHEDULED', 'DECLINE_BID', 'DISPUTE_JOURNEY'].sort(),
    );
  });

  test("under 'full' nothing is gated", () => {
    for (const intent of Object.keys(INTENT_TIER) as Intent[]) {
      expect(isGatedIntent(intent, 'full')).toBe(false);
    }
  });
});

describe("SAFE tier — every gated intent refuses WITHOUT invoking its handler", () => {
  test('CONFIRM_JOURNEY: no confirmJourney, no escrow release', async () => {
    state.journey = { id: 'j1', customerId: 'cust-1', endedAt: new Date() };
    const result = await processInbound(ctx(CUSTOMER_PHONE, 'YES'));
    expect(result.replyBody).toBe(REPLY_TEMPLATES.USE_APP);
    expect(journeyService.confirmJourney).not.toHaveBeenCalled();
  });

  test('DISPUTE_JOURNEY: no disputeJourney', async () => {
    state.journey = { id: 'j1', customerId: 'cust-1', endedAt: new Date() };
    const result = await processInbound(ctx(CUSTOMER_PHONE, 'NO'));
    expect(result.replyBody).toBe(REPLY_TEMPLATES.USE_APP);
    expect(journeyService.disputeJourney).not.toHaveBeenCalled();
  });

  test('CANCEL_SCHEDULED: no cancelScheduledJourney, no refund', async () => {
    state.journey = { id: 'j1', customerId: 'cust-1', scheduledFor: new Date() };
    const result = await processInbound(ctx(CUSTOMER_PHONE, 'CANCEL'));
    expect(result.replyBody).toBe(REPLY_TEMPLATES.USE_APP);
    expect(journeyService.cancelScheduledJourney).not.toHaveBeenCalled();
  });

  test('ACCEPT_BID via a driver YES inside the bid window: no bid touched', async () => {
    state.bid = { id: 'b1', driverId: 'drv-1', status: 'PENDING', createdAt: new Date() };
    const result = await processInbound(ctx(DRIVER_PHONE, 'YES'));
    expect(result.replyBody).toBe(REPLY_TEMPLATES.USE_APP);
    // The gate saw the EFFECTIVE intent — the row records ACCEPT_BID, so the
    // refusal was of the bid action, not of a journey reply.
    expect(state.lastInboundUpdate.intent).toBe('ACCEPT_BID');
    expect(bidService.withdrawBid).not.toHaveBeenCalled();
  });

  test('DECLINE_BID via a driver NO inside the bid window: withdrawBid never runs', async () => {
    state.bid = { id: 'b1', driverId: 'drv-1', status: 'PENDING', createdAt: new Date() };
    const result = await processInbound(ctx(DRIVER_PHONE, 'NO'));
    expect(result.replyBody).toBe(REPLY_TEMPLATES.USE_APP);
    expect(state.lastInboundUpdate.intent).toBe('DECLINE_BID');
    expect(bidService.withdrawBid).not.toHaveBeenCalled();
  });

  test('ACCEPT_BID via the explicit ACCEPT keyword is gated too', async () => {
    state.bid = { id: 'b1', driverId: 'drv-1', status: 'PENDING', createdAt: new Date() };
    const result = await processInbound(ctx(DRIVER_PHONE, 'ACCEPT'));
    expect(result.replyBody).toBe(REPLY_TEMPLATES.USE_APP);
  });

  test('the same driver YES OUTSIDE the bid window gates as CONFIRM_JOURNEY', async () => {
    state.bid = null;
    state.journey = { id: 'j1', customerId: 'cust-x', endedAt: new Date() };
    const result = await processInbound(ctx(DRIVER_PHONE, 'YES'));
    expect(result.replyBody).toBe(REPLY_TEMPLATES.USE_APP);
    expect(state.lastInboundUpdate.intent).toBe('CONFIRM_JOURNEY');
    expect(journeyService.confirmJourney).not.toHaveBeenCalled();
  });

  test('a gated refusal still resolves the sender onto the inbound row', async () => {
    state.journey = { id: 'j1', customerId: 'cust-1', endedAt: new Date() };
    await processInbound(ctx(CUSTOMER_PHONE, 'YES'));
    expect(state.lastInboundUpdate.userId).toBe('cust-1');
  });
});

describe('SAFE tier — every safe intent passes the gate', () => {
  test('STOP still records the opt-out', async () => {
    const result = await processInbound(ctx(CUSTOMER_PHONE, 'STOP'));
    expect(state.users[0].smsOptOut).toBe(true);
    expect(result.replyBody).toBe(REPLY_TEMPLATES.STOP_RECORDED);
  });

  test('HELP is answered', async () => {
    const result = await processInbound(ctx(CUSTOMER_PHONE, 'HELP'));
    expect(result.replyBody).toBe(helpReply());
    expect(result.status).toBe('PROCESSED');
  });

  test('STATUS reads the active ride', async () => {
    state.journey = {
      id: 'j1',
      customerId: 'cust-1',
      status: 'IN_PROGRESS',
      destinationName: 'Nyabugogo',
    };
    const result = await processInbound(ctx(CUSTOMER_PHONE, 'STATUS'));
    expect(result.replyBody).toContain('Nyabugogo');
  });

  test('BALANCE answers a driver', async () => {
    const result = await processInbound(ctx(DRIVER_PHONE, 'BALANCE'));
    expect(result.replyBody).toContain('Pending payout RWF 0');
  });

  test('an unrecognised word still gets the UNKNOWN reply, not the tier reply', async () => {
    const result = await processInbound(ctx(CUSTOMER_PHONE, 'sawubona'));
    expect(result.replyBody).toBe(REPLY_TEMPLATES.UNKNOWN_INTENT);
  });

  test('an opted-out user is still met with silence, not the tier reply', async () => {
    await processInbound(ctx(CUSTOMER_PHONE, 'STOP'));
    jest.clearAllMocks();
    state.journey = { id: 'j1', customerId: 'cust-1', endedAt: new Date() };
    const result = await processInbound(ctx(CUSTOMER_PHONE, 'YES'));
    expect(result.status).toBe('OPT_OUT_RECORDED');
    expect(result.replyBody).toBeUndefined();
    expect(sms.sendSms).not.toHaveBeenCalled();
  });
});

describe('the recipient flows are NEVER gated', () => {
  const LEG = (phone: string) => ({
    id: 'leg-1',
    journeyId: 'j-parcel',
    contactPhone: phone,
    journey: { customerId: 'cust-2', customer: { language: 'rw', nickname: 'Ana' } },
  });

  test('a RESOLVED user texting MURAKOZE confirms the receipt under safe', async () => {
    state.legs = [LEG(CUSTOMER_PHONE)];
    const result = await processInbound(ctx(CUSTOMER_PHONE, 'MURAKOZE'));
    expect(result.status).toBe('PROCESSED');
    expect(state.legUpdate.data.recipientConfirmStatus).toBe('EXPLICIT_REPLY');
  });

  test('a RESOLVED user texting a dispute keyword records it under safe', async () => {
    state.legs = [LEG(CUSTOMER_PHONE)];
    const result = await processInbound(ctx(CUSTOMER_PHONE, 'WRONG ITEM'));
    expect(result.status).toBe('PROCESSED');
    expect(state.legUpdate.data.recipientConfirmStatus).toBe('DISPUTED');
  });

  test('a STRANGER recipient is unaffected by the tier', async () => {
    state.legs = [LEG(STRANGER_PHONE)];
    const result = await processInbound(ctx(STRANGER_PHONE, 'RECEIVED'));
    expect(result.status).toBe('PROCESSED');
    expect(state.lastInboundUpdate.userId).toBeNull();
  });

  test('a resolved recipient with no matching leg still gets the UNKNOWN nudge', async () => {
    state.legs = [];
    const result = await processInbound(ctx(CUSTOMER_PHONE, 'YEGO'));
    expect(result.replyBody).toBe(REPLY_TEMPLATES.UNKNOWN_INTENT);
  });
});

describe("FULL tier — #193's behaviour is restored", () => {
  beforeEach(() => setTier('full'));

  test('CONFIRM_JOURNEY reaches confirmJourney again', async () => {
    state.journey = { id: 'j1', customerId: 'cust-1', endedAt: new Date() };
    const result = await processInbound(ctx(CUSTOMER_PHONE, 'YES'));
    expect(journeyService.confirmJourney).toHaveBeenCalledWith('j1', 'cust-1');
    expect(result.replyBody).toBe(REPLY_TEMPLATES.CONFIRMED);
  });

  test('a driver YES inside the window accepts the bid again', async () => {
    state.bid = { id: 'b1', driverId: 'drv-1', status: 'PENDING', createdAt: new Date() };
    const result = await processInbound(ctx(DRIVER_PHONE, 'YES'));
    expect(result.replyBody).toBe(REPLY_TEMPLATES.BID_ACCEPTED);
  });

  test('a driver NO inside the window withdraws the bid again', async () => {
    state.bid = { id: 'b1', driverId: 'drv-1', status: 'PENDING', createdAt: new Date() };
    await processInbound(ctx(DRIVER_PHONE, 'NO'));
    expect(bidService.withdrawBid).toHaveBeenCalledWith('b1', 'drv-1', 'USER');
  });

  test('CANCEL reaches cancelScheduledJourney again', async () => {
    state.journey = { id: 'j1', customerId: 'cust-1', scheduledFor: new Date() };
    await processInbound(ctx(CUSTOMER_PHONE, 'CANCEL'));
    expect(journeyService.cancelScheduledJourney).toHaveBeenCalledWith('j1', 'cust-1');
  });
});

describe('HELP — the placeholder support number is gone for good', () => {
  test('no template anywhere still carries the placeholder', () => {
    for (const body of Object.values(REPLY_TEMPLATES)) {
      expect(body).not.toContain('XXX');
    }
    expect(helpReply()).not.toContain('XXX');
  });

  test('with SUPPORT_PHONE set, the clause renders the real number', () => {
    (config as any).SUPPORT_PHONE = '+250788000000';
    expect(helpReply()).toContain('Support +250788000000.');
  });

  test('with SUPPORT_PHONE unset, the clause is OMITTED entirely', () => {
    (config as any).SUPPORT_PHONE = '';
    const body = helpReply();
    expect(body).not.toContain('Support');
    expect(body.endsWith('STOP=opt out.')).toBe(true);
  });

  test('whitespace-only SUPPORT_PHONE counts as unset', () => {
    (config as any).SUPPORT_PHONE = '   ';
    expect(helpReply()).not.toContain('Support');
  });

  test("under 'safe', HELP names only the commands that work", () => {
    setTier('safe');
    const body = helpReply();
    expect(body).toContain('STATUS');
    expect(body).toContain('BALANCE');
    expect(body).toContain('STOP');
    expect(body).not.toContain('1=confirm');
    expect(body).not.toContain('YES=accept');
  });

  test("under 'full', HELP keeps the wording that shipped", () => {
    setTier('full');
    (config as any).SUPPORT_PHONE = '';
    expect(helpReply()).toBe(
      'Bimoto: Reply 1=confirm 2=dispute YES=accept NO=decline STATUS=info STOP=opt out.',
    );
  });
});

describe('the boot refusal — both ways', () => {
  test('full + live REFUSES to boot', () => {
    expect(() =>
      assertSmsCommandTierSafety({ SMS_COMMAND_TIER: 'full', PAYMENTS_MODE: 'live' }),
    ).toThrow(/SMS_COMMAND_TIER=full with PAYMENTS_MODE=live/);
  });

  test('full + simulated boots — testing the full tier is legitimate', () => {
    expect(() =>
      assertSmsCommandTierSafety({ SMS_COMMAND_TIER: 'full', PAYMENTS_MODE: 'simulated' }),
    ).not.toThrow();
  });

  test('safe + live boots — this is the DEFAULT combination and the normal pilot', () => {
    expect(() =>
      assertSmsCommandTierSafety({ SMS_COMMAND_TIER: 'safe', PAYMENTS_MODE: 'live' }),
    ).not.toThrow();
  });

  test('safe + simulated boots', () => {
    expect(() =>
      assertSmsCommandTierSafety({ SMS_COMMAND_TIER: 'safe', PAYMENTS_MODE: 'simulated' }),
    ).not.toThrow();
  });

  test('the shipped defaults are safe + live, and they boot', () => {
    expect(config.SMS_COMMAND_TIER).toBe('safe');
    expect(() =>
      assertSmsCommandTierSafety({
        SMS_COMMAND_TIER: config.SMS_COMMAND_TIER,
        PAYMENTS_MODE: 'live',
      }),
    ).not.toThrow();
  });
});
