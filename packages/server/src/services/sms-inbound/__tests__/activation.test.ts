// SENDER-MATCH G3 — the activation surface, proven one intent at a time.
//
// Every assertion in this file describes behaviour that has NEVER run in
// production. The registered-user branch of the dispatcher was gated on a
// lookup that always returned null (#182), so every intent below fell into
// the stranger path forever. These tests are the first exercise of each.
//
// The prisma double answers `user.findUnique` by applying the `where` clause
// the caller actually passed against a row built with the REAL encrypt() and
// hashPhone(). That is deliberate: a double that returned the user regardless
// of the query would pass under the broken lookup too, and would prove
// nothing about activation.

import { encrypt, hashPhone } from '../../../utils/crypto';

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

jest.mock('../../../prisma', () => {
  const rows = () => state.users as any[];
  return {
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
          return rows().find((u: any) => u[field] === value) ?? null;
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const u = rows().find((r: any) => r.id === where.id);
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
  };
});

import { config } from '../../../config';
import { processInbound } from '../dispatcher';
import * as sms from '../../sms.service';
import * as journeyService from '../../journey.service';
import * as bidService from '../../bid.service';
import { REPLY_TEMPLATES } from '../config';

function registered(id: string, phone: string, role: string, extra: any = {}) {
  return {
    id,
    phoneEncrypted: encrypt(phone),
    phoneHash: hashPhone(phone),
    role,
    smsOptOut: false,
    language: 'rw',
    ...extra,
  };
}

let msgSeq = 0;
function ctx(from: string, body: string) {
  msgSeq += 1;
  return {
    atMessageId: `at-${msgSeq}`,
    fromMsisdn: from,
    toShortcode: '15555',
    rawBody: body,
    receivedAt: new Date(),
  };
}

// SENDER-MATCH-2 — this suite is the FULL tier's specification.
//
// Every activation it proves is now gated off in the pilot: SMS
// authenticates by caller ID, so money and marketplace commands answer
// "use the app" (see tier.ts). The proofs still have to hold, because
// `full` is what a future deliberate design would switch on, and it must
// switch on onto working paths rather than onto whatever rotted while the
// tier was closed. tier.test.ts owns the safe-tier behaviour.
const ORIGINAL_TIER = config.SMS_COMMAND_TIER;
beforeAll(() => {
  (config as any).SMS_COMMAND_TIER = 'full';
});
afterAll(() => {
  (config as any).SMS_COMMAND_TIER = ORIGINAL_TIER;
});

beforeEach(() => {
  jest.clearAllMocks();
  // clearAllMocks resets calls but NOT implementations, and one test below
  // installs its own findFirst to pin an ordering rule. Re-establish the
  // defaults explicitly so that test cannot leak into its neighbours.
  const prismaMod = require('../../../prisma').default;
  prismaMod.journey.findFirst.mockImplementation(async () => state.journey ?? null);
  prismaMod.bid.findFirst.mockImplementation(async () => state.bid ?? null);
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

// ---------------------------------------------------------------------------

describe('the registered-user branch is reachable at all', () => {
  test('a registered customer resolves, and SmsInbound.userId is finally populated', async () => {
    state.journey = { id: 'j1', customerId: 'cust-1', endedAt: new Date() };
    const result = await processInbound(ctx(CUSTOMER_PHONE, 'YES'));
    expect(result.status).toBe('PROCESSED');
    expect(state.lastInboundUpdate.userId).toBe('cust-1');
  });

  test('a stranger still resolves to null and the row keeps userId null', async () => {
    const result = await processInbound(ctx(STRANGER_PHONE, 'YES'));
    expect(result.status).toBe('UNMATCHED_SENDER');
    expect(state.lastInboundUpdate.userId).toBeNull();
  });
});

describe('the money paths — CONFIRM/DISPUTE_JOURNEY (#184-transactional)', () => {
  test('CONFIRM: a registered customer texting YES reaches confirmJourney', async () => {
    state.journey = { id: 'j1', customerId: 'cust-1', endedAt: new Date() };
    const result = await processInbound(ctx(CUSTOMER_PHONE, 'YES'));
    expect(journeyService.confirmJourney).toHaveBeenCalledWith('j1', 'cust-1');
    expect(result.replyBody).toBe(REPLY_TEMPLATES.CONFIRMED);
    expect(state.lastInboundUpdate.resolvedEntityId).toBe('j1');
  });

  test('DISPUTE: a registered customer texting NO reaches disputeJourney', async () => {
    state.journey = { id: 'j1', customerId: 'cust-1', endedAt: new Date() };
    const result = await processInbound(ctx(CUSTOMER_PHONE, 'NO'));
    expect(journeyService.disputeJourney).toHaveBeenCalledWith(
      'j1',
      'cust-1',
      'Disputed via inbound SMS',
    );
    expect(result.replyBody).toBe(REPLY_TEMPLATES.DISPUTED);
  });

  test('TARGET SELECTION: with two awaiting rides, the handler acts on the query the rule defines', async () => {
    // journey-reply.ts orders `endedAt: 'desc'` and takes findFirst — the
    // most-recently-ended ride within the 24h window. An SMS carries no
    // journey id, so this ordering IS the safety property. Pinned here so it
    // cannot drift silently into "whichever row the planner returns first".
    const prismaMod = require('../../../prisma').default;
    const older = { id: 'j-older', customerId: 'cust-1', endedAt: new Date(Date.now() - 3600_000) };
    const newer = { id: 'j-newer', customerId: 'cust-1', endedAt: new Date() };
    const candidates = [older, newer];
    prismaMod.journey.findFirst.mockImplementation(async ({ orderBy }: any) => {
      expect(orderBy).toEqual({ endedAt: 'desc' });
      return [...candidates].sort(
        (a, b) => b.endedAt.getTime() - a.endedAt.getTime(),
      )[0];
    });
    await processInbound(ctx(CUSTOMER_PHONE, 'YES'));
    expect(journeyService.confirmJourney).toHaveBeenCalledWith('j-newer', 'cust-1');
  });

  test('no matching ride: the customer is told so, and no money moves', async () => {
    state.journey = null;
    const result = await processInbound(ctx(CUSTOMER_PHONE, 'YES'));
    expect(journeyService.confirmJourney).not.toHaveBeenCalled();
    expect(result.status).toBe('NO_MATCHING_JOURNEY');
    expect(result.replyBody).toBe(REPLY_TEMPLATES.NO_MATCHING_JOURNEY);
  });
});

describe('the driver SMS-bidding capability', () => {
  test('a DRIVER with an open bid: YES is disambiguated to ACCEPT_BID', async () => {
    state.bid = { id: 'b1', driverId: 'drv-1', status: 'PENDING', createdAt: new Date() };
    const result = await processInbound(ctx(DRIVER_PHONE, 'YES'));
    expect(result.replyBody).toBe(REPLY_TEMPLATES.BID_ACCEPTED);
    expect(state.lastInboundUpdate.intent).toBe('ACCEPT_BID');
    expect(state.lastInboundUpdate.resolvedEntityId).toBe('b1');
  });

  test('a DRIVER with an open bid: NO is disambiguated to DECLINE_BID and withdraws it', async () => {
    state.bid = { id: 'b1', driverId: 'drv-1', status: 'PENDING', createdAt: new Date() };
    const result = await processInbound(ctx(DRIVER_PHONE, 'NO'));
    expect(bidService.withdrawBid).toHaveBeenCalledWith('b1', 'drv-1', 'USER');
    expect(result.replyBody).toBe(REPLY_TEMPLATES.BID_DECLINED);
    expect(state.lastInboundUpdate.intent).toBe('DECLINE_BID');
  });

  test('a DRIVER with no open bid: YES stays CONFIRM_JOURNEY', async () => {
    state.bid = null;
    state.journey = { id: 'j1', customerId: 'cust-x', endedAt: new Date() };
    await processInbound(ctx(DRIVER_PHONE, 'YES'));
    expect(state.lastInboundUpdate.intent).toBe('CONFIRM_JOURNEY');
  });
});

describe('THE BOTH-USER AMBIGUITY — the launch\'s sharpest correctness edge', () => {
  // A BOTH-role user is what onboarding produces. They may hold an open bid
  // AS DRIVER and a ride awaiting confirmation AS CUSTOMER at the same moment,
  // and "YES" is the same three letters for both.
  //
  // disambiguateBidContext (dispatcher.ts) decides on ONE piece of evidence:
  // does a PENDING bid exist for this user as driver, created inside the
  // BID_REPLY_WINDOW_MINUTES window? If yes, the bid wins — unconditionally.
  // It never looks at the journey side, so the ride awaiting confirmation is
  // not weighed, not compared by recency, and not mentioned.
  //
  // The loser's experience: the customer-side ride stays in
  // AWAITING_CONFIRMATION, no escrow is released, and the reply the user gets
  // is "Bid accepted. Customer notified." — a driver-shaped answer to what
  // they may have meant as a passenger. Their ride then falls to the 24h
  // auto-confirm cron. This is documented, not endorsed; the test exists so
  // the rule cannot change without someone deciding to change it.
  test('bid wins over the awaiting ride, unconditionally', async () => {
    state.users = [registered('both-1', CUSTOMER_PHONE, 'BOTH')];
    state.bid = { id: 'b1', driverId: 'both-1', status: 'PENDING', createdAt: new Date() };
    state.journey = { id: 'j1', customerId: 'both-1', endedAt: new Date() };

    const result = await processInbound(ctx(CUSTOMER_PHONE, 'YES'));

    expect(state.lastInboundUpdate.intent).toBe('ACCEPT_BID');
    expect(result.replyBody).toBe(REPLY_TEMPLATES.BID_ACCEPTED);
    // The money path is NOT taken: the ride the user may have meant is left
    // awaiting confirmation, escrow unreleased.
    expect(journeyService.confirmJourney).not.toHaveBeenCalled();
  });

  test('the bid wins even when the awaiting ride is the more recent event', async () => {
    state.users = [registered('both-1', CUSTOMER_PHONE, 'BOTH')];
    state.bid = {
      id: 'b1',
      driverId: 'both-1',
      status: 'PENDING',
      createdAt: new Date(Date.now() - 4 * 60_000),
    };
    state.journey = { id: 'j1', customerId: 'both-1', endedAt: new Date() };
    await processInbound(ctx(CUSTOMER_PHONE, 'YES'));
    expect(state.lastInboundUpdate.intent).toBe('ACCEPT_BID');
  });

  test('with no open bid, the same BOTH user reaches the money path', async () => {
    state.users = [registered('both-1', CUSTOMER_PHONE, 'BOTH')];
    state.bid = null;
    state.journey = { id: 'j1', customerId: 'both-1', endedAt: new Date() };
    await processInbound(ctx(CUSTOMER_PHONE, 'YES'));
    expect(journeyService.confirmJourney).toHaveBeenCalledWith('j1', 'both-1');
  });
});

describe('STOP — the opt-out that never worked', () => {
  test('STOP sets smsOptOut and confirms', async () => {
    const result = await processInbound(ctx(CUSTOMER_PHONE, 'STOP'));
    expect(state.users[0].smsOptOut).toBe(true);
    expect(result.status).toBe('OPT_OUT_RECORDED');
    expect(result.replyBody).toBe(REPLY_TEMPLATES.STOP_RECORDED);
    expect(sms.sendSms).toHaveBeenCalledWith(CUSTOMER_PHONE, REPLY_TEMPLATES.STOP_RECORDED);
  });

  test('after STOP, a non-STOP message is suppressed: handler NOT invoked, NOTHING sent', async () => {
    await processInbound(ctx(CUSTOMER_PHONE, 'STOP'));
    jest.clearAllMocks();
    state.journey = { id: 'j1', customerId: 'cust-1', endedAt: new Date() };

    const result = await processInbound(ctx(CUSTOMER_PHONE, 'YES'));

    expect(result.status).toBe('OPT_OUT_RECORDED');
    expect(journeyService.confirmJourney).not.toHaveBeenCalled();
    // The precedence gate carries no replyBody, and dispatcher.ts sends only
    // when one exists — so an opted-out user is met with silence, which is
    // what "opted out" has to mean.
    expect(result.replyBody).toBeUndefined();
    expect(sms.sendSms).not.toHaveBeenCalled();
  });

  test('HELP is still answered despite opt-out — the :93 gate, exercised', async () => {
    await processInbound(ctx(CUSTOMER_PHONE, 'STOP'));
    jest.clearAllMocks();
    const result = await processInbound(ctx(CUSTOMER_PHONE, 'HELP'));
    expect(result.status).toBe('PROCESSED');
    expect(result.replyBody).toBe(REPLY_TEMPLATES.HELP);
    expect(sms.sendSms).toHaveBeenCalledWith(CUSTOMER_PHONE, REPLY_TEMPLATES.HELP);
  });

  test('STOP is still honoured from an already-opted-out user', async () => {
    await processInbound(ctx(CUSTOMER_PHONE, 'STOP'));
    const result = await processInbound(ctx(CUSTOMER_PHONE, 'UNSUBSCRIBE'));
    expect(result.status).toBe('OPT_OUT_RECORDED');
    expect(result.replyBody).toBe(REPLY_TEMPLATES.STOP_RECORDED);
  });
});

describe('THE REGRESSION THE NAIVE FIX WOULD SHIP', () => {
  // This is the test that must FAIL against a lookup-only fix. A registered
  // user whose number is on a recent GOODS_DROPOFF leg confirms a receipt
  // today, as a stranger. Fix the lookup alone and they stop being a
  // stranger: they resolve as a user, RECIPIENT_CONFIRM routes to
  // unknown.handle, and their working receipt becomes a "reply YES/1" nudge.
  const LEG = {
    id: 'leg-1',
    journeyId: 'j-parcel',
    contactPhone: CUSTOMER_PHONE,
    journey: { customerId: 'cust-2', customer: { language: 'rw', nickname: 'Ana' } },
  };

  test('a REGISTERED user texting MURAKOZE still gets their receipt confirmed', async () => {
    state.legs = [LEG];
    const result = await processInbound(ctx(CUSTOMER_PHONE, 'MURAKOZE'));
    expect(result.status).toBe('PROCESSED');
    expect(result.resolvedEntityId).toBe('leg-1');
    expect(state.legUpdate.data.recipientConfirmStatus).toBe('EXPLICIT_REPLY');
    expect(result.replyBody).toContain('murakoze');
    // …and the row still records who they are.
    expect(state.lastInboundUpdate.userId).toBe('cust-1');
  });

  test('the same for YEGO — a registered customer texting Kinyarwanda "yes"', async () => {
    state.legs = [LEG];
    const result = await processInbound(ctx(CUSTOMER_PHONE, 'YEGO'));
    expect(result.status).toBe('PROCESSED');
    expect(state.legUpdate.data.recipientConfirmStatus).toBe('EXPLICIT_REPLY');
  });

  test('a REGISTERED user texting a dispute keyword still records the dispute', async () => {
    state.legs = [LEG];
    const result = await processInbound(ctx(CUSTOMER_PHONE, 'WRONG ITEM'));
    expect(result.status).toBe('PROCESSED');
    expect(state.legUpdate.data.recipientConfirmStatus).toBe('DISPUTED');
    expect(state.legUpdate.data.recipientDisputeReason).toBe('WRONG ITEM');
  });

  test('a registered user with NO matching leg gets the UNKNOWN nudge', async () => {
    state.legs = [];
    const result = await processInbound(ctx(CUSTOMER_PHONE, 'YEGO'));
    expect(result.status).toBe('UNKNOWN_INTENT');
    expect(result.replyBody).toBe(REPLY_TEMPLATES.UNKNOWN_INTENT);
    expect(state.lastInboundUpdate.userId).toBe('cust-1');
  });
});

describe('the stranger path, unchanged', () => {
  test('a stranger with a matching leg confirms the receipt exactly as before', async () => {
    state.legs = [
      {
        id: 'leg-s',
        journeyId: 'j-p',
        contactPhone: STRANGER_PHONE,
        journey: { customerId: 'cust-2', customer: { language: 'rw', nickname: 'Ana' } },
      },
    ];
    const result = await processInbound(ctx(STRANGER_PHONE, 'RECEIVED'));
    expect(result.status).toBe('PROCESSED');
    expect(result.resolvedEntityId).toBe('leg-s');
    expect(state.lastInboundUpdate.userId).toBeNull();
  });

  test('a stranger with no leg and a non-recipient intent is UNMATCHED_SENDER', async () => {
    const result = await processInbound(ctx(STRANGER_PHONE, 'STATUS'));
    expect(result.status).toBe('UNMATCHED_SENDER');
    expect(result.replyBody).toBe(REPLY_TEMPLATES.UNMATCHED_SENDER);
  });
});

describe('the remaining activated intents', () => {
  test('STATUS answers a registered user about their active ride', async () => {
    state.journey = { id: 'j1', customerId: 'cust-1', status: 'IN_PROGRESS', destinationName: 'Nyabugogo' };
    const result = await processInbound(ctx(CUSTOMER_PHONE, 'STATUS'));
    expect(result.status).toBe('PROCESSED');
    expect(result.replyBody).toContain('Nyabugogo');
  });

  test('BALANCE is refused to a CUSTOMER and answered for a DRIVER', async () => {
    const asCustomer = await processInbound(ctx(CUSTOMER_PHONE, 'BALANCE'));
    expect(asCustomer.replyBody).toBe('Bimoto: Balance command is for drivers only.');
    const asDriver = await processInbound(ctx(DRIVER_PHONE, 'BALANCE'));
    expect(asDriver.replyBody).toContain('Pending payout RWF 0');
  });

  test('HELP answers a registered user', async () => {
    const result = await processInbound(ctx(CUSTOMER_PHONE, 'HELP'));
    expect(result.replyBody).toBe(REPLY_TEMPLATES.HELP);
  });

  test('an unrecognised word from a registered user gets the UNKNOWN reply', async () => {
    const result = await processInbound(ctx(CUSTOMER_PHONE, 'sawubona'));
    expect(result.status).toBe('UNKNOWN_INTENT');
    expect(result.replyBody).toBe(REPLY_TEMPLATES.UNKNOWN_INTENT);
  });
});
