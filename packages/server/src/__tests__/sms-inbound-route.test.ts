import { createHmac } from 'crypto';

jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    smsInbound: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    user: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    bid: { findFirst: jest.fn() },
    journey: { findFirst: jest.fn() },
  },
}));

jest.mock('../services/sms.service', () => ({
  sendSms: jest.fn().mockResolvedValue({ success: true }),
}));

const SECRET = 'test-secret';
process.env.AT_INBOUND_HMAC_SECRET = SECRET;

import express from 'express';
import request from 'supertest';
import smsInboundRoutes from '../routes/sms-inbound.routes';
import prisma from '../prisma';
import { config } from '../config';
import * as smsService from '../services/sms.service';

const app = express();
app.use('/api/sms', smsInboundRoutes);

const repo = (prisma as any).smsInbound;
const userRepo = (prisma as any).user;
const bidRepo = (prisma as any).bid;
const journeyRepo = (prisma as any).journey;

function signed(body: Record<string, string>): { raw: string; sig: string } {
  const raw = new URLSearchParams(body).toString();
  const sig = createHmac('sha256', SECRET).update(raw, 'utf8').digest('hex');
  return { raw, sig };
}

beforeEach(() => {
  jest.clearAllMocks();
  repo.findUnique.mockResolvedValue(null);
  repo.create.mockResolvedValue({ id: 'row1', status: 'PENDING' });
  userRepo.findUnique.mockResolvedValue(null);
  bidRepo.findFirst.mockResolvedValue(null);
  journeyRepo.findFirst.mockResolvedValue(null);
});

function flushAsync() {
  return new Promise((r) => setImmediate(r));
}

describe('POST /api/sms/inbound — signature verification', () => {
  test('missing signature → 401', async () => {
    const res = await request(app)
      .post('/api/sms/inbound')
      .type('form')
      .send({ id: 'm1', from: '+250788111111', to: '15555', text: 'YES' });
    expect(res.status).toBe(401);
  });

  test('bad signature → 401', async () => {
    const res = await request(app)
      .post('/api/sms/inbound')
      .type('form')
      .set('X-AT-Signature', 'deadbeef')
      .send({ id: 'm1', from: '+250788111111', to: '15555', text: 'YES' });
    expect(res.status).toBe(401);
  });

  test('valid signature + new id → 200, row created', async () => {
    const body = { id: 'm-new', from: '+250788111111', to: '15555', text: 'YES' };
    const { sig } = signed(body);
    const res = await request(app)
      .post('/api/sms/inbound')
      .type('form')
      .set('X-AT-Signature', sig)
      .send(body);
    expect(res.status).toBe(200);
    await flushAsync();
    expect(repo.create).toHaveBeenCalled();
  });
});

describe('POST /api/sms/inbound — idempotency', () => {
  test('duplicate id → 200, processed only once', async () => {
    repo.findUnique.mockResolvedValue({
      id: 'row1',
      status: 'PROCESSED',
      replyBody: 'prev',
      resolvedEntityId: null,
      errorMessage: null,
    });
    const body = { id: 'm-dup', from: '+250788111111', to: '15555', text: 'YES' };
    const { sig } = signed(body);
    const res = await request(app)
      .post('/api/sms/inbound')
      .type('form')
      .set('X-AT-Signature', sig)
      .send(body);
    expect(res.status).toBe(200);
    await flushAsync();
    expect(repo.create).not.toHaveBeenCalled();
  });
});

// SENDER-MATCH-2 — this block asserts the webhook's PLUMBING end to end
// (signature → dispatch → row stamped → reply sent), and its CONFIRM case
// exercises an intent the pilot now gates. Plumbing is the subject, so it
// runs under the full tier; the safe tier's refusal over the same wire is
// asserted in sms-inbound/__tests__/tier.test.ts and, against a real
// Postgres, in sender-match.e2e.test.ts case (e).
describe('POST /api/sms/inbound — sender behaviours', () => {
  const ORIGINAL_TIER = config.SMS_COMMAND_TIER;
  beforeAll(() => {
    (config as any).SMS_COMMAND_TIER = 'full';
  });
  afterAll(() => {
    (config as any).SMS_COMMAND_TIER = ORIGINAL_TIER;
  });

  test('UNMATCHED sender → 200, status UNMATCHED_SENDER, auto-reply sent', async () => {
    userRepo.findUnique.mockResolvedValue(null);
    const body = { id: 'm-unmatched', from: '+250788222222', to: '15555', text: 'YES' };
    const { sig } = signed(body);
    await request(app)
      .post('/api/sms/inbound')
      .type('form')
      .set('X-AT-Signature', sig)
      .send(body);
    await flushAsync();
    expect(smsService.sendSms).toHaveBeenCalled();
    expect(repo.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'UNMATCHED_SENDER' }),
      }),
    );
  });

  test('opted-out user → 200, status OPT_OUT_RECORDED, no reply', async () => {
    userRepo.findUnique.mockResolvedValue({ id: 'u1', role: 'CUSTOMER', smsOptOut: true });
    const body = { id: 'm-optout', from: '+250788111111', to: '15555', text: 'YES' };
    const { sig } = signed(body);
    await request(app)
      .post('/api/sms/inbound')
      .type('form')
      .set('X-AT-Signature', sig)
      .send(body);
    await flushAsync();
    expect(smsService.sendSms).not.toHaveBeenCalled();
    expect(repo.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'OPT_OUT_RECORDED' }),
      }),
    );
  });

  test('valid CONFIRM → row PROCESSED + journey transitioned', async () => {
    userRepo.findUnique.mockResolvedValue({ id: 'u1', role: 'CUSTOMER', smsOptOut: false });
    journeyRepo.findFirst.mockResolvedValue({
      id: 'j-1',
      customerId: 'u1',
      endedAt: new Date(),
    });
    jest.spyOn(require('../services/journey.service'), 'confirmJourney').mockResolvedValue({});
    const body = { id: 'm-confirm', from: '+250788111111', to: '15555', text: '1' };
    const { sig } = signed(body);
    const res = await request(app)
      .post('/api/sms/inbound')
      .type('form')
      .set('X-AT-Signature', sig)
      .send(body);
    expect(res.status).toBe(200);
    await flushAsync();
    expect(repo.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'PROCESSED', resolvedEntityId: 'j-1' }),
      }),
    );
  });
});
