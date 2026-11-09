// RED-BUTTON G2 — the motari's red button, and the guarantee that the
// two directions never cross.
//
// The passenger's fan-out is proven byte-for-byte by emergency-fanout
// (untouched). This file proves the other half of the symmetry:
//
//   * participation, not role, is the gate;
//   * the contact SMS goes to the CALLER's own people, in both
//     directions, and never to the counterpart's;
//   * the alert names the counterpart, so ops learns who the other
//     party on the ride is;
//   * the storm guard is scoped per caller, so one participant's alert
//     cannot silence the other's.

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
const DRIVER_ID = 'd1';
const JOURNEY_ID = 'j1';

const RIDER_PHONE = '+250788123456';
const DRIVER_PHONE = '+250788654321';
const OPS_PHONE = '+250788999999';
const PLATE = 'RAB 123 X';

const RIDER_CONTACTS = ['+250788111111', '+250788222222'];
const DRIVER_CONTACTS = ['+250788333333'];

const customerCookie = `accessToken=${generateAccessToken({ userId: CUSTOMER_ID, role: 'CUSTOMER' })}`;
const driverCookie = `accessToken=${generateAccessToken({ userId: DRIVER_ID, role: 'DRIVER' })}`;
const outsiderCookie = `accessToken=${generateAccessToken({ userId: 'x9', role: 'CUSTOMER' })}`;
const outsiderDriverCookie = `accessToken=${generateAccessToken({ userId: 'x8', role: 'DRIVER' })}`;

function fireEmergency(cookie: string) {
  return request(app)
    .post(`/api/journeys/${JOURNEY_ID}/emergency`)
    .set('Cookie', cookie)
    .send({ lat: -1.95, lng: 30.06 });
}

/** A matched journey: both participants present. */
function matchedJourney() {
  (journeyService.getJourneyById as jest.Mock).mockResolvedValue({
    id: JOURNEY_ID,
    customerId: CUSTOMER_ID,
    driverId: DRIVER_ID,
    pickupName: 'Sonatubes',
    destinationName: 'Giporoso',
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (config as { EMERGENCY_OPS_PHONE: string }).EMERGENCY_OPS_PHONE = OPS_PHONE;
  matchedJourney();

  // Two distinct people with two distinct contact lists — the whole
  // point of the negative assertions below.
  (prisma.user.findUnique as jest.Mock).mockImplementation(
    async ({ where }: { where: { id: string } }) => {
      if (where.id === CUSTOMER_ID) {
        return {
          phoneEncrypted: encrypt(RIDER_PHONE),
          nickname: 'TestRider',
          emergencyContactsEncrypted: encrypt(JSON.stringify(RIDER_CONTACTS)),
        };
      }
      if (where.id === DRIVER_ID) {
        return {
          phoneEncrypted: encrypt(DRIVER_PHONE),
          nickname: 'TestMotari',
          emergencyContactsEncrypted: encrypt(JSON.stringify(DRIVER_CONTACTS)),
          driverProfile: { registrationPlate: PLATE, lastLat: -1.94, lastLng: 30.05 },
        };
      }
      return null;
    },
  );
  (prisma.syncEvent.findFirst as jest.Mock).mockResolvedValue(null);
  (prisma.syncEvent.create as jest.Mock).mockResolvedValue({ id: 'se1' });
  (sendSms as jest.Mock).mockResolvedValue({ success: true });
});

afterAll(() => {
  (config as { EMERGENCY_OPS_PHONE: string }).EMERGENCY_OPS_PHONE = '';
});

describe('participant gate (replaces customerOnly)', () => {
  test('the matched driver may fire — the button is his too', async () => {
    const res = await fireEmergency(driverCookie);
    expect(res.status).toBe(200);
  });

  test('a customer who is not this journey\'s customer → 403, nothing fanned out', async () => {
    const res = await fireEmergency(outsiderCookie);
    expect(res.status).toBe(403);
    expect(res.body.error.message).toBe('errors.notJourneyParticipant');
    expect(sendSms).not.toHaveBeenCalled();
    expect(emitToAdmins).not.toHaveBeenCalled();
    expect(emitToJourney).not.toHaveBeenCalled();
  });

  test('a driver who is not THIS journey\'s driver → 403', async () => {
    const res = await fireEmergency(outsiderDriverCookie);
    expect(res.status).toBe(403);
    expect(sendSms).not.toHaveBeenCalled();
  });

  test('unmatched journey → the driver caller is not a participant yet → 403', async () => {
    (journeyService.getJourneyById as jest.Mock).mockResolvedValue({
      id: JOURNEY_ID,
      customerId: CUSTOMER_ID,
      driverId: null,
    });
    const res = await fireEmergency(driverCookie);
    expect(res.status).toBe(403);
    expect(sendSms).not.toHaveBeenCalled();
    expect(emitToAdmins).not.toHaveBeenCalled();
  });
});

describe('the contacts texted are the CALLER\'s own', () => {
  test("passenger fires → only the passenger's contacts", async () => {
    const res = await fireEmergency(customerCookie);
    expect(res.status).toBe(200);

    const recipients = (sendSms as jest.Mock).mock.calls.map((c) => c[0]);
    expect(recipients.slice(1)).toEqual(RIDER_CONTACTS);
    expect(res.body.channels.contactSms).toEqual({ total: 2, sent: 2, failed: 0 });

    // The negative, stated outright: the motari's family is not told.
    for (const contact of DRIVER_CONTACTS) {
      expect(recipients).not.toContain(contact);
    }
  });

  test("driver fires → only the driver's contacts", async () => {
    const res = await fireEmergency(driverCookie);
    expect(res.status).toBe(200);

    const recipients = (sendSms as jest.Mock).mock.calls.map((c) => c[0]);
    expect(recipients.slice(1)).toEqual(DRIVER_CONTACTS);
    expect(res.body.channels.contactSms).toEqual({ total: 1, sent: 1, failed: 0 });

    // The mirror negative: the passenger's family is not told.
    for (const contact of RIDER_CONTACTS) {
      expect(recipients).not.toContain(contact);
    }
  });
});

describe('the alert names the counterpart', () => {
  test("passenger's alert carries the motari's identity and plate", async () => {
    await fireEmergency(customerCookie);
    const [opsTo, opsBody] = (sendSms as jest.Mock).mock.calls[0];
    expect(opsTo).toBe(OPS_PHONE);
    expect(opsBody).toContain(RIDER_PHONE);
    expect(opsBody).toContain('TestMotari');
    expect(opsBody).toContain(PLATE);

    const contactBody = (sendSms as jest.Mock).mock.calls[1][1];
    expect(contactBody).toContain('TestRider');
    expect(contactBody).toContain('TestMotari');
    expect(contactBody).toContain(PLATE);
  });

  test("motari's alert carries the passenger's identity, phone and the route", async () => {
    await fireEmergency(driverCookie);
    const opsBody = (sendSms as jest.Mock).mock.calls[0][1];
    expect(opsBody).toContain('Motari needs help');
    expect(opsBody).toContain(DRIVER_PHONE);
    expect(opsBody).toContain(PLATE);
    expect(opsBody).toContain('TestRider');
    expect(opsBody).toContain(RIDER_PHONE);
    expect(opsBody).toContain('Sonatubes');
    expect(opsBody).toContain(JOURNEY_ID);

    // His own family is told who he is carrying, by name — not by
    // number: a stranger's phone does not go to private handsets.
    const contactBody = (sendSms as jest.Mock).mock.calls[1][1];
    expect(contactBody).toContain('TestMotari');
    expect(contactBody).toContain('TestRider');
    expect(contactBody).not.toContain(RIDER_PHONE);
  });

  test("a motari's alert falls back to his last known GPS when the phone sent none", async () => {
    await request(app)
      .post(`/api/journeys/${JOURNEY_ID}/emergency`)
      .set('Cookie', driverCookie)
      .send({});

    const opsBody = (sendSms as jest.Mock).mock.calls[0][1];
    expect(opsBody).toContain('-1.94');
    expect(opsBody).toContain('30.05');
  });
});

describe('both directions reach ops and the admin shell', () => {
  test.each([
    ['passenger', customerCookie, 'CUSTOMER'],
    ['motari', driverCookie, 'DRIVER'],
  ])('%s alert lands in the admins room tagged raisedBy', async (_who, cookie, raisedBy) => {
    await fireEmergency(cookie);

    expect(emitToAdmins).toHaveBeenCalledWith(
      SOCKET_EVENTS.EMERGENCY_ALERT,
      expect.objectContaining({
        journeyId: JOURNEY_ID,
        raisedBy,
        // rider* stays the PASSENGER in both directions, so the admin
        // banner needs no change; the counterpart arrives alongside.
        riderPhone: RIDER_PHONE,
        riderNickname: 'TestRider',
        driverNickname: 'TestMotari',
        driverPlate: PLATE,
      }),
    );

    // The counterpart-visible journey-room emit stays for both, and
    // still carries no phone number.
    const roomPayload = (emitToJourney as jest.Mock).mock.calls[0][2];
    expect(roomPayload).toMatchObject({ journeyId: JOURNEY_ID, raisedBy });
    expect(roomPayload).not.toHaveProperty('riderPhone');
    expect(roomPayload).not.toHaveProperty('driverPhone');
  });

  test('the ops phone is called for both directions', async () => {
    await fireEmergency(customerCookie);
    expect((sendSms as jest.Mock).mock.calls[0][0]).toBe(OPS_PHONE);

    jest.clearAllMocks();
    (sendSms as jest.Mock).mockResolvedValue({ success: true });
    (prisma.syncEvent.findFirst as jest.Mock).mockResolvedValue(null);
    await fireEmergency(driverCookie);
    expect((sendSms as jest.Mock).mock.calls[0][0]).toBe(OPS_PHONE);
  });
});

describe('storm guard is scoped to the caller', () => {
  test('the guard query names the journey, the event type AND the caller', async () => {
    await fireEmergency(driverCookie);
    expect(prisma.syncEvent.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          journeyId: JOURNEY_ID,
          eventType: 'EMERGENCY_ALERT',
          userId: DRIVER_ID,
        }),
      }),
    );
  });

  test('the ledger row records the CALLER, which is what the guard keys on', async () => {
    await fireEmergency(driverCookie);
    expect(prisma.syncEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          journeyId: JOURNEY_ID,
          userId: DRIVER_ID,
          eventType: 'EMERGENCY_ALERT',
        }),
      }),
    );
  });

  test("a passenger's recent alert does NOT suppress the motari's SMS", async () => {
    // The ledger holds a passenger alert from a minute ago...
    (prisma.syncEvent.findFirst as jest.Mock).mockImplementation(
      async ({ where }: { where: { userId: string } }) =>
        where.userId === CUSTOMER_ID ? { id: 'prev', serverTimestamp: new Date() } : null,
    );

    // ...the passenger pressing again is suppressed, as before.
    const riderRes = await fireEmergency(customerCookie);
    expect(riderRes.body.smsSuppressed).toBe(true);
    expect(sendSms).not.toHaveBeenCalled();

    // ...but his motari's own alert still goes out. This is the whole
    // reason the guard grew a caller dimension.
    const driverRes = await fireEmergency(driverCookie);
    expect(driverRes.body.smsSuppressed).toBe(false);
    const recipients = (sendSms as jest.Mock).mock.calls.map((c) => c[0]);
    expect(recipients).toEqual([OPS_PHONE, ...DRIVER_CONTACTS]);
  });

  test('the guard still suppresses only SMS — sockets always re-emit', async () => {
    (prisma.syncEvent.findFirst as jest.Mock).mockResolvedValue({
      id: 'prev',
      serverTimestamp: new Date(),
    });
    const res = await fireEmergency(driverCookie);

    expect(res.status).toBe(200);
    expect(sendSms).not.toHaveBeenCalled();
    expect(emitToJourney).toHaveBeenCalled();
    expect(emitToAdmins).toHaveBeenCalled();
    expect(res.body.smsSuppressed).toBe(true);
  });
});

describe('deployed-APK compatibility', () => {
  test('the passenger success shape is exactly the keys the shipped client reads', async () => {
    const res = await fireEmergency(customerCookie);

    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(
      ['channels', 'message', 'recorded', 'smsSuppressed', 'success'].sort(),
    );
    expect(Object.keys(res.body.channels).sort()).toEqual(
      ['adminAlert', 'contactSms', 'journeyRoom', 'opsSms'].sort(),
    );
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Emergency alert sent');
  });

  test('the motari gets the same success shape', async () => {
    const res = await fireEmergency(driverCookie);
    expect(Object.keys(res.body).sort()).toEqual(
      ['channels', 'message', 'recorded', 'smsSuppressed', 'success'].sort(),
    );
  });
});
