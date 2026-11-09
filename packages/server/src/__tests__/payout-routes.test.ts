jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    user: { findUnique: jest.fn() },
    driverBalance: { findUnique: jest.fn() },
    // LAUNCH-TRUTH G4 — the summary exposes the driver's active fee
    // waiver (minimum shape); default to no waiver.
    feeWaiver: { findFirst: jest.fn().mockResolvedValue(null) },
  },
}));

jest.mock('../services/otp.service', () => ({
  sendOtp: jest.fn(),
}));

jest.mock('../services/payout/preferences', () => ({
  applyPreferenceChange: jest.fn(),
}));

jest.mock('../services/payout.service', () => ({
  firePreferenceChangeBatch: jest.fn(),
}));

// MONEY-PIN G2 — every route in this file is now behind the money gate.
// The PIN service is mocked so these tests can say "this driver has a
// PIN" without also standing up the whole reset state machine; the
// SESSION is real, opened in beforeEach, because it is the thing the
// middleware actually reads.
jest.mock('../services/money-pin.service', () => ({
  getMoneyPinStatus: jest.fn(),
}));

import express from 'express';
import { encrypt } from '../utils/crypto';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import prisma from '../prisma';
import payoutRoutes from '../routes/payout.routes';
import { generateAccessToken } from '../utils/jwt';
import { errorHandler } from '../middleware/error-handler';
import { appVersionMiddleware } from '../middleware/app-version';
import { sendOtp } from '../services/otp.service';
import { applyPreferenceChange } from '../services/payout/preferences';
import { firePreferenceChangeBatch } from '../services/payout.service';
import { _resetRateLimitForTests } from '../middleware/rate-limit';
import { getMoneyPinStatus } from '../services/money-pin.service';
import {
  openMoneyStepUp,
  _resetMoneyStepUpForTests,
} from '../middleware/money-step-up';

const app = express();
app.use(express.json());
app.use(cookieParser());
// CUTGUARD v2 G6 — mirrors index.ts: `req.appVersion` before any router.
// Without it `req.appVersion` is undefined, which the gates read as
// legacy — the safe direction, and the reason a missing middleware
// cannot open a hole — but this harness is standing in for the real
// server, so it mounts what the real server mounts.
app.use(appVersionMiddleware);
app.use('/api/payout', payoutRoutes);
app.use(errorHandler);

const findUser = (prisma as any).user.findUnique as jest.Mock;
const findBalance = (prisma as any).driverBalance.findUnique as jest.Mock;
const sendOtpMock = sendOtp as jest.Mock;
const applyMock = applyPreferenceChange as jest.Mock;
const fireMock = firePreferenceChangeBatch as jest.Mock;

const pinStatusMock = getMoneyPinStatus as jest.Mock;

const driverToken = generateAccessToken({ userId: 'u1', role: 'DRIVER' });
const customerToken = generateAccessToken({ userId: 'c1', role: 'CUSTOMER' });

beforeEach(() => {
  jest.clearAllMocks();
  _resetRateLimitForTests();
  // The default posture for every test below: an enrolled driver who has
  // just proven his PIN. The gate itself is exercised in its own block at
  // the bottom of the file.
  _resetMoneyStepUpForTests();
  pinStatusMock.mockResolvedValue({ state: 'SET' });
  openMoneyStepUp('u1');
});

describe('POST /api/payout/preference/request-otp', () => {
  test('401 unauthenticated', async () => {
    const res = await request(app)
      .post('/api/payout/preference/request-otp')
      .send({ newPreference: 'TWICE_DAILY' });
    expect(res.status).toBe(401);
  });

  test('403 customer-only role', async () => {
    const res = await request(app)
      .post('/api/payout/preference/request-otp')
      .set('Cookie', [`accessToken=${customerToken}`])
      .send({ newPreference: 'TWICE_DAILY' });
    expect(res.status).toBe(403);
  });

  test('400 on invalid preference', async () => {
    findUser.mockResolvedValue({ id: 'u1', phoneEncrypted: encrypt('+250788000000') });
    const res = await request(app)
      .post('/api/payout/preference/request-otp')
      .set('Cookie', [`accessToken=${driverToken}`])
      .send({ newPreference: 'BOGUS' });
    expect(res.status).toBe(400);
  });

  test('happy path returns otpId + expiresAt', async () => {
    findUser.mockResolvedValue({ id: 'u1', phoneEncrypted: encrypt('+250788000000') });
    const expires = new Date(Date.now() + 600_000);
    sendOtpMock.mockResolvedValue({ otpId: 'otp-1', expiresAt: expires });
    const res = await request(app)
      .post('/api/payout/preference/request-otp')
      .set('Cookie', [`accessToken=${driverToken}`])
      .send({ newPreference: 'TWICE_DAILY' });
    expect(res.status).toBe(200);
    expect(res.body.otpId).toBe('otp-1');
    expect(res.body.expiresAt).toBe(expires.toISOString());
  });
});

describe('POST /api/payout/preference', () => {
  // MONEY-PIN G2 — this test asserted the OLD rule: a body without an
  // otpId was a 400 OTP_REQUIRED. That rule is exactly what ruling D25
  // reversed. An omitted otpId is now the NORMAL path — it selects the
  // PIN arm, and the PIN was already proven by the middleware before this
  // handler ran. Rewritten to state the new truth rather than deleted,
  // because "what happens when no otpId is sent" is still the question
  // worth pinning; only the answer changed.
  test('no otpId is no longer an error — it selects the PIN arm', async () => {
    applyMock.mockResolvedValue({ logId: 'log-1', immediatePayoutQueued: false });
    const res = await request(app)
      .post('/api/payout/preference')
      .set('Cookie', [`accessToken=${driverToken}`])
      .send({ newPreference: 'TWICE_DAILY' });
    expect(res.status).toBe(200);
    expect(applyMock.mock.calls[0][0].stepUp).toEqual({ kind: 'pin' });
  });

  test('happy path returns immediatePayoutQueued + queuedFor', async () => {
    const queued = new Date(Date.now() + 30 * 60_000);
    applyMock.mockResolvedValue({
      logId: 'log-1',
      immediatePayoutQueued: true,
      payoutDueAt: queued,
    });
    const res = await request(app)
      .post('/api/payout/preference')
      .set('Cookie', [`accessToken=${driverToken}`])
      .send({ newPreference: 'TWICE_DAILY', otpId: 'otp-1', code: '123456' });
    expect(res.status).toBe(200);
    expect(res.body.immediatePayoutQueued).toBe(true);
    expect(res.body.queuedFor).toBe(queued.toISOString());
  });

  test('surfaces 401 when applyPreferenceChange throws OTP_INVALID', async () => {
    const { AppError } = jest.requireActual('../middleware/error-handler');
    applyMock.mockRejectedValue(new AppError(401, 'OTP_INVALID', 'errors.otpInvalid'));
    const res = await request(app)
      .post('/api/payout/preference')
      .set('Cookie', [`accessToken=${driverToken}`])
      .send({ newPreference: 'TWICE_DAILY', otpId: 'otp-1', code: '999999' });
    expect(res.status).toBe(401);
  });
});

describe('POST /api/payout/end-shift', () => {
  test('401 unauthenticated', async () => {
    const res = await request(app).post('/api/payout/end-shift');
    expect(res.status).toBe(401);
  });

  test('400 when effective preference != AT_SHIFT_END', async () => {
    findUser.mockResolvedValue({
      id: 'u1',
      payoutPreference: 'DAILY_22H',
      completedShifts: 10,
    });
    const res = await request(app)
      .post('/api/payout/end-shift')
      .set('Cookie', [`accessToken=${driverToken}`]);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('NOT_SHIFT_END_MODE');
  });

  test('happy path fires SHIFT_END batch', async () => {
    findUser.mockResolvedValue({
      id: 'u1',
      payoutPreference: 'AT_SHIFT_END',
      completedShifts: 5,
    });
    fireMock.mockResolvedValue({ batchId: 'batch-1', amount: 5000 });
    const res = await request(app)
      .post('/api/payout/end-shift')
      .set('Cookie', [`accessToken=${driverToken}`]);
    expect(res.status).toBe(200);
    expect(res.body.batchId).toBe('batch-1');
    expect(res.body.amount).toBe(5000);
    expect(fireMock).toHaveBeenCalledWith('u1', 'SHIFT_END');
  });

  test('zero balance returns batchId=null amount=0', async () => {
    findUser.mockResolvedValue({
      id: 'u1',
      payoutPreference: 'AT_SHIFT_END',
      completedShifts: 5,
    });
    fireMock.mockResolvedValue({ batchId: null, amount: 0 });
    const res = await request(app)
      .post('/api/payout/end-shift')
      .set('Cookie', [`accessToken=${driverToken}`]);
    expect(res.status).toBe(200);
    expect(res.body.batchId).toBeNull();
    expect(res.body.amount).toBe(0);
    expect(res.body.expectedDeliveryAt).toBeNull();
  });

  // LAUNCH-TRUTH G5 — training wheels set the automatic schedule; they
  // must not remove the manual right. The gate is the STORED choice.
  test('training-wheels driver (<3 shifts, stored AT_SHIFT_END) keeps the manual right → 200', async () => {
    findUser.mockResolvedValue({
      id: 'u1',
      payoutPreference: 'AT_SHIFT_END',
      completedShifts: 1,
    });
    fireMock.mockResolvedValue({ batchId: 'batch-tw', amount: 3000 });
    const res = await request(app)
      .post('/api/payout/end-shift')
      .set('Cookie', [`accessToken=${driverToken}`]);
    expect(res.status).toBe(200);
    expect(res.body.batchId).toBe('batch-tw');
    expect(fireMock).toHaveBeenCalledWith('u1', 'SHIFT_END');
  });

  test('driver who deliberately chose TWICE_DAILY still gets NOT_SHIFT_END_MODE', async () => {
    findUser.mockResolvedValue({
      id: 'u1',
      payoutPreference: 'TWICE_DAILY',
      completedShifts: 1,
    });
    const res = await request(app)
      .post('/api/payout/end-shift')
      .set('Cookie', [`accessToken=${driverToken}`]);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('NOT_SHIFT_END_MODE');
    expect(fireMock).not.toHaveBeenCalled();
  });

  test('frozen training-wheels driver: freeze wins — the service guard fires no batch', async () => {
    findUser.mockResolvedValue({
      id: 'u1',
      payoutPreference: 'AT_SHIFT_END',
      completedShifts: 1,
      frozenAt: new Date('2026-07-01T10:00:00Z'),
    });
    // firePreferenceChangeBatch's own frozen-driver guard (tested in
    // payout-service tests) returns a null batch; the route passes the
    // refusal through rather than re-implementing the guard.
    fireMock.mockResolvedValue({ batchId: null, amount: 0 });
    const res = await request(app)
      .post('/api/payout/end-shift')
      .set('Cookie', [`accessToken=${driverToken}`]);
    expect(res.status).toBe(200);
    expect(res.body.batchId).toBeNull();
    expect(res.body.amount).toBe(0);
  });
});

describe('GET /api/payout/summary', () => {
  test('401 unauthenticated', async () => {
    const res = await request(app).get('/api/payout/summary');
    expect(res.status).toBe(401);
  });

  test('403 customer-only role', async () => {
    const res = await request(app)
      .get('/api/payout/summary')
      .set('Cookie', [`accessToken=${customerToken}`]);
    expect(res.status).toBe(403);
  });

  test('404 unknown user', async () => {
    findUser.mockResolvedValue(null);
    const res = await request(app)
      .get('/api/payout/summary')
      .set('Cookie', [`accessToken=${driverToken}`]);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('USER_NOT_FOUND');
  });

  test('shape: settled driver on AT_SHIFT_END, no schedule instant', async () => {
    findUser.mockResolvedValue({
      id: 'u1',
      payoutPreference: 'AT_SHIFT_END',
      completedShifts: 5,
      frozenAt: null,
    });
    findBalance.mockResolvedValue({ driverId: 'u1', pendingAmount: 12500 });
    const res = await request(app)
      .get('/api/payout/summary')
      .set('Cookie', [`accessToken=${driverToken}`]);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      pendingAmount: 12500,
      storedPreference: 'AT_SHIFT_END',
      effectivePreference: 'AT_SHIFT_END',
      trainingWheelsActive: false,
      completedShifts: 5,
      canEndShift: true,
      nextScheduledPayout: null,
      payoutsFrozen: false,
      feeWaiver: null,
    });
  });

  // LAUNCH-TRUTH G4 — the driver's own card must see the waiver and its
  // cliff in advance; the summary exposes the minimum shape and nothing
  // more (no admin, no reason, no campaign).
  test('lifetime fee waiver: feeWaiver { type, expiresAt: null }', async () => {
    findUser.mockResolvedValue({
      id: 'u1',
      payoutPreference: 'AT_SHIFT_END',
      completedShifts: 5,
      frozenAt: null,
    });
    findBalance.mockResolvedValue({ driverId: 'u1', pendingAmount: 1000 });
    ((prisma as any).feeWaiver.findFirst as jest.Mock).mockResolvedValue({
      id: 'fw-1',
      driverId: 'u1',
      type: 'LIFETIME',
      campaign: 'PRE_PROTOTYPE',
      grantedBy: 'admin-1',
      reason: 'internal-only',
      expiresAt: null,
      revokedAt: null,
    });
    const res = await request(app)
      .get('/api/payout/summary')
      .set('Cookie', [`accessToken=${driverToken}`]);
    expect(res.status).toBe(200);
    expect(res.body.feeWaiver).toEqual({ type: 'LIFETIME', expiresAt: null });
  });

  test('temporary fee waiver: expiresAt exposed (the cliff is visible in advance), internals are not', async () => {
    findUser.mockResolvedValue({
      id: 'u1',
      payoutPreference: 'AT_SHIFT_END',
      completedShifts: 5,
      frozenAt: null,
    });
    findBalance.mockResolvedValue({ driverId: 'u1', pendingAmount: 1000 });
    ((prisma as any).feeWaiver.findFirst as jest.Mock).mockResolvedValue({
      id: 'fw-2',
      driverId: 'u1',
      type: 'TEMPORARY',
      campaign: 'PILOT_500',
      grantedBy: 'admin-1',
      reason: 'internal-only',
      expiresAt: new Date('2027-01-13T00:00:00Z'),
      revokedAt: null,
    });
    const res = await request(app)
      .get('/api/payout/summary')
      .set('Cookie', [`accessToken=${driverToken}`]);
    expect(res.status).toBe(200);
    expect(res.body.feeWaiver).toEqual({
      type: 'TEMPORARY',
      expiresAt: '2027-01-13T00:00:00.000Z',
    });
    // Minimum shape only.
    expect(Object.keys(res.body.feeWaiver).sort()).toEqual(['expiresAt', 'type']);
  });

  test('frozen driver: payoutsFrozen true, no freeze detail fields leak', async () => {
    findUser.mockResolvedValue({
      id: 'u1',
      payoutPreference: 'AT_SHIFT_END',
      completedShifts: 5,
      frozenAt: new Date('2026-07-01T10:00:00Z'),
      frozenReason: 'internal-only',
      frozenBy: 'admin-1',
      frozenCategory: 'OTHER',
    });
    findBalance.mockResolvedValue({ driverId: 'u1', pendingAmount: 12500 });
    const res = await request(app)
      .get('/api/payout/summary')
      .set('Cookie', [`accessToken=${driverToken}`]);
    expect(res.status).toBe(200);
    expect(res.body.payoutsFrozen).toBe(true);
    expect(res.body).not.toHaveProperty('frozenReason');
    expect(res.body).not.toHaveProperty('frozenBy');
    expect(res.body).not.toHaveProperty('frozenCategory');
  });

  test('unfrozen driver: payoutsFrozen false', async () => {
    findUser.mockResolvedValue({
      id: 'u1',
      payoutPreference: 'TWICE_DAILY',
      completedShifts: 9,
      frozenAt: null,
    });
    findBalance.mockResolvedValue({ driverId: 'u1', pendingAmount: 100 });
    const res = await request(app)
      .get('/api/payout/summary')
      .set('Cookie', [`accessToken=${driverToken}`]);
    expect(res.status).toBe(200);
    expect(res.body.payoutsFrozen).toBe(false);
  });

  test('training wheels: new AT_SHIFT_END driver reads as TWICE_DAILY but keeps the manual right', async () => {
    findUser.mockResolvedValue({
      id: 'u1',
      payoutPreference: 'AT_SHIFT_END',
      completedShifts: 2,
    });
    findBalance.mockResolvedValue({ driverId: 'u1', pendingAmount: 3000 });
    const res = await request(app)
      .get('/api/payout/summary')
      .set('Cookie', [`accessToken=${driverToken}`]);
    expect(res.status).toBe(200);
    expect(res.body.storedPreference).toBe('AT_SHIFT_END');
    expect(res.body.effectivePreference).toBe('TWICE_DAILY');
    expect(res.body.trainingWheelsActive).toBe(true);
    // LAUNCH-TRUTH G5 — canEndShift follows the STORED choice: training
    // wheels set the automatic schedule, not the manual right.
    expect(res.body.canEndShift).toBe(true);
    expect(res.body.nextScheduledPayout).not.toBeNull();
  });

  test('driver who chose TWICE_DAILY: canEndShift stays false', async () => {
    findUser.mockResolvedValue({
      id: 'u1',
      payoutPreference: 'TWICE_DAILY',
      completedShifts: 2,
    });
    findBalance.mockResolvedValue({ driverId: 'u1', pendingAmount: 3000 });
    const res = await request(app)
      .get('/api/payout/summary')
      .set('Cookie', [`accessToken=${driverToken}`]);
    expect(res.status).toBe(200);
    expect(res.body.canEndShift).toBe(false);
  });

  test('no DriverBalance row reads as zero pending', async () => {
    findUser.mockResolvedValue({
      id: 'u1',
      payoutPreference: 'TWICE_DAILY',
      completedShifts: 0,
    });
    findBalance.mockResolvedValue(null);
    const res = await request(app)
      .get('/api/payout/summary')
      .set('Cookie', [`accessToken=${driverToken}`]);
    expect(res.status).toBe(200);
    expect(res.body.pendingAmount).toBe(0);
    expect(res.body.trainingWheelsActive).toBe(false);
  });

  test('TWICE_DAILY: next instant is the upcoming 06:00 or 18:00 Kigali (04:00/16:00 UTC)', async () => {
    findUser.mockResolvedValue({
      id: 'u1',
      payoutPreference: 'TWICE_DAILY',
      completedShifts: 9,
    });
    findBalance.mockResolvedValue({ driverId: 'u1', pendingAmount: 100 });
    const before = Date.now();
    const res = await request(app)
      .get('/api/payout/summary')
      .set('Cookie', [`accessToken=${driverToken}`]);
    expect(res.status).toBe(200);
    const next = new Date(res.body.nextScheduledPayout);
    expect(next.getTime()).toBeGreaterThan(before);
    expect(next.getTime() - before).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
    expect([4, 16]).toContain(next.getUTCHours());
    expect(next.getUTCMinutes()).toBe(0);
    expect(res.body.canEndShift).toBe(false);
  });

  test('DAILY_22H: next instant is the upcoming 22:00 Kigali (20:00 UTC)', async () => {
    findUser.mockResolvedValue({
      id: 'u1',
      payoutPreference: 'DAILY_22H',
      completedShifts: 9,
    });
    findBalance.mockResolvedValue({ driverId: 'u1', pendingAmount: 100 });
    const before = Date.now();
    const res = await request(app)
      .get('/api/payout/summary')
      .set('Cookie', [`accessToken=${driverToken}`]);
    expect(res.status).toBe(200);
    const next = new Date(res.body.nextScheduledPayout);
    expect(next.getTime()).toBeGreaterThan(before);
    expect(next.getTime() - before).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
    expect(next.getUTCHours()).toBe(20);
    expect(next.getUTCMinutes()).toBe(0);
    expect(res.body.canEndShift).toBe(false);
  });
});

// MONEY-PIN G2 — the gate, on the routes it actually guards.
//
// The census IS this list: the balance snapshot, both halves of the
// preference change, and the manual payout. If a route is added to this
// file without the gate, the "every money route is gated" test below
// starts failing, which is the point of writing it that way rather than
// as four separate assertions.
describe('the money-PIN gate', () => {
  const MONEY_ROUTES: Array<[string, string, Record<string, unknown>]> = [
    ['get', '/api/payout/summary', {}],
    ['post', '/api/payout/end-shift', {}],
    ['post', '/api/payout/preference', { newPreference: 'TWICE_DAILY' }],
    ['post', '/api/payout/preference/request-otp', { newPreference: 'TWICE_DAILY' }],
  ];

  test.each(MONEY_ROUTES)(
    '%s %s asks for the PIN when no session is open',
    async (method, path, body) => {
      _resetMoneyStepUpForTests();
      const req = (request(app) as any)[method](path).set('Cookie', [
        `accessToken=${driverToken}`,
      ]);
      const res = await (method === 'get' ? req : req.send(body));
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('MONEY_STEP_UP_REQUIRED');
    },
  );

  test.each(MONEY_ROUTES)(
    '%s %s asks for ENROLMENT when the driver has no PIN — the lazy block',
    async (method, path, body) => {
      _resetMoneyStepUpForTests();
      pinStatusMock.mockResolvedValue({ state: 'NOT_SET' });
      // CUTGUARD v2 G6 (B-3) — the enrollment prompt is scoped to clients
      // that HAVE an enrollment screen. A v13 build does not, so 428 shut
      // a motari out of his own earnings for the length of the rollout;
      // the header is what tells the two apart. The legacy arm is
      // asserted in cutguard-app-version-gates, along with the proof that
      // claiming to be legacy cannot skip a PIN that exists.
      const req = (request(app) as any)
        [method](path)
        .set('Cookie', [`accessToken=${driverToken}`])
        .set('X-App-Version', '14');
      const res = await (method === 'get' ? req : req.send(body));
      expect(res.status).toBe(428);
      expect(res.body.error.code).toBe('MONEY_PIN_ENROLLMENT_REQUIRED');
    },
  );

  test('a locked PIN answers 423 and says when it lifts', async () => {
    _resetMoneyStepUpForTests();
    const until = new Date(Date.now() + 900_000);
    pinStatusMock.mockResolvedValue({ state: 'SET', lockedUntil: until });
    const res = await request(app)
      .get('/api/payout/summary')
      .set('Cookie', [`accessToken=${driverToken}`]);
    expect(res.status).toBe(423);
    expect(res.body.lockedUntil).toBe(until.toISOString());
  });

  test('the gate runs BEFORE any handler work — no balance is read', async () => {
    _resetMoneyStepUpForTests();
    await request(app)
      .get('/api/payout/summary')
      .set('Cookie', [`accessToken=${driverToken}`]);
    // A refused request must not have touched the money it was refusing
    // to show.
    expect(findBalance).not.toHaveBeenCalled();
  });

  test('the preference change now goes through the PIN arm, not an OTP', async () => {
    applyMock.mockResolvedValue({ logId: 'l1', immediatePayoutQueued: false });
    await request(app)
      .post('/api/payout/preference')
      .set('Cookie', [`accessToken=${driverToken}`])
      .send({ newPreference: 'TWICE_DAILY' });
    expect(applyMock.mock.calls[0][0].stepUp).toEqual({ kind: 'pin' });
  });

  test('a caller that still sends an otpId gets the legacy OTP arm', async () => {
    applyMock.mockResolvedValue({ logId: 'l1', immediatePayoutQueued: false });
    await request(app)
      .post('/api/payout/preference')
      .set('Cookie', [`accessToken=${driverToken}`])
      .send({ newPreference: 'TWICE_DAILY', otpId: 'o1', code: '123456' });
    expect(applyMock.mock.calls[0][0].stepUp).toEqual({
      kind: 'otp',
      otpId: 'o1',
      code: '123456',
    });
  });
});
