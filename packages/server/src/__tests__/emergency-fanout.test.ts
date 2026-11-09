// SOS-WIRE G4 — POST /api/journeys/:id/emergency fan-out tests.
//
// Covers the founder-decided three-channel routing (admin socket, ops
// SMS, emergency-contact SMS) plus the life-safety semantics: the SMS
// storm guard, channel isolation (one failing channel never blocks the
// others), and the ownership gate.
//
// RED-BUTTON G2 gave the motari the same button, which replaced the
// customerOnly middleware with a journey-participant check. Every
// assertion below is deliberately UNCHANGED by that work: this file is
// the standing proof that the passenger's alert — route, gate,
// channels and response shape — still behaves exactly as the deployed
// APKs expect. (The "403 for driver role" case below now passes for a
// sharper reason: that driver is not a participant in this journey.)
// The motari's half of the symmetry is proven in
// emergency-driver-parity.test.ts.

jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    user: { findUnique: jest.fn() },
    syncEvent: { findFirst: jest.fn(), create: jest.fn() },
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
const JOURNEY_ID = 'j1';
const RIDER_PHONE = '+250788123456';
const OPS_PHONE = '+250788999999';
const CONTACTS = ['+250788111111', '+250788222222'];

const customerCookie = `accessToken=${generateAccessToken({ userId: CUSTOMER_ID, role: 'CUSTOMER' })}`;
const otherCustomerCookie = `accessToken=${generateAccessToken({ userId: 'c2', role: 'CUSTOMER' })}`;
const driverCookie = `accessToken=${generateAccessToken({ userId: 'd1', role: 'DRIVER' })}`;

function fireEmergency(cookie = customerCookie) {
  return request(app)
    .post(`/api/journeys/${JOURNEY_ID}/emergency`)
    .set('Cookie', cookie)
    .send({ lat: -1.95, lng: 30.06 });
}

beforeEach(() => {
  jest.clearAllMocks();
  (config as { EMERGENCY_OPS_PHONE: string }).EMERGENCY_OPS_PHONE = OPS_PHONE;
  (journeyService.getJourneyById as jest.Mock).mockResolvedValue({
    id: JOURNEY_ID,
    customerId: CUSTOMER_ID,
  });
  (prisma.user.findUnique as jest.Mock).mockResolvedValue({
    phoneEncrypted: encrypt(RIDER_PHONE),
    nickname: 'TestRider',
    emergencyContactsEncrypted: encrypt(JSON.stringify(CONTACTS)),
  });
  (prisma.syncEvent.findFirst as jest.Mock).mockResolvedValue(null);
  (prisma.syncEvent.create as jest.Mock).mockResolvedValue({ id: 'se1' });
  (sendSms as jest.Mock).mockResolvedValue({ success: true });
});

afterAll(() => {
  (config as { EMERGENCY_OPS_PHONE: string }).EMERGENCY_OPS_PHONE = '';
});

describe('auth gate (unchanged by SOS-WIRE)', () => {
  test('401 unauthenticated', async () => {
    const res = await request(app).post(`/api/journeys/${JOURNEY_ID}/emergency`);
    expect(res.status).toBe(401);
    expect(sendSms).not.toHaveBeenCalled();
  });

  test('403 for driver role', async () => {
    const res = await fireEmergency(driverCookie);
    expect(res.status).toBe(403);
    expect(sendSms).not.toHaveBeenCalled();
  });

  test("403 when caller is not the journey's customer", async () => {
    const res = await fireEmergency(otherCustomerCookie);
    expect(res.status).toBe(403);
    expect(sendSms).not.toHaveBeenCalled();
    expect(emitToAdmins).not.toHaveBeenCalled();
  });
});

describe('three-channel fan-out', () => {
  test('records + emits journey room + emits admins + ops SMS + contact SMS', async () => {
    const res = await fireEmergency();
    expect(res.status).toBe(200);

    // Recorded as the EMERGENCY_ALERT ledger entry.
    expect(prisma.syncEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          journeyId: JOURNEY_ID,
          userId: CUSTOMER_ID,
          eventType: 'EMERGENCY_ALERT',
        }),
      }),
    );

    // Channel 1 — journey room, under the unified constant.
    expect(emitToJourney).toHaveBeenCalledWith(
      JOURNEY_ID,
      SOCKET_EVENTS.EMERGENCY_ALERT,
      expect.objectContaining({ journeyId: JOURNEY_ID, userId: CUSTOMER_ID }),
    );

    // Channel 2 — admins room, carrying the decrypted rider phone.
    expect(emitToAdmins).toHaveBeenCalledWith(
      SOCKET_EVENTS.EMERGENCY_ALERT,
      expect.objectContaining({
        journeyId: JOURNEY_ID,
        riderPhone: RIDER_PHONE,
        riderNickname: 'TestRider',
      }),
    );

    // Channels 3+4 — ops SMS then one SMS per parsed contact.
    expect(sendSms).toHaveBeenCalledTimes(3);
    const smsCalls = (sendSms as jest.Mock).mock.calls;
    expect(smsCalls[0][0]).toBe(OPS_PHONE);
    expect(smsCalls[0][1]).toContain(JOURNEY_ID);
    expect(smsCalls[0][1]).toContain(RIDER_PHONE);
    expect(smsCalls.slice(1).map((c) => c[0])).toEqual(CONTACTS);
    expect(smsCalls[1][1]).toContain(JOURNEY_ID);

    expect(res.body).toMatchObject({
      success: true,
      recorded: true,
      smsSuppressed: false,
      channels: {
        journeyRoom: true,
        adminAlert: true,
        opsSms: 'sent',
        contactSms: { total: 2, sent: 2, failed: 0 },
      },
    });
  });

  test('journey-room payload never carries the rider phone', async () => {
    await fireEmergency();
    const payload = (emitToJourney as jest.Mock).mock.calls[0][2];
    expect(payload).not.toHaveProperty('riderPhone');
    expect(payload).not.toHaveProperty('riderNickname');
  });

  test('EMERGENCY_OPS_PHONE unset → ops channel skipped with warning, contacts still SMSed', async () => {
    (config as { EMERGENCY_OPS_PHONE: string }).EMERGENCY_OPS_PHONE = '';
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await fireEmergency();

    expect(res.status).toBe(200);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('EMERGENCY_OPS_PHONE'),
    );
    warnSpy.mockRestore();
    expect(sendSms).toHaveBeenCalledTimes(2);
    expect((sendSms as jest.Mock).mock.calls.map((c) => c[0])).toEqual(CONTACTS);
    expect(res.body.channels.opsSms).toBe('skipped-unset');
  });

  test('rider with no stored contacts → no contact SMS, no error', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      phoneEncrypted: encrypt(RIDER_PHONE),
      nickname: 'TestRider',
      emergencyContactsEncrypted: null,
    });
    const res = await fireEmergency();
    expect(res.status).toBe(200);
    expect(sendSms).toHaveBeenCalledTimes(1); // ops only
    expect(res.body.channels.contactSms).toEqual({ total: 0, sent: 0, failed: 0 });
  });

  test('legacy plain-JSON contacts still parse', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      phoneEncrypted: encrypt(RIDER_PHONE),
      nickname: 'TestRider',
      emergencyContactsEncrypted: JSON.stringify(['+250788333333']),
    });
    const res = await fireEmergency();
    expect(res.status).toBe(200);
    expect(sendSms).toHaveBeenCalledTimes(2);
    expect((sendSms as jest.Mock).mock.calls[1][0]).toBe('+250788333333');
  });
});

describe('SMS storm guard', () => {
  test('recent EMERGENCY_ALERT record suppresses ALL SMS but still re-emits sockets', async () => {
    (prisma.syncEvent.findFirst as jest.Mock).mockResolvedValue({
      id: 'prev',
      serverTimestamp: new Date(),
    });
    const res = await fireEmergency();

    expect(res.status).toBe(200);
    expect(sendSms).not.toHaveBeenCalled();
    expect(emitToJourney).toHaveBeenCalled();
    expect(emitToAdmins).toHaveBeenCalled();
    expect(res.body.smsSuppressed).toBe(true);
    expect(res.body.channels.opsSms).toBe('suppressed');
    expect(res.body.channels.contactSms).toEqual({ total: 2, sent: 0, failed: 0 });
  });

  test('guard queries the configured window for this journey', async () => {
    await fireEmergency();
    expect(prisma.syncEvent.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          journeyId: JOURNEY_ID,
          eventType: 'EMERGENCY_ALERT',
        }),
      }),
    );
  });
});

describe('channel isolation', () => {
  test('ops SMS failure does not block contact SMS; response reports it', async () => {
    (sendSms as jest.Mock).mockImplementation(async (phone: string) => {
      if (phone === OPS_PHONE) throw new Error('gateway down');
      return { success: true };
    });
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await fireEmergency();
    errSpy.mockRestore();

    expect(res.status).toBe(200);
    expect(res.body.channels.opsSms).toBe('failed');
    expect(res.body.channels.contactSms).toEqual({ total: 2, sent: 2, failed: 0 });
  });

  test('one contact failing does not block the other', async () => {
    (sendSms as jest.Mock).mockImplementation(async (phone: string) => {
      if (phone === CONTACTS[0]) throw new Error('bad number');
      return { success: true };
    });
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await fireEmergency();
    errSpy.mockRestore();

    expect(res.status).toBe(200);
    expect(res.body.channels.opsSms).toBe('sent');
    expect(res.body.channels.contactSms).toEqual({ total: 2, sent: 1, failed: 1 });
  });

  test('record failure does not block any emit or SMS channel', async () => {
    (prisma.syncEvent.create as jest.Mock).mockRejectedValue(new Error('db down'));
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await fireEmergency();
    errSpy.mockRestore();

    expect(res.status).toBe(200);
    expect(res.body.recorded).toBe(false);
    expect(emitToJourney).toHaveBeenCalled();
    expect(emitToAdmins).toHaveBeenCalled();
    expect(sendSms).toHaveBeenCalledTimes(3);
  });
});
