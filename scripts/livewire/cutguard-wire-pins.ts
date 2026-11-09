/**
 * CUTGUARD v2 — the wire pins, against real Postgres.
 *
 * Not a unit test and not a mock. This builds the REAL express app from
 * the REAL routers, points the REAL Prisma client at a live database with
 * all 46 migrations applied, and drives it over HTTP — because every
 * defect this dispatch closed was a defect in what actually went over the
 * wire, and a mocked prisma is exactly the oracle that missed them.
 *
 * Follows the scripts/livewire/ precedent (measure.ts, payload-diff.ts):
 * an evidence harness, run deliberately, not a CI job.
 *
 * Run:
 *   DATABASE_URL=... JWT_SECRET=... JWT_REFRESH_SECRET=... ENCRYPTION_KEY=... \
 *     npx tsx scripts/livewire/cutguard-wire-pins.ts
 *
 * Exits non-zero on the first failed pin, and prints every pin either way.
 */

import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';

import prisma from '../../packages/server/src/prisma';
import authRoutes from '../../packages/server/src/routes/auth.routes';
import userRoutes from '../../packages/server/src/routes/user.routes';
import bidRoutes from '../../packages/server/src/routes/bid.routes';
import journeyRoutes from '../../packages/server/src/routes/journey.routes';
import scheduledRideRoutes from '../../packages/server/src/routes/scheduled-ride.routes';
import { errorHandler } from '../../packages/server/src/middleware/error-handler';
import {
  appVersionMiddleware,
  APP_VERSION_HEADER,
  CURRENT_APP_VERSION,
} from '../../packages/server/src/middleware/app-version';
import { generateAccessToken } from '../../packages/server/src/utils/jwt';
import { encrypt, hashPhone } from '../../packages/server/src/utils/crypto';
import {
  collectBlockingFacts,
  firstBlockingReason,
} from '../../packages/server/src/jobs/deletion-execution.job';

const app = express();
app.use(express.json());
app.use(cookieParser());
// CUTGUARD v2 G6 — before any router, exactly as the real server mounts
// it. Without this every pin below would be asking a server that has no
// idea what generation is calling, which is the thing G6 fixed.
app.use(appVersionMiddleware);
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/journeys', journeyRoutes);
app.use('/api/journeys', bidRoutes);
app.use('/api/scheduled-rides', scheduledRideRoutes);
app.use(errorHandler);

let passed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const SENSITIVE = [
  'phoneEncrypted',
  'emergencyContactsEncrypted',
  'phoneHash',
  'moneyPinHash',
  'moneyPinPendingHash',
  'moneyPinAttempts',
  'moneyPinLockedUntil',
  'disputeCount',
  'disputeRate',
  'isFlagged',
  'flagReason',
  'frozenAt',
  'suspendedUntil',
  'payoutPreference',
  'completedShifts',
  'cooperativeId',
  'isDeleted',
];

const stamp = Date.now();
const phone = (n: number) => `+2507880${String(stamp % 100000).padStart(5, '0')}`.slice(0, 10) + String(n).padStart(3, '0');

/**
 * `n` is the phone's discriminator, so two blocks that pick the same one
 * collide on `phoneHash` — which Prisma reports as a P2002 forty frames
 * deep, naming neither block. It cost a run to work that out once; this
 * turns it into a sentence.
 */
const usedNumbers = new Set<number>();

async function makeUser(opts: {
  n: number;
  role: 'CUSTOMER' | 'DRIVER' | 'BOTH';
  contacts?: string[];
  withProfile?: boolean;
}) {
  if (usedNumbers.has(opts.n)) {
    throw new Error(
      `wire-pins: fixture number ${opts.n} is already taken — pick an unused one. ` +
        `In use: ${[...usedNumbers].sort((a, b) => a - b).join(', ')}`,
    );
  }
  usedNumbers.add(opts.n);
  const p = phone(opts.n);
  const user = await prisma.user.create({
    data: {
      phoneEncrypted: encrypt(p),
      phoneHash: hashPhone(p),
      nickname: `WirePin${opts.n}`,
      role: opts.role,
      language: 'rw',
      ...(opts.contacts ? { emergencyContactsEncrypted: encrypt(JSON.stringify(opts.contacts)) } : {}),
      // The credential columns that must never travel.
      moneyPinHash: 'hmac-of-a-real-pin',
      moneyPinAttempts: 1,
      disputeRate: 0.25,
      isFlagged: true,
      flagReason: 'WIRE_PIN_FIXTURE',
      ...(opts.withProfile
        ? {
            driverProfile: {
              create: {
                vehicleType: 'MOTO',
                registrationPlate: 'RAW123P',
                vehicleDescription: 'Wire Pin Boxer',
                drivingLicenseNumber: 'DL-WIRE',
                verificationStatus: 'VERIFIED',
              },
            },
          }
        : {}),
    },
  });
  return { user, phone: p };
}

async function main(): Promise<void> {
  console.log('\nCUTGUARD v2 — wire pins, real Postgres\n');

  /* ------------------------------------------------ G1: the login payload */
  console.log('G1 — the client-user serialization boundary');
  {
    const contacts = ['+250788111222', '+250788333444'];
    const { user, phone: p } = await makeUser({
      n: 1,
      role: 'BOTH',
      contacts,
      withProfile: true,
    });

    // A pre-existing user logs in. The OTP is verified through the real
    // service, so an OTP row is planted the way requestOtp would.
    const otpRes = await request(app).post('/api/auth/request-otp').send({ phone: p });
    // `testOtp` is what requestOtp answers with outside production.
    const code = otpRes.body?.testOtp as string | undefined;

    let loginUser: Record<string, unknown> | null = null;
    if (code) {
      const res = await request(app).post('/api/auth/verify-otp').send({ phone: p, otp: code });
      loginUser = res.body?.user ?? null;
      check('verify-otp answers 200', res.status === 200, `status ${res.status}`);
    } else {
      check(
        'request-otp returned a test code',
        false,
        `body ${JSON.stringify(otpRes.body).slice(0, 120)}`,
      );
    }

    if (loginUser) {
      check(
        'login user carries emergencyContacts (B-1)',
        JSON.stringify(loginUser.emergencyContacts) === JSON.stringify(contacts),
        JSON.stringify(loginUser.emergencyContacts),
      );
      check('login user carries phone', loginUser.phone === p, String(loginUser.phone));
      check(
        'login user carries driverProfile with the real plate (U-6)',
        (loginUser.driverProfile as { registrationPlate?: string } | null)?.registrationPlate ===
          'RAW123P',
      );
      const leaked = SENSITIVE.filter((k) =>
        Object.prototype.hasOwnProperty.call(loginUser, k),
      );
      check('login user carries NO sensitive key (U-2)', leaked.length === 0, leaked.join(','));
      const dp = loginUser.driverProfile as Record<string, unknown> | null;
      check(
        'driverProfile carries no document trail',
        dp !== null && !Object.prototype.hasOwnProperty.call(dp, 'drivingLicenseNumber'),
      );
    }

    // …and /me agrees with it.
    const token = generateAccessToken({ userId: user.id, role: 'BOTH' });
    const me = await request(app).get('/api/users/me').set('Cookie', [`accessToken=${token}`]);
    check('/me answers 200', me.status === 200, `status ${me.status}`);
    check(
      '/me carries the same emergencyContacts',
      JSON.stringify(me.body.emergencyContacts) === JSON.stringify(contacts),
    );
    const meLeaked = SENSITIVE.filter((k) =>
      Object.prototype.hasOwnProperty.call(me.body, k),
    );
    check('/me carries NO sensitive key', meLeaked.length === 0, meLeaked.join(','));
    if (loginUser) {
      const a = Object.keys(loginUser).sort().join(',');
      const b = Object.keys(me.body)
        .filter((k) => k !== 'accountDeletion')
        .sort()
        .join(',');
      check('login and /me carry the SAME key set', a === b, `${a}\n        vs ${b}`);
    }
  }

  /* -------------------------------- G4 + G3: accept-bid, actor and money */
  console.log('\nG4 — the ownership tautology, and G3 — the money projection');
  {
    const { user: customer } = await makeUser({ n: 2, role: 'CUSTOMER' });
    const { user: driver } = await makeUser({ n: 3, role: 'DRIVER', withProfile: true });
    const { user: stranger } = await makeUser({ n: 4, role: 'DRIVER', withProfile: true });

    const journey = await prisma.journey.create({
      data: {
        customerId: customer.id,
        type: 'PASSENGER',
        status: 'REQUESTED',
        pickupLat: -1.94,
        pickupLng: 30.06,
        pickupName: 'Nyabugogo',
        destinationLat: -1.95,
        destinationLng: 30.09,
        destinationName: 'Kimironko',
        bookingMode: 'IMMEDIATE',
      },
    });
    const bid = await prisma.bid.create({
      data: { journeyId: journey.id, driverId: driver.id, price: 2000, etaMinutes: 5 },
    });

    const strangerToken = generateAccessToken({ userId: stranger.id, role: 'DRIVER' });
    const ack = await request(app)
      .post(`/api/scheduled-rides/${journey.id}/conflict-acknowledge`)
      .set('Cookie', [`accessToken=${strangerToken}`])
      .send({ bidId: bid.id });

    check(
      'U-1: a stranger motari is REFUSED at conflict-acknowledge',
      ack.status === 403,
      `status ${ack.status} body ${JSON.stringify(ack.body).slice(0, 120)}`,
    );
    const stillOpen = await prisma.journey.findUnique({ where: { id: journey.id } });
    check(
      'U-1: the journey is untouched — no match, no money',
      stillOpen?.status === 'REQUESTED' && stillOpen?.driverId === null,
      `status ${stillOpen?.status} driverId ${stillOpen?.driverId}`,
    );
    const escrowCount = await prisma.escrow.count({ where: { journeyId: journey.id } });
    check('U-1: no escrow was created', escrowCount === 0, `escrows ${escrowCount}`);

    // The legitimate passenger accepts, over the wire.
    const customerToken = generateAccessToken({ userId: customer.id, role: 'CUSTOMER' });
    const accept = await request(app)
      .post(`/api/journeys/${journey.id}/accept-bid`)
      .set('Cookie', [`accessToken=${customerToken}`])
      // CUTGUARD v2 amendment 2 — as a CURRENT client. This pin is about
      // WHAT the projection contains; whether it is attached at all is a
      // separate question, pinned in its own block below.
      .set(APP_VERSION_HEADER, String(CURRENT_APP_VERSION))
      .send({ bidId: bid.id });

    check(
      'the passenger IS served — 200',
      accept.status === 200,
      `status ${accept.status} body ${JSON.stringify(accept.body).slice(0, 200)}`,
    );

    const breakdown = accept.body?.commissionBreakdown;
    if (breakdown) {
      const keys = Object.keys(breakdown).sort();
      check(
        'U-4: accept-bid answers EXACTLY the customer-safe four',
        keys.join(',') === 'bidPrice,customerSavings,customerTier,feeWaiverApplied',
        keys.join(','),
      );
      const forbidden = [
        'driverPayout',
        'driverTier',
        'driverCommissionRate',
        'driverSavings',
        'totalCommissionAmount',
        'totalCommissionRate',
      ].filter((k) => Object.prototype.hasOwnProperty.call(breakdown, k));
      check(
        'U-4: no key that reconstructs the motari’s net',
        forbidden.length === 0,
        forbidden.join(','),
      );
    } else {
      check('accept-bid returned a commissionBreakdown', false, 'absent');
    }
  }

  /* ------------------- amendment 2: B-2 as a CLASS, both directions ------ */
  //
  // Five customer surfaces carry the same shape. G6 gated one and this
  // dispatch reported the class closed; it was not. What follows asks the
  // SAME server the SAME question twice — once with `X-App-Version: 14`
  // and once with no header at all, which is literally what a phone
  // running the da9eca0 APK sends — and prints both answers.
  //
  // The legacy assertion is `hasOwnProperty`, never falsiness: `null`
  // passes a falsy check and null is not the fix. v13 guards with `&&` so
  // a null survives today, but ABSENT is the shape those builds have
  // always coped with, and a `commissionBreakdown: null` is a place for
  // the next refactor to put something back.
  console.log('\nCUTGUARD amendment 2 — the savings preview, gated by CLIENT on every surface');
  {
    const { user: customer } = await makeUser({ n: 9, role: 'CUSTOMER' });
    const { user: driver } = await makeUser({ n: 10, role: 'DRIVER', withProfile: true });

    const customerToken = generateAccessToken({ userId: customer.id, role: 'CUSTOMER' });
    const cookie = [`accessToken=${customerToken}`];
    const CURRENT = String(CURRENT_APP_VERSION);
    const FOUR = 'bidPrice,customerSavings,customerTier,feeWaiverApplied';

    /** One requested journey with one bid on it. */
    async function ride(price: number) {
      const j = await prisma.journey.create({
        data: {
          customerId: customer.id,
          type: 'PASSENGER',
          status: 'REQUESTED',
          pickupLat: -1.94,
          pickupLng: 30.06,
          pickupName: 'Nyabugogo',
          destinationLat: -1.95,
          destinationLng: 30.09,
          destinationName: 'Kimironko',
          bookingMode: 'IMMEDIATE',
        },
      });
      const b = await prisma.bid.create({
        data: { journeyId: j.id, driverId: driver.id, price, etaMinutes: 5 },
      });
      return { j, b };
    }

    const has = (o: unknown) =>
      !!o && Object.prototype.hasOwnProperty.call(o, 'commissionBreakdown');
    const keysOf = (o: any) => Object.keys(o?.commissionBreakdown ?? {}).sort().join(',');

    /* --- surface 1+2: the ACCEPT response, both exits of the same body --- */
    //
    // v13 does `setActiveJourney(<this body>)` and navigates to
    // MatchedPage, which renders it whenever the refetch that would have
    // overwritten it fails.
    const currentRide = await ride(2000);
    const acceptV14 = await request(app)
      .post(`/api/journeys/${currentRide.j.id}/accept-bid`)
      .set('Cookie', cookie)
      .set(APP_VERSION_HEADER, CURRENT)
      .send({ bidId: currentRide.b.id });
    check('accept (v14) answers 200', acceptV14.status === 200, `status ${acceptV14.status}`);
    check(
      'accept (v14) carries EXACTLY the customer-safe four',
      keysOf(acceptV14.body) === FOUR,
      keysOf(acceptV14.body),
    );

    const legacyRide = await ride(2100);
    const acceptLegacy = await request(app)
      .post(`/api/journeys/${legacyRide.j.id}/accept-bid`)
      .set('Cookie', cookie)
      .send({ bidId: legacyRide.b.id });
    check('accept (legacy) answers 200', acceptLegacy.status === 200, `status ${acceptLegacy.status}`);
    check(
      'B-2: accept (legacy) OMITS the key entirely',
      !has(acceptLegacy.body),
      JSON.stringify(acceptLegacy.body?.commissionBreakdown),
    );
    check(
      'accept (legacy) keeps the retry surface v13 reads',
      ['escrowStatus', 'escrowId', 'escrowTxRef', 'escrowAmount'].every((k) =>
        Object.prototype.hasOwnProperty.call(acceptLegacy.body, k),
      ),
    );

    /* ------------------------------- surface 3: the JOURNEY read -------- */
    const readV14 = await request(app)
      .get(`/api/journeys/${currentRide.j.id}`)
      .set('Cookie', cookie)
      .set(APP_VERSION_HEADER, CURRENT);
    check('journey read (v14) answers 200', readV14.status === 200, `status ${readV14.status}`);
    check(
      'journey read (v14) carries the four',
      keysOf(readV14.body) === FOUR,
      keysOf(readV14.body),
    );

    const readLegacy = await request(app)
      .get(`/api/journeys/${currentRide.j.id}`)
      .set('Cookie', cookie);
    check('journey read (legacy) answers 200', readLegacy.status === 200, `status ${readLegacy.status}`);
    check(
      'B-2: journey read (legacy) OMITS the key — MatchedPage stays up',
      !has(readLegacy.body),
      JSON.stringify(readLegacy.body?.commissionBreakdown),
    );
    check(
      'journey read (legacy) still carries the ride itself',
      ['id', 'status', 'agreedPrice', 'driverId'].every((k) =>
        Object.prototype.hasOwnProperty.call(readLegacy.body, k),
      ),
    );

    /* ------------------------------- surface 4: the RIDES list ---------- */
    const listV14 = await request(app)
      .get('/api/journeys')
      .set('Cookie', cookie)
      .set(APP_VERSION_HEADER, CURRENT);
    const rowV14 = (listV14.body as any[]).find((r) => r.id === currentRide.j.id);
    check('rides list (v14) answers 200 with her ride', listV14.status === 200 && !!rowV14);
    check('rides list (v14) carries the four', keysOf(rowV14) === FOUR, keysOf(rowV14));

    const listLegacy = await request(app).get('/api/journeys').set('Cookie', cookie);
    const rowLegacy = (listLegacy.body as any[]).find((r) => r.id === currentRide.j.id);
    check('rides list (legacy) answers 200 with her ride', listLegacy.status === 200 && !!rowLegacy);
    check(
      'B-2: rides list (legacy) OMITS the key — HistoryPage stays up',
      !has(rowLegacy),
      JSON.stringify(rowLegacy?.commissionBreakdown),
    );

    /* --------------- and nothing of his, at EITHER version, as raw text -- */
    //
    // Key-by-key would miss a nested copy under another name. #202's
    // claim is that the motari's net must not be RECONSTRUCTIBLE.
    for (const [label, res] of [
      ['accept (v14)', acceptV14],
      ['journey read (v14)', readV14],
      ['rides list (v14)', listV14],
    ] as const) {
      const text = JSON.stringify(res.body);
      const leaked = ['driverPayout', 'totalCommissionAmount', 'driverCommissionRate'].filter((k) =>
        text.includes(k),
      );
      check(`${label} carries no key of the motari's money`, leaked.length === 0, leaked.join(','));
    }
  }

  /* ------------------------------------------------- G5: the erasure gate */
  console.log('\nG5 — erasure blocks on any outstanding obligation');
  {
    const { user: customer } = await makeUser({ n: 5, role: 'CUSTOMER' });
    const { user: bidder } = await makeUser({ n: 6, role: 'DRIVER', withProfile: true });

    const journey = await prisma.journey.create({
      data: {
        customerId: customer.id,
        type: 'PASSENGER',
        status: 'REQUESTED',
        pickupLat: -1.94,
        pickupLng: 30.06,
        pickupName: 'Nyabugogo',
        destinationLat: -1.95,
        destinationLng: 30.09,
        destinationName: 'Kimironko',
        bookingMode: 'IMMEDIATE',
      },
    });
    const liveBid = await prisma.bid.create({
      data: { journeyId: journey.id, driverId: bidder.id, price: 1800, etaMinutes: 6 },
    });

    const withBid = await collectBlockingFacts(bidder.id);
    check('B-4: a PENDING bid is seen as a blocking fact', withBid.hasOpenBid === true);
    check(
      'B-4: the sweep defers with OPEN_BID',
      firstBlockingReason(withBid) === 'OPEN_BID',
      String(firstBlockingReason(withBid)),
    );

    // The bid expires. Nothing else about the driver changes.
    await prisma.bid.update({ where: { id: liveBid.id }, data: { status: 'EXPIRED' } });
    const afterExpiry = await collectBlockingFacts(bidder.id);
    check('B-4: an EXPIRED bid no longer blocks', afterExpiry.hasOpenBid === false);
    check(
      'B-4: with nothing else in the way, the next sweep would erase him',
      firstBlockingReason(afterExpiry) === null,
      String(firstBlockingReason(afterExpiry)),
    );

    // The five original facts still defer, one at a time, on real rows.
    const { user: five } = await makeUser({ n: 7, role: 'BOTH', withProfile: true });
    const base = await collectBlockingFacts(five.id);
    check('a clean account defers on nothing', firstBlockingReason(base) === null);

    const j2 = await prisma.journey.create({
      data: {
        customerId: five.id,
        type: 'PASSENGER',
        status: 'MATCHED',
        pickupLat: -1.94,
        pickupLng: 30.06,
        pickupName: 'A',
        destinationLat: -1.95,
        destinationLng: 30.09,
        destinationName: 'B',
        bookingMode: 'IMMEDIATE',
      },
    });
    check(
      'NON_TERMINAL_JOURNEY still defers',
      firstBlockingReason(await collectBlockingFacts(five.id)) === 'NON_TERMINAL_JOURNEY',
    );
    await prisma.journey.update({ where: { id: j2.id }, data: { status: 'COMPLETED' } });

    const esc = await prisma.escrow.create({
      data: {
        journeyId: j2.id,
        customerId: five.id,
        driverId: five.id,
        amount: 1000,
        commission: 50,
        driverPayout: 950,
        status: 'HELD',
        txRef: `wire-pin-${stamp}`,
      },
    });
    check(
      'LIVE_ESCROW still defers',
      firstBlockingReason(await collectBlockingFacts(five.id)) === 'LIVE_ESCROW',
    );
    await prisma.escrow.update({ where: { id: esc.id }, data: { status: 'RELEASED' } });

    const alert = await prisma.emergencyAlert.create({
      data: {
        raisedById: five.id,
        journeyId: j2.id,
        raisedByRole: 'CUSTOMER',
        status: 'ACTIVE',
      },
    });
    check(
      'UNRESOLVED_EMERGENCY still defers',
      firstBlockingReason(await collectBlockingFacts(five.id)) === 'UNRESOLVED_EMERGENCY',
    );
    await prisma.emergencyAlert.update({
      where: { id: alert.id },
      data: { status: 'RESOLVED' },
    });

    await prisma.user.update({ where: { id: five.id }, data: { frozenAt: new Date() } });
    check(
      'ACCOUNT_FROZEN still defers',
      firstBlockingReason(await collectBlockingFacts(five.id)) === 'ACCOUNT_FROZEN',
    );
    await prisma.user.update({ where: { id: five.id }, data: { frozenAt: null } });

    await prisma.driverBalance.create({
      data: { driverId: five.id, pendingAmount: 750 },
    });
    check(
      'POSITIVE_DRIVER_BALANCE still defers',
      firstBlockingReason(await collectBlockingFacts(five.id)) === 'POSITIVE_DRIVER_BALANCE',
    );
    await prisma.driverBalance.update({
      where: { driverId: five.id },
      data: { pendingAmount: 0 },
    });

    // …and the two the audit added, on real rows.
    const batch = await prisma.driverPayoutBatch.create({
      data: {
        driverId: five.id,
        amount: 500,
        status: 'PENDING',
        txRef: `wire-pin-batch-${stamp}`,
      },
    });
    check(
      'IN_FLIGHT_PAYOUT defers',
      firstBlockingReason(await collectBlockingFacts(five.id)) === 'IN_FLIGHT_PAYOUT',
    );
    await prisma.driverPayoutBatch.update({
      where: { id: batch.id },
      data: { status: 'SUCCESS' },
    });

    await prisma.payoutPreferenceChangeLog.create({
      data: {
        userId: five.id,
        oldPreference: 'AT_SHIFT_END',
        newPreference: 'DAILY_22H',
        payoutFired: false,
        payoutDueAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    });
    check(
      'SCHEDULED_PAYOUT defers',
      firstBlockingReason(await collectBlockingFacts(five.id)) === 'SCHEDULED_PAYOUT',
    );
  }

  console.log(`\n${passed} pin(s) passed, ${failures.length} failed.`);
  if (failures.length) {
    for (const f of failures) console.log(`  - ${f}`);
    process.exitCode = 1;
  }
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('harness error:', err);
  await prisma.$disconnect();
  process.exit(1);
});
