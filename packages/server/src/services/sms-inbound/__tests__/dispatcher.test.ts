jest.mock('../../../prisma', () => ({
  __esModule: true,
  default: {
    smsInbound: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    user: { findUnique: jest.fn() },
    bid: { findFirst: jest.fn() },
  },
}));

jest.mock('../../sms.service', () => ({
  sendSms: jest.fn().mockResolvedValue({ success: true }),
}));

jest.mock('../handlers', () => {
  const handle = jest.fn();
  const recipientConfirmHandle = jest.fn();
  const recipientDisputeHandle = jest.fn();
  return {
    handlerByIntent: new Proxy({} as any, {
      get: () => handle,
    }),
    recipientConfirm: { handle: recipientConfirmHandle },
    recipientDispute: { handle: recipientDisputeHandle },
    __mock: handle,
    __recipientConfirmMock: recipientConfirmHandle,
    __recipientDisputeMock: recipientDisputeHandle,
  };
});

import prisma from '../../../prisma';
import { config } from '../../../config';
import { processInbound } from '../dispatcher';
import * as sms from '../../sms.service';
const handlersMod = require('../handlers');
const handlerMock: jest.Mock = handlersMod.__mock;
const recipientConfirmMock: jest.Mock = handlersMod.__recipientConfirmMock;
const recipientDisputeMock: jest.Mock = handlersMod.__recipientDisputeMock;

const repo = (prisma as any).smsInbound;
const userRepo = (prisma as any).user;
const bidRepo = (prisma as any).bid;

const baseCtx = {
  atMessageId: 'at-1',
  fromMsisdn: '+250788111111',
  toShortcode: '15555',
  rawBody: 'YES',
  receivedAt: new Date(),
};

// SENDER-MATCH-2 — this suite tests ROUTING (idempotency, sender resolution,
// bid disambiguation), and several cases route intents the pilot now gates.
// Routing is what it is asserting, so it runs under the full tier; the safe
// tier's refusals are tier.test.ts's subject, not this file's.
const ORIGINAL_TIER = config.SMS_COMMAND_TIER;
beforeAll(() => {
  (config as any).SMS_COMMAND_TIER = 'full';
});
afterAll(() => {
  (config as any).SMS_COMMAND_TIER = ORIGINAL_TIER;
});

beforeEach(() => {
  jest.clearAllMocks();
  repo.findUnique.mockResolvedValue(null);
  repo.create.mockResolvedValue({ id: 'row1', status: 'PENDING' });
  repo.update.mockResolvedValue({});
  userRepo.findUnique.mockResolvedValue({ id: 'u1', role: 'CUSTOMER', smsOptOut: false });
  bidRepo.findFirst.mockResolvedValue(null);
  handlerMock.mockResolvedValue({ status: 'PROCESSED', replyBody: 'ok' });
  recipientConfirmMock.mockResolvedValue({ status: 'PROCESSED', replyBody: 'thanks' });
  recipientDisputeMock.mockResolvedValue({ status: 'PROCESSED', replyBody: 'dispute-ack' });
});

describe('processInbound — idempotency', () => {
  test('duplicate atMessageId short-circuits without invoking handler', async () => {
    repo.findUnique.mockResolvedValue({
      id: 'row1',
      status: 'PROCESSED',
      replyBody: 'prev',
      resolvedEntityId: 'j1',
      errorMessage: null,
    });
    const result = await processInbound(baseCtx);
    expect(handlerMock).not.toHaveBeenCalled();
    expect(result.status).toBe('PROCESSED');
    expect(result.replyBody).toBe('prev');
  });

  test('first-time POST invokes handler and updates the row', async () => {
    await processInbound(baseCtx);
    expect(handlerMock).toHaveBeenCalledTimes(1);
    expect(repo.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'PROCESSED', replyBody: 'ok' }),
      }),
    );
    expect(sms.sendSms).toHaveBeenCalledWith('+250788111111', 'ok');
  });
});

describe('processInbound — sender resolution', () => {
  test('UNMATCHED sender (non-RECIPIENT_CONFIRM intent) → UNMATCHED_SENDER, recipient handler NOT invoked', async () => {
    userRepo.findUnique.mockResolvedValue(null);
    const result = await processInbound(baseCtx);
    expect(handlerMock).not.toHaveBeenCalled();
    expect(recipientConfirmMock).not.toHaveBeenCalled();
    expect(result.status).toBe('UNMATCHED_SENDER');
    expect(sms.sendSms).toHaveBeenCalled();
  });

  test('UNMATCHED sender + RECIPIENT_CONFIRM intent → routes to recipient-confirm handler (R3-RECIPIENT-CONFIRM)', async () => {
    userRepo.findUnique.mockResolvedValue(null);
    const result = await processInbound({ ...baseCtx, rawBody: 'RECEIVED' });
    expect(handlerMock).not.toHaveBeenCalled();
    expect(recipientConfirmMock).toHaveBeenCalledTimes(1);
    expect(recipientDisputeMock).not.toHaveBeenCalled();
    expect(result.status).toBe('PROCESSED');
    expect(sms.sendSms).toHaveBeenCalledWith('+250788111111', 'thanks');
  });

  test('UNMATCHED sender + RECIPIENT_DISPUTE intent → routes to recipient-dispute handler (R3-RECIPIENT-CONFIRM-2)', async () => {
    userRepo.findUnique.mockResolvedValue(null);
    const result = await processInbound({ ...baseCtx, rawBody: 'WRONG ITEM' });
    expect(handlerMock).not.toHaveBeenCalled();
    expect(recipientConfirmMock).not.toHaveBeenCalled();
    expect(recipientDisputeMock).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('PROCESSED');
    expect(sms.sendSms).toHaveBeenCalledWith('+250788111111', 'dispute-ack');
  });

  // SENDER-MATCH — this test used to assert the opposite, and it was the pin
  // holding the premise "recipients have no Bimoto account by definition" in
  // place. It could only ever have been written against a lookup that matched
  // nobody: the resolved-user case it describes had never occurred in
  // production. A registered user CAN be a parcel recipient, and the leg's
  // contact phone is the authority for a receipt — so the recipient handler is
  // now attempted first, and handlerByIntent is the fallback when no leg matches.
  test('matched Bimoto user replying RECIPIENT_CONFIRM keyword → recipient-leg match is attempted FIRST', async () => {
    userRepo.findUnique.mockResolvedValue({ id: 'u1', role: 'CUSTOMER', smsOptOut: false });
    await processInbound({ ...baseCtx, rawBody: 'OK' });
    expect(recipientConfirmMock).toHaveBeenCalledTimes(1);
    expect(handlerMock).not.toHaveBeenCalled();
  });

  test('matched Bimoto user, RECIPIENT_CONFIRM, NO matching leg → falls back to handlerByIntent', async () => {
    userRepo.findUnique.mockResolvedValue({ id: 'u1', role: 'CUSTOMER', smsOptOut: false });
    recipientConfirmMock.mockResolvedValue({ status: 'NO_MATCHING_JOURNEY', replyBody: 'nope' });
    await processInbound({ ...baseCtx, rawBody: 'OK' });
    expect(recipientConfirmMock).toHaveBeenCalledTimes(1);
    expect(handlerMock).toHaveBeenCalledTimes(1);
  });

  test('matched Bimoto user, RECIPIENT_DISPUTE, NO matching leg → falls back to handlerByIntent', async () => {
    userRepo.findUnique.mockResolvedValue({ id: 'u1', role: 'CUSTOMER', smsOptOut: false });
    recipientDisputeMock.mockResolvedValue({ status: 'NO_MATCHING_JOURNEY', replyBody: 'nope' });
    await processInbound({ ...baseCtx, rawBody: 'WRONG ITEM' });
    expect(recipientDisputeMock).toHaveBeenCalledTimes(1);
    expect(handlerMock).toHaveBeenCalledTimes(1);
  });

  test('opted-out user with non-STOP/HELP → silent OPT_OUT_RECORDED, no reply', async () => {
    userRepo.findUnique.mockResolvedValue({ id: 'u1', role: 'CUSTOMER', smsOptOut: true });
    const result = await processInbound(baseCtx);
    expect(handlerMock).not.toHaveBeenCalled();
    expect(result.status).toBe('OPT_OUT_RECORDED');
    expect(sms.sendSms).not.toHaveBeenCalled();
  });

  test('opted-out user replying STOP still routes to handler', async () => {
    userRepo.findUnique.mockResolvedValue({ id: 'u1', role: 'CUSTOMER', smsOptOut: true });
    await processInbound({ ...baseCtx, rawBody: 'STOP' });
    expect(handlerMock).toHaveBeenCalled();
  });
});

describe('processInbound — YES/NO disambiguation by recent bid context', () => {
  test('driver with open recent bid: YES → ACCEPT_BID', async () => {
    userRepo.findUnique.mockResolvedValue({ id: 'd1', role: 'DRIVER', smsOptOut: false });
    bidRepo.findFirst.mockResolvedValue({ id: 'b1' });
    await processInbound({ ...baseCtx, rawBody: 'YES' });
    const callArgs = handlerMock.mock.calls[0];
    expect(callArgs[2].intent).toBe('ACCEPT_BID');
  });

  test('driver with no open bid: YES stays as CONFIRM_JOURNEY', async () => {
    userRepo.findUnique.mockResolvedValue({ id: 'd1', role: 'DRIVER', smsOptOut: false });
    bidRepo.findFirst.mockResolvedValue(null);
    await processInbound({ ...baseCtx, rawBody: 'YES' });
    const callArgs = handlerMock.mock.calls[0];
    expect(callArgs[2].intent).toBe('CONFIRM_JOURNEY');
  });

  test('customer with open recent bid (lookup skipped): YES stays as CONFIRM_JOURNEY', async () => {
    userRepo.findUnique.mockResolvedValue({ id: 'c1', role: 'CUSTOMER', smsOptOut: false });
    bidRepo.findFirst.mockResolvedValue({ id: 'b1' });
    await processInbound({ ...baseCtx, rawBody: 'YES' });
    const callArgs = handlerMock.mock.calls[0];
    expect(callArgs[2].intent).toBe('CONFIRM_JOURNEY');
  });
});
