// SOS-FOLLOW G2 — the press opens a STATE, not only an event.
//
// The three suites that already exist for this endpoint
// (emergency-fanout, emergency-driver-parity, emergency-parcel-wording)
// are the standing proof that the fan-out is byte-identical: they were
// not touched by this work and they still pass. This file proves the
// half those files deliberately say nothing about — the EmergencyAlert
// row, its one-ACTIVE-per-journey rule, the press coordinates it
// carries, and the additive alertId that lets a phone know its own
// emergency is live.
//
// The interesting negative is the last describe block: the state row is
// individually try/caught like every other channel in this handler, so a
// database that cannot open it must still ring every phone the alert was
// going to ring. That is not a defensive nicety — it is the reason the
// three untouched suites above, whose prisma mock predates this table,
// keep passing.

jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    user: { findUnique: jest.fn() },
    syncEvent: { findFirst: jest.fn(), create: jest.fn() },
    emergencyAlert: { findFirst: jest.fn(), create: jest.fn() },
  },
}));

jest.mock('../services/journey.service', () => ({
  getJourneyById: jest.fn(),
}));

jest.mock('../socket', () => ({
  emitToJourney: jest.fn(),
  emitToAdmins: jest.fn(),
  getIO: () => null,
}));

jest.mock('../services/sms.service', () => ({
  sendSms: jest.fn(),
}));

import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { SOCKET_EVENTS } from '@bimoto/shared';
import prisma from '../prisma';
import journeyRoutes from '../routes/journey.routes';
import * as journeyService from '../services/journey.service';
import { emitToJourney, emitToAdmins } from '../socket';
import { sendSms } from '../services/sms.service';
import { encrypt } from '../utils/crypto';
import { config } from '../config';
import { errorHandler } from '../middleware/error-handler';
import { generateAccessToken } from '../utils/jwt';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/journeys', journeyRoutes);
app.use(errorHandler);

const CUSTOMER_ID = 'c1';
const DRIVER_ID = 'd1';
const JOURNEY_ID = 'j1';
const ALERT_ID = 'alert-1';

const customerCookie = `accessToken=${generateAccessToken({ userId: CUSTOMER_ID, role: 'CUSTOMER' })}`;
const driverCookie = `accessToken=${generateAccessToken({ userId: DRIVER_ID, role: 'DRIVER' })}`;
const outsiderCookie = `accessToken=${generateAccessToken({ userId: 'nobody', role: 'CUSTOMER' })}`;

function press(cookie = customerCookie, body: Record<string, unknown> = {}) {
  return request(app)
    .post(`/api/journeys/${JOURNEY_ID}/emergency`)
    .set('Cookie', cookie)
    .send(body);
}

beforeEach(() => {
  jest.clearAllMocks();
  (config as { EMERGENCY_OPS_PHONE: string }).EMERGENCY_OPS_PHONE = '+250788999999';
  (journeyService.getJourneyById as jest.Mock).mockResolvedValue({
    id: JOURNEY_ID,
    customerId: CUSTOMER_ID,
    driverId: DRIVER_ID,
  });
  (prisma.user.findUnique as jest.Mock).mockResolvedValue({
    phoneEncrypted: encrypt('+250788123456'),
    nickname: 'TestPerson',
    emergencyContactsEncrypted: encrypt(JSON.stringify([])),
    driverProfile: { registrationPlate: 'RAB 123 A', lastLat: null, lastLng: null },
  });
  (prisma.syncEvent.findFirst as jest.Mock).mockResolvedValue(null);
  (prisma.syncEvent.create as jest.Mock).mockResolvedValue({ id: 'se1' });
  (prisma.emergencyAlert.findFirst as jest.Mock).mockResolvedValue(null);
  (prisma.emergencyAlert.create as jest.Mock).mockResolvedValue({ id: ALERT_ID });
  (sendSms as jest.Mock).mockResolvedValue({ success: true });
});

afterAll(() => {
  (config as { EMERGENCY_OPS_PHONE: string }).EMERGENCY_OPS_PHONE = '';
});

describe('the row the press opens', () => {
  test('a first press creates an ACTIVE row naming the role and the press coords', async () => {
    const res = await press(customerCookie, { lat: -1.95, lng: 30.06 });

    expect(res.status).toBe(200);
    expect(prisma.emergencyAlert.create).toHaveBeenCalledTimes(1);
    expect((prisma.emergencyAlert.create as jest.Mock).mock.calls[0][0].data).toEqual({
      journeyId: JOURNEY_ID,
      raisedById: CUSTOMER_ID,
      raisedByRole: 'CUSTOMER',
      pressLat: -1.95,
      pressLng: 30.06,
    });
  });

  test("a motari's press names HIM, not the journey's customer", async () => {
    await press(driverCookie, { lat: -1.94, lng: 30.05 });

    expect((prisma.emergencyAlert.create as jest.Mock).mock.calls[0][0].data).toMatchObject({
      raisedById: DRIVER_ID,
      raisedByRole: 'DRIVER',
    });
  });

  test('a press with no position still opens the row — nulls, not a refusal', async () => {
    const res = await press(customerCookie, {});

    expect(res.status).toBe(200);
    expect((prisma.emergencyAlert.create as jest.Mock).mock.calls[0][0].data).toMatchObject({
      pressLat: null,
      pressLng: null,
    });
  });

  test('the row is looked up as ACTIVE-for-this-journey', async () => {
    await press();
    expect((prisma.emergencyAlert.findFirst as jest.Mock).mock.calls[0][0]).toEqual({
      where: { journeyId: JOURNEY_ID, status: 'ACTIVE' },
    });
  });
});

describe('one ACTIVE row per journey', () => {
  test('a repeated press reuses the ACTIVE row and creates nothing', async () => {
    (prisma.emergencyAlert.findFirst as jest.Mock).mockResolvedValue({ id: ALERT_ID });

    const res = await press();

    expect(res.status).toBe(200);
    expect(prisma.emergencyAlert.create).not.toHaveBeenCalled();
    expect(res.body.alertId).toBe(ALERT_ID);
  });

  test('the repeated press still re-records and still re-emits — the alarm is unchanged', async () => {
    (prisma.emergencyAlert.findFirst as jest.Mock).mockResolvedValue({ id: ALERT_ID });

    await press();

    expect(prisma.syncEvent.create).toHaveBeenCalledTimes(1);
    expect(emitToJourney).toHaveBeenCalledTimes(1);
    expect(emitToAdmins).toHaveBeenCalledTimes(1);
  });

  test('the storm guard is untouched: a recent SyncEvent still suppresses SMS', async () => {
    (prisma.syncEvent.findFirst as jest.Mock).mockResolvedValue({ id: 'recent' });
    (prisma.emergencyAlert.findFirst as jest.Mock).mockResolvedValue({ id: ALERT_ID });

    const res = await press();

    expect(res.body.smsSuppressed).toBe(true);
    expect(sendSms).not.toHaveBeenCalled();
  });
});

describe('alertId travels, additively', () => {
  test('the response carries it beside every field it always carried', async () => {
    const res = await press();

    expect(res.body).toMatchObject({
      success: true,
      message: 'Emergency alert sent',
      alertId: ALERT_ID,
      recorded: true,
      smsSuppressed: false,
    });
    expect(res.body.channels).toBeDefined();
  });

  test('both rooms hear it — and the journey room still carries no phone number', async () => {
    await press(customerCookie, { lat: -1.95, lng: 30.06 });

    const [, jEvent, jPayload] = (emitToJourney as jest.Mock).mock.calls[0];
    expect(jEvent).toBe(SOCKET_EVENTS.EMERGENCY_ALERT);
    expect(jPayload.alertId).toBe(ALERT_ID);
    expect(jPayload).not.toHaveProperty('riderPhone');
    expect(jPayload).not.toHaveProperty('driverPhone');

    const [aEvent, aPayload] = (emitToAdmins as jest.Mock).mock.calls[0];
    expect(aEvent).toBe(SOCKET_EVENTS.EMERGENCY_ALERT);
    expect(aPayload.alertId).toBe(ALERT_ID);
  });
});

describe('the state row can fail without costing the alarm', () => {
  test('a dead emergencyAlert table still fans out all four channels', async () => {
    (prisma.emergencyAlert.findFirst as jest.Mock).mockRejectedValue(new Error('relation does not exist'));

    const res = await press();

    expect(res.status).toBe(200);
    expect(res.body.alertId).toBeUndefined();
    expect(res.body.recorded).toBe(true);
    expect(res.body.channels.journeyRoom).toBe(true);
    expect(res.body.channels.adminAlert).toBe(true);
    expect(res.body.channels.opsSms).toBe('sent');
  });
});

describe('the gate is unchanged', () => {
  test('an outsider gets 403 and no row is opened', async () => {
    const res = await press(outsiderCookie);

    expect(res.status).toBe(403);
    expect(prisma.emergencyAlert.create).not.toHaveBeenCalled();
    expect(emitToAdmins).not.toHaveBeenCalled();
  });
});

describe('GET /:id/emergency/active — the remount truth', () => {
  test('a participant is told which alert is live', async () => {
    (prisma.emergencyAlert.findFirst as jest.Mock).mockResolvedValue({
      id: ALERT_ID,
      journeyId: JOURNEY_ID,
      raisedByRole: 'DRIVER',
      createdAt: new Date('2026-08-19T10:00:00.000Z'),
    });

    const res = await request(app)
      .get(`/api/journeys/${JOURNEY_ID}/emergency/active`)
      .set('Cookie', customerCookie);

    expect(res.status).toBe(200);
    expect(res.body.alert).toMatchObject({ id: ALERT_ID, raisedByRole: 'DRIVER' });
  });

  test('no ACTIVE alert answers null, not 404', async () => {
    const res = await request(app)
      .get(`/api/journeys/${JOURNEY_ID}/emergency/active`)
      .set('Cookie', driverCookie);

    expect(res.status).toBe(200);
    expect(res.body.alert).toBeNull();
  });

  test('an outsider gets the same 403 the press gives them', async () => {
    const res = await request(app)
      .get(`/api/journeys/${JOURNEY_ID}/emergency/active`)
      .set('Cookie', outsiderCookie);

    expect(res.status).toBe(403);
    expect(prisma.emergencyAlert.findFirst).not.toHaveBeenCalled();
  });

  test('it answers with the alert only — no positions, no phone numbers', async () => {
    await request(app)
      .get(`/api/journeys/${JOURNEY_ID}/emergency/active`)
      .set('Cookie', customerCookie);

    expect((prisma.emergencyAlert.findFirst as jest.Mock).mock.calls[0][0].select).toEqual({
      id: true,
      journeyId: true,
      raisedByRole: true,
      createdAt: true,
    });
  });
});
