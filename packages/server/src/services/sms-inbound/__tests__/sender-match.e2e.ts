// SENDER-MATCH G4 — the whole chain, through the pilot's own front door.
//
// A real Postgres, the real Prisma client, the real Express route, a real
// HMAC-signed Africa's Talking webhook body, and the real money transaction.
// Nothing between the wire and the escrow row is mocked except the OUTBOUND
// SMS transport, which would otherwise try to reach Africa's Talking.
//
// NOT part of the default jest run, and deliberately so. jest.config.js
// matches `__tests__/**/*.test.ts`; this file ends `.e2e.ts`, so
// `pnpm test:server` never picks it up and stays hermetic. Run it with
// `pnpm --filter @bimoto/server test:sms-e2e` against a migrated database.
//
// It used to live in the default run behind a describe.skip that fired when
// no database was configured — which CI rejects, and rightly: the zero-skip
// guard in server-tests.yml exists so "an accidental return to describe.skip
// fails this step rather than showing a green suite that never ran the
// guard". A suite that needs a real Postgres does not belong in the hermetic
// run at all, so it is not there any more, and there is no skip left to
// hide behind.

import crypto from 'crypto';
import express from 'express';
import request from 'supertest';

const E2E_URL = process.env.SENDER_MATCH_E2E_DATABASE_URL;

if (!E2E_URL) {
  // Fail loudly rather than skipping. Whoever ran this script asked for the
  // end-to-end proof; silently reporting green without it would be the worse
  // outcome by a distance.
  throw new Error(
    'SENDER_MATCH_E2E_DATABASE_URL is not set. This suite needs a migrated ' +
      'Postgres — point it at one, e.g.\n' +
      '  SENDER_MATCH_E2E_DATABASE_URL="postgresql://user@localhost:5432/bimoto_test" \\\n' +
      '    pnpm --filter @bimoto/server test:sms-e2e',
  );
}

{
  // config.ts parses process.env at import time and, when the parse FAILS,
  // falls back to a hardcoded test DATABASE_URL that points at a database
  // which does not exist here. So the parse has to succeed: supply the three
  // secrets it requires alongside the real URL, before anything imports it.
  process.env.DATABASE_URL = E2E_URL;
  process.env.JWT_SECRET ??= 'sender-match-e2e-jwt-secret-32-chars-long';
  process.env.JWT_REFRESH_SECRET ??= 'sender-match-e2e-refresh-secret-32-chars';
  process.env.ENCRYPTION_KEY ??= 'a'.repeat(64);
  process.env.AT_INBOUND_HMAC_SECRET = 'sender-match-e2e-secret';
}

jest.mock('../../sms.service', () => ({
  sendSms: jest.fn().mockResolvedValue({ success: true }),
}));

import { PrismaClient } from '@prisma/client';
import * as sms from '../../sms.service';

const prisma = new PrismaClient(
  E2E_URL ? { datasources: { db: { url: E2E_URL } } } : undefined,
);

const AT_SECRET = 'sender-match-e2e-secret';
const CUSTOMER_PHONE = '+250788700001';
const DRIVER_PHONE = '+250788700002';
const STRANGER_PHONE = '+250788700009';

function signed(body: Record<string, string>) {
  const raw = new URLSearchParams(body).toString();
  const sig = crypto.createHmac('sha256', AT_SECRET).update(raw).digest('hex');
  return { raw, sig };
}

/** Posts an inbound SMS exactly as Africa's Talking would. */
async function textIn(app: express.Express, from: string, text: string, id: string) {
  const { raw, sig } = signed({ id, from, to: '15555', text, date: new Date().toISOString() });
  const res = await request(app)
    .post('/api/sms/inbound')
    .set('Content-Type', 'application/x-www-form-urlencoded')
    .set('x-at-signature', sig)
    .send(raw);
  expect(res.status).toBe(200);
  // The route answers AT before processing completes (setImmediate); wait for
  // the row to be stamped rather than guessing at a delay.
  for (let i = 0; i < 100; i += 1) {
    const row = await prisma.smsInbound.findUnique({ where: { atMessageId: id } });
    if (row?.processedAt) return row;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`inbound ${id} was never processed`);
}

describe('SENDER-MATCH G4 — end to end over the wire', () => {
  let app: express.Express;
  // SENDER-MATCH-2 — (a) and (d) below confirm a ride, which is a GATED
  // command in the pilot. They are the full tier's end-to-end proof and run
  // under it; the safe tier's own end-to-end refusal is asserted in (e).
  let originalTier: string;
  let hashPhone: (p: string) => string;
  let encrypt: (p: string) => string;

  beforeAll(async () => {
    const cryptoUtils = require('../../../utils/crypto');
    hashPhone = cryptoUtils.hashPhone;
    encrypt = cryptoUtils.encrypt;
    const smsInboundRoutes = require('../../../routes/sms-inbound.routes').default;
    app = express();
    app.use('/api/sms', smsInboundRoutes);
    const { config } = require('../../../config');
    originalTier = config.SMS_COMMAND_TIER;
    config.SMS_COMMAND_TIER = 'full';
  });

  afterAll(async () => {
    const { config } = require('../../../config');
    config.SMS_COMMAND_TIER = originalTier;
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    await prisma.escrowAuditLog.deleteMany({});
    await prisma.driverBalance.deleteMany({});
    await prisma.escrow.deleteMany({});
    await prisma.smsInbound.deleteMany({});
    await prisma.journey.deleteMany({});
    await prisma.user.deleteMany({
      where: {
        phoneHash: {
          in: [CUSTOMER_PHONE, DRIVER_PHONE, STRANGER_PHONE].map(hashPhone),
        },
      },
    });
  });

  async function seedRideAwaitingConfirmation() {
    const customer = await prisma.user.create({
      data: {
        phoneEncrypted: encrypt(CUSTOMER_PHONE),
        phoneHash: hashPhone(CUSTOMER_PHONE),
        nickname: 'PilotTester',
        role: 'CUSTOMER',
        language: 'rw',
      },
    });
    const driver = await prisma.user.create({
      data: {
        phoneEncrypted: encrypt(DRIVER_PHONE),
        phoneHash: hashPhone(DRIVER_PHONE),
        nickname: 'PilotDriver',
        role: 'DRIVER',
        language: 'rw',
        // releaseEscrowTx bumps driverProfile.totalRides inside the same
        // transaction, so a driver without a profile makes the whole
        // confirmation roll back. Seeding one is what lets the real #184
        // transaction be observed rather than merely attempted.
        driverProfile: {
          create: { vehicleType: 'MOTO', vehicleDescription: 'Pilot moto' },
        },
      },
    });
    const journey = await prisma.journey.create({
      data: {
        customerId: customer.id,
        driverId: driver.id,
        status: 'AWAITING_CONFIRMATION',
        pickupLat: -1.95,
        pickupLng: 30.06,
        pickupName: 'Kimironko',
        destinationLat: -1.94,
        destinationLng: 30.05,
        destinationName: 'Nyabugogo',
        endedAt: new Date(),
      },
    });
    const escrow = await prisma.escrow.create({
      data: {
        journeyId: journey.id,
        customerId: customer.id,
        driverId: driver.id,
        amount: 2000,
        commission: 200,
        driverPayout: 1800,
        status: 'HELD',
      },
    });
    return { customer, driver, journey, escrow };
  }

  test('(a) a registered customer texts YES → ride COMPLETED, escrow RELEASED, row stamped, reply sent', async () => {
    const { customer, journey } = await seedRideAwaitingConfirmation();

    const row = await textIn(app, CUSTOMER_PHONE, 'YES', 'e2e-confirm-1');

    // The lookup told the truth: the message reached an account.
    expect(row.userId).toBe(customer.id);
    expect(row.errorMessage).toBeNull();
    expect(row.status).toBe('PROCESSED');
    expect(row.intent).toBe('CONFIRM_JOURNEY');
    expect(row.resolvedEntityId).toBe(journey.id);

    // The full #184 transaction, observed from the wire.
    const after = await prisma.journey.findUnique({ where: { id: journey.id } });
    expect(after!.status).toBe('COMPLETED');
    expect(after!.confirmedAt).not.toBeNull();
    const escrowAfter = await prisma.escrow.findUnique({ where: { journeyId: journey.id } });
    expect(escrowAfter!.status).toBe('RELEASED');
    expect(escrowAfter!.releasedAt).not.toBeNull();

    expect(sms.sendSms).toHaveBeenCalledWith(
      CUSTOMER_PHONE,
      'Bimoto: Thanks — your ride is marked complete.',
    );
    expect(row.replySentAt).not.toBeNull();
  });

  test('(b) the opt-out chain: STOP, then a YES on a new ride changes nothing', async () => {
    const { customer } = await seedRideAwaitingConfirmation();

    const stopRow = await textIn(app, CUSTOMER_PHONE, 'STOP', 'e2e-stop-1');
    expect(stopRow.userId).toBe(customer.id);
    expect(stopRow.status).toBe('OPT_OUT_RECORDED');
    expect(await prisma.user.findUnique({ where: { id: customer.id } })).toMatchObject({
      smsOptOut: true,
    });
    // The STOP confirmation itself IS sent — the one message an opted-out
    // user must still receive.
    expect(sms.sendSms).toHaveBeenCalledWith(
      CUSTOMER_PHONE,
      'Bimoto: You will not receive non-essential SMS. Reply START to re-enable.',
    );

    // A brand new ride, awaiting confirmation.
    const driver = await prisma.user.findFirst({ where: { role: 'DRIVER' } });
    const newJourney = await prisma.journey.create({
      data: {
        customerId: customer.id,
        driverId: driver!.id,
        status: 'AWAITING_CONFIRMATION',
        pickupLat: -1.95,
        pickupLng: 30.06,
        pickupName: 'Kimironko',
        destinationLat: -1.94,
        destinationLng: 30.05,
        destinationName: 'Remera',
        endedAt: new Date(),
      },
    });
    const newEscrow = await prisma.escrow.create({
      data: {
        journeyId: newJourney.id,
        customerId: customer.id,
        driverId: driver!.id,
        amount: 3000,
        commission: 300,
        driverPayout: 2700,
        status: 'HELD',
      },
    });

    jest.clearAllMocks();
    const suppressed = await textIn(app, CUSTOMER_PHONE, 'YES', 'e2e-optout-yes-1');

    expect(suppressed.status).toBe('OPT_OUT_RECORDED');
    expect(suppressed.userId).toBe(customer.id);
    expect(suppressed.replyBody).toBeNull();
    expect(sms.sendSms).not.toHaveBeenCalled();

    // NO state change: the ride and the money are exactly as they were.
    expect(
      (await prisma.journey.findUnique({ where: { id: newJourney.id } }))!.status,
    ).toBe('AWAITING_CONFIRMATION');
    expect(
      (await prisma.escrow.findUnique({ where: { id: newEscrow.id } }))!.status,
    ).toBe('HELD');

    // …and HELP still reaches them.
    const help = await textIn(app, CUSTOMER_PHONE, 'HELP', 'e2e-optout-help-1');
    expect(help.status).toBe('PROCESSED');
    expect(help.replyBody).toContain('Reply 1=confirm');
  });

  test('(c) a true stranger still walks the unmatched path', async () => {
    await seedRideAwaitingConfirmation();
    const row = await textIn(app, STRANGER_PHONE, 'YES', 'e2e-stranger-1');
    expect(row.userId).toBeNull();
    expect(row.status).toBe('UNMATCHED_SENDER');
    // SENDER-MATCH-2 — SUPPORT_PHONE is unset here, so the support clause is
    // omitted rather than degrading to the placeholder this used to carry.
    expect(sms.sendSms).toHaveBeenCalledWith(
      STRANGER_PHONE,
      'Bimoto: We could not match your number.',
    );
  });

  test('(e) SAFE TIER, the pilot default: YES refuses over the wire and NOTHING moves', async () => {
    const { config } = require('../../../config');
    config.SMS_COMMAND_TIER = 'safe';
    try {
      const { customer, journey, escrow } = await seedRideAwaitingConfirmation();

      const row = await textIn(app, CUSTOMER_PHONE, 'YES', 'e2e-safe-tier-1');

      // The sender is still RESOLVED — the tier refuses the action, it does
      // not un-recognise the person.
      expect(row.userId).toBe(customer.id);
      expect(row.replyBody).toBe(
        'Bimoto: For ride actions please use the Bimoto app. Reply HELP for what works by SMS.',
      );

      // The money did not move, and the ride did not change.
      expect(
        (await prisma.journey.findUnique({ where: { id: journey.id } }))!.status,
      ).toBe('AWAITING_CONFIRMATION');
      const escrowAfter = await prisma.escrow.findUnique({ where: { id: escrow.id } });
      expect(escrowAfter!.status).toBe('HELD');
      expect(escrowAfter!.releasedAt).toBeNull();

      // …and the rights that DID launch still work on the same number.
      const stop = await textIn(app, CUSTOMER_PHONE, 'STOP', 'e2e-safe-tier-2');
      expect(stop.status).toBe('OPT_OUT_RECORDED');
      expect(
        (await prisma.user.findUnique({ where: { id: customer.id } }))!.smsOptOut,
      ).toBe(true);
    } finally {
      config.SMS_COMMAND_TIER = 'full';
    }
  });

  test('(d) a tester who types the local form 07… reaches the same account', async () => {
    const { customer, journey } = await seedRideAwaitingConfirmation();
    const row = await textIn(app, '0788700001', 'YES', 'e2e-local-form-1');
    expect(row.userId).toBe(customer.id);
    expect(
      (await prisma.journey.findUnique({ where: { id: journey.id } }))!.status,
    ).toBe('COMPLETED');
  });
});
