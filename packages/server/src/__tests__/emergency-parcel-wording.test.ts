// LOOSE-ENDS G3 — the emergency system tells the truth about parcels.
//
// #167 gave the alert a `raisedBy`, which fixed WHO pressed the button.
// Nothing said WHAT KIND of journey it was, so every channel described
// every alert as a ride: a parcel sender's mother was told her son was
// riding somewhere, and a motari's family was told he was carrying a
// passenger who does not exist.
//
// Two things are proved here, and they are separable:
//
//   1. journey kind — both journey types × both roles × all three
//      channels (journey-room emit, admins emit, SMS bodies). The
//      branch is `type !== 'PASSENGER'`, so URGENT_MESSENGER and
//      PRIORITY_MESSENGER are covered alongside GOODS: branching on
//      GOODS alone would leave an urgent parcel saying "ride".
//
//   2. the banned word — TRUE-WORDS retired "rider" in favour of
//      "passenger" and swept the client locales, but these SMS bodies
//      are hardcoded server-side and were outside that sweep. No
//      emergency SMS may contain "rider" in any casing, on any journey
//      type, in either direction.
//
// The passenger-journey MECHANICS are untouched and stay proved by
// emergency-fanout / emergency-driver-parity, which are green
// unmodified. This file is additive on top of their contract.

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

const SENDER_PHONE = '+250788123456';
const DRIVER_PHONE = '+250788654321';
const OPS_PHONE = '+250788999999';
const PLATE = 'RAB 123 X';

const SENDER_CONTACTS = ['+250788111111'];
const DRIVER_CONTACTS = ['+250788333333'];

const customerCookie = `accessToken=${generateAccessToken({ userId: CUSTOMER_ID, role: 'CUSTOMER' })}`;
const driverCookie = `accessToken=${generateAccessToken({ userId: DRIVER_ID, role: 'DRIVER' })}`;

/** All three parcel members of JourneyType, plus the ride for contrast. */
const PARCEL_TYPES = ['GOODS', 'PRIORITY_MESSENGER', 'URGENT_MESSENGER'] as const;

function journeyOfType(type?: string) {
  (journeyService.getJourneyById as jest.Mock).mockResolvedValue({
    id: JOURNEY_ID,
    customerId: CUSTOMER_ID,
    driverId: DRIVER_ID,
    pickupName: 'Sonatubes',
    destinationName: 'Giporoso',
    ...(type === undefined ? {} : { type }),
  });
}

function fire(cookie: string) {
  return request(app)
    .post(`/api/journeys/${JOURNEY_ID}/emergency`)
    .set('Cookie', cookie)
    .send({ lat: -1.95, lng: 30.06 });
}

const opsBody = () => (sendSms as jest.Mock).mock.calls[0][1] as string;
const contactBody = () => (sendSms as jest.Mock).mock.calls[1][1] as string;

beforeEach(() => {
  jest.clearAllMocks();
  (config as { EMERGENCY_OPS_PHONE: string }).EMERGENCY_OPS_PHONE = OPS_PHONE;
  journeyOfType('GOODS');
  (prisma.user.findUnique as jest.Mock).mockImplementation(
    async ({ where }: { where: { id: string } }) => {
      if (where.id === CUSTOMER_ID) {
        return {
          phoneEncrypted: encrypt(SENDER_PHONE),
          nickname: 'TestSender',
          emergencyContactsEncrypted: encrypt(JSON.stringify(SENDER_CONTACTS)),
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

describe('channel 1+2 — the journey type rides on both emits', () => {
  test.each(PARCEL_TYPES)('%s reaches the journey room and the admins room', async (type) => {
    journeyOfType(type);
    await fire(customerCookie);

    const roomPayload = (emitToJourney as jest.Mock).mock.calls[0][2];
    expect(roomPayload).toMatchObject({ journeyId: JOURNEY_ID, journeyType: type });
    // Still no phone number in the room, on any journey type.
    expect(roomPayload).not.toHaveProperty('riderPhone');
    expect(roomPayload).not.toHaveProperty('driverPhone');

    expect(emitToAdmins).toHaveBeenCalledWith(
      SOCKET_EVENTS.EMERGENCY_ALERT,
      expect.objectContaining({ journeyId: JOURNEY_ID, journeyType: type, raisedBy: 'CUSTOMER' }),
    );
  });

  test('a PASSENGER journey carries PASSENGER, not silence', async () => {
    journeyOfType('PASSENGER');
    await fire(driverCookie);
    expect((emitToJourney as jest.Mock).mock.calls[0][2]).toMatchObject({
      journeyType: 'PASSENGER',
    });
  });

  test('a journey row with no type at all emits none — the payload stays legacy-shaped', async () => {
    journeyOfType(undefined);
    await fire(customerCookie);
    const roomPayload = (emitToJourney as jest.Mock).mock.calls[0][2];
    expect(roomPayload.journeyType).toBeUndefined();
  });
});

describe('channel 3 — the ops SMS', () => {
  test.each(PARCEL_TYPES)("%s: a motari's alert says he is carrying a parcel", async (type) => {
    journeyOfType(type);
    await fire(driverCookie);

    const body = opsBody();
    expect(body).toContain('Motari needs help');
    expect(body).toContain('Carrying a parcel / Atwaye umuzigo');
    // The counterpart is the SENDER, and is labelled so.
    expect(body).toContain(`Sender: TestSender (${SENDER_PHONE})`);
    expect(body).not.toContain('Passenger:');
    // Everything ops already relied on is still there.
    expect(body).toContain(DRIVER_PHONE);
    expect(body).toContain(PLATE);
    expect(body).toContain(JOURNEY_ID);
    expect(body).toContain('Sonatubes');
  });

  test.each(PARCEL_TYPES)("%s: a sender's own alert names him a sender", async (type) => {
    journeyOfType(type);
    await fire(customerCookie);

    const body = opsBody();
    expect(body).toContain('Parcel sender needs help / Uwohereza umuzigo akeneye ubufasha');
    expect(body).toContain(`Sender: ${SENDER_PHONE}`);
    expect(body).toContain(`Journey: ${JOURNEY_ID}`);
    expect(body).toContain('Call now / Hamagara nonaha');
  });

  test('a PASSENGER journey keeps the ride wording, with the banned word gone', async () => {
    journeyOfType('PASSENGER');
    await fire(customerCookie);

    const body = opsBody();
    expect(body).toContain('Passenger needs help / Umugenzi akeneye ubufasha');
    expect(body).toContain(`Passenger: ${SENDER_PHONE}`);
    expect(body).not.toContain('Sender');
  });

  test('an absent journey type falls back to the ride wording', async () => {
    journeyOfType(undefined);
    await fire(customerCookie);
    expect(opsBody()).toContain('Passenger needs help / Umugenzi akeneye ubufasha');
  });
});

describe('channel 4 — the contact SMS, which is the one a family reads', () => {
  test.each(PARCEL_TYPES)("%s: a motari's family is told about a parcel", async (type) => {
    journeyOfType(type);
    await fire(driverCookie);

    const body = contactBody();
    expect(body).toContain('TestMotari');
    expect(body).toContain(
      "pressed the emergency button during a parcel delivery / yakanze buto y'ubutabazi mu gutwara umuzigo",
    );
    expect(body).toContain('Sender: TestSender');
    expect(body).not.toContain('during a ride');
    expect(body).not.toContain('mu rugendo');
    // The counterpart's number never reaches a private phone.
    expect(body).not.toContain(SENDER_PHONE);
  });

  test.each(PARCEL_TYPES)("%s: a sender's family is told about a parcel", async (type) => {
    journeyOfType(type);
    await fire(customerCookie);

    const body = contactBody();
    expect(body).toContain('TestSender');
    expect(body).toContain(
      "pressed the emergency button during a parcel delivery / yakanze buto y'ubutabazi mu gutwara umuzigo",
    );
    expect(body).toContain('Motari: TestMotari');
    expect(body).toContain(`(plate ${PLATE})`);
    expect(body).not.toContain(DRIVER_PHONE);
  });

  test('a PASSENGER journey still reads as a ride, in both languages', async () => {
    journeyOfType('PASSENGER');
    await fire(customerCookie);

    const body = contactBody();
    expect(body).toContain(
      "pressed the emergency button during a ride / yakanze buto y'ubutabazi mu rugendo",
    );
    expect(body).not.toContain('umuzigo');
  });

  test('a nameless caller on a parcel run is "A parcel sender", not "A rider"', async () => {
    journeyOfType('GOODS');
    (prisma.user.findUnique as jest.Mock).mockImplementation(
      async ({ where }: { where: { id: string } }) =>
        where.id === CUSTOMER_ID
          ? {
              phoneEncrypted: encrypt(SENDER_PHONE),
              nickname: null,
              emergencyContactsEncrypted: encrypt(JSON.stringify(SENDER_CONTACTS)),
            }
          : { phoneEncrypted: encrypt(DRIVER_PHONE), nickname: null, emergencyContactsEncrypted: encrypt('[]') },
    );
    await fire(customerCookie);
    expect(contactBody()).toContain('A parcel sender');
  });

  test('a nameless caller on a ride is "A passenger", not "A rider"', async () => {
    journeyOfType('PASSENGER');
    (prisma.user.findUnique as jest.Mock).mockImplementation(
      async ({ where }: { where: { id: string } }) =>
        where.id === CUSTOMER_ID
          ? {
              phoneEncrypted: encrypt(SENDER_PHONE),
              nickname: null,
              emergencyContactsEncrypted: encrypt(JSON.stringify(SENDER_CONTACTS)),
            }
          : { phoneEncrypted: encrypt(DRIVER_PHONE), nickname: null, emergencyContactsEncrypted: encrypt('[]') },
    );
    await fire(customerCookie);
    expect(contactBody()).toContain('A passenger');
  });
});

describe('the retired word does not survive in the SMS channel', () => {
  test.each([
    ['PASSENGER', customerCookie],
    ['PASSENGER', driverCookie],
    ['GOODS', customerCookie],
    ['GOODS', driverCookie],
    ['PRIORITY_MESSENGER', customerCookie],
    ['URGENT_MESSENGER', driverCookie],
  ])('%s / %s: no emergency SMS contains "rider"', async (type, cookie) => {
    journeyOfType(type);
    await fire(cookie);
    for (const [, body] of (sendSms as jest.Mock).mock.calls as Array<[string, string]>) {
      expect(body.toLowerCase()).not.toContain('rider');
    }
  });
});

describe('SOS mechanics are untouched by the wording', () => {
  test.each(PARCEL_TYPES)('%s: the same channels fire, to the same people', async (type) => {
    journeyOfType(type);
    const res = await fire(driverCookie);

    expect(res.status).toBe(200);
    expect(res.body.channels.opsSms).toBe('sent');
    // The CALLER's own contacts, never the counterpart's — unchanged.
    const recipients = (sendSms as jest.Mock).mock.calls.map((c) => c[0]);
    expect(recipients).toEqual([OPS_PHONE, ...DRIVER_CONTACTS]);
    for (const contact of SENDER_CONTACTS) expect(recipients).not.toContain(contact);
  });

  test('the response shape a deployed APK reads is unchanged on a parcel journey', async () => {
    journeyOfType('URGENT_MESSENGER');
    const res = await fire(customerCookie);
    expect(Object.keys(res.body).sort()).toEqual(
      ['channels', 'message', 'recorded', 'smsSuppressed', 'success'].sort(),
    );
  });
});
