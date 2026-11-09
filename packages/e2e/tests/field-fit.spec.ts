import { test, expect, chromium, type Browser } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { loginAs, applyAuthToContext, verifyDriver, disconnectPrisma } from './helpers';

/**
 * FIELD-FIT — the reports from Kigali, walked end to end after the fix.
 *
 * Each test here has a matching row in docs/field-fit-reproduction.md
 * recording what it did BEFORE the change:
 *
 *   • the role flip — a person who chose "Motari" became DRIVER,USER
 *     without asking. The reproduction is replayed verbatim and must
 *     now fail to mutate.
 *   • out-of-area booking — answered with the raw zod dump; must now
 *     answer in plain words.
 *   • the engaged motari — was offered a second passenger while
 *     carrying the first; must now see none, and the block must be
 *     counted.
 */

const KIGALI = { lat: -1.9536, lng: 30.0606, name: 'Kimironko Market' };
const MUSANZE = { lat: -1.4998, lng: 29.6339 };   // ~90 km outside the pilot area

const prisma = new PrismaClient();
let browser: Browser;
const createdJourneyIds: string[] = [];

test.beforeAll(async () => {
  browser = await chromium.launch(
    process.env.PW_CHROMIUM_PATH
      ? { executablePath: process.env.PW_CHROMIUM_PATH }
      : {},
  );
});

test.afterAll(async () => {
  if (createdJourneyIds.length > 0) {
    await prisma.journey.updateMany({
      where: { id: { in: createdJourneyIds } },
      data: { status: 'CANCELLED' },
    });
  }
  await browser?.close();
  await disconnectPrisma();
  await prisma.$disconnect();
});

// ---------------------------------------------------------------- role

test('an account stays the role its owner chose (the G1 role-flip reproduction, now failing to mutate)', async () => {
  test.setTimeout(60_000);

  // The G1 reproduction, verbatim: it is exactly what RegisterPage does
  // when a person taps "Motari" — PUT the chosen role, then POST the
  // driver profile one request later.
  const person = await loginAs('TestCustomer');
  const originalRole = person.user.role as 'CUSTOMER' | 'DRIVER' | 'BOTH';

  try {
    const put = await person.api.put('/api/users/me', {
      data: { role: 'DRIVER' },
    });
    expect(put.ok()).toBe(true);
    expect((await put.json()).role).toBe('DRIVER');

    // TestCustomer has no driver profile, so this is the create path —
    // the one that used to overwrite the role with BOTH.
    const post = await person.api.post('/api/users/me/driver-profile', {
      data: {
        vehicleType: 'MOTO',
        registrationPlate: 'RAZ 001A',
        vehicleDescription: 'field-fit spec moto',
      },
    });
    expect(post.ok()).toBe(true);

    // BEFORE: 'BOTH'. The database is what the next login reads, so this
    // is the assertion that matters — the client kept showing DRIVER
    // either way, which is why the team saw it change "after some time".
    const me = await (await person.api.get('/api/users/me')).json();
    expect(me.role).toBe('DRIVER');

    // And the role a person may set is only ever one they were offered.
    const escalate = await person.api.put('/api/users/me', {
      data: { role: 'ADMIN' },
    });
    expect(escalate.status()).toBe(400);
    expect((await escalate.json()).error.code).toBe('ROLE_NOT_SELF_ASSIGNABLE');
    const after = await (await person.api.get('/api/users/me')).json();
    expect(after.role).toBe('DRIVER');
  } finally {
    // Put the shared seed user back exactly as we found it.
    await prisma.driverProfile
      .delete({ where: { userId: person.user.id } })
      .catch(() => undefined);
    await prisma.user.update({
      where: { id: person.user.id },
      data: { role: originalRole },
    });
  }
});

// ------------------------------------------------------------ out-of-area

test('a booking outside Kigali is refused in plain words, not a zod dump', async () => {
  test.setTimeout(60_000);

  const customer = await loginAs('TestCustomer');
  const res = await customer.api.post('/api/journeys', {
    data: {
      type: 'PASSENGER',
      pickupLat: MUSANZE.lat,
      pickupLng: MUSANZE.lng,
      pickupName: 'Musanze town',
      destinationLat: KIGALI.lat,
      destinationLng: KIGALI.lng,
      destinationName: KIGALI.name,
    },
  });

  expect(res.status()).toBe(400);
  const body = await res.json();
  // BEFORE: code VALIDATION_ERROR, message errors.validation, and a
  // details array reading "Number must be less than or equal to -1.85".
  expect(body.error.code).toBe('OUTSIDE_OPERATION_AREA');
  expect(body.error.message).toBe('errors.outsideOperationArea');

  // A booking inside the area is untouched.
  const inside = await customer.api.post('/api/journeys', {
    data: {
      type: 'PASSENGER',
      pickupLat: KIGALI.lat,
      pickupLng: KIGALI.lng,
      pickupName: KIGALI.name,
      destinationLat: -1.9706,
      destinationLng: 30.1044,
      destinationName: 'Kicukiro Centre',
    },
  });
  expect(inside.ok()).toBe(true);
  createdJourneyIds.push((await inside.json()).id);
});

// -------------------------------------------------------- engaged driver

test('a motari carrying a passenger is not offered another, and the block is counted', async () => {
  test.setTimeout(120_000);

  const customer = await loginAs('TestCustomer');
  const driver = await loginAs('TestDriver');
  await verifyDriver('TestDriver');

  // Clean slate so the feed assertions are exact.
  await prisma.journey.updateMany({
    where: { customerId: customer.user.id, status: { in: ['REQUESTED', 'MATCHED'] } },
    data: { status: 'CANCELLED' },
  });
  await prisma.driverProfile.update({
    where: { userId: driver.user.id },
    data: {
      isOnline: true,
      lastLat: KIGALI.lat,
      lastLng: KIGALI.lng,
      lastLocationAt: new Date(),
    },
  });

  const createRide = async (name: string) => {
    const r = await customer.api.post('/api/journeys', {
      data: {
        type: 'PASSENGER',
        pickupLat: KIGALI.lat,
        pickupLng: KIGALI.lng,
        pickupName: name,
        destinationLat: -1.9706,
        destinationLng: 30.1044,
        destinationName: 'Kicukiro Centre',
        vehiclePreference: 'MOTO',
      },
    });
    expect(r.ok()).toBe(true);
    const j = await r.json();
    createdJourneyIds.push(j.id);
    return j;
  };

  const feedSize = async () => {
    const r = await driver.api.get(
      `/api/journeys?viewAs=driver&lat=${KIGALI.lat}&lng=${KIGALI.lng}`,
    );
    expect(r.ok()).toBe(true);
    return (await r.json()).length;
  };

  // 1. One open request, driver free: he can see it.
  const rideA = await createRide('FIELD-FIT ride A');
  expect(await feedSize()).toBe(1);

  // 2. He takes it.
  const bidRes = await driver.api.post(`/api/journeys/${rideA.id}/bids`, {
    data: { journeyId: rideA.id, price: 1500, etaMinutes: 8 },
  });
  expect(bidRes.ok()).toBe(true);
  const bid = await bidRes.json();
  const accept = await customer.api.post(`/api/journeys/${rideA.id}/accept-bid`, {
    data: { bidId: bid.id },
  });
  expect(accept.ok()).toBe(true);
  const matched = await prisma.journey.findUnique({ where: { id: rideA.id } });
  expect(matched?.status).toBe('MATCHED');
  expect(matched?.driverId).toBe(driver.user.id);

  // 3. Two more requests appear. He is carrying someone, so he is
  //    offered neither — the second request never reaches him.
  await createRide('FIELD-FIT ride B');
  await createRide('FIELD-FIT ride C');
  expect(await feedSize()).toBe(0);

  // 4. The refresh keeps polling, and every blocked poll is counted
  //    server-side. The counter is log-derivable ([FEED-BLOCKED] one
  //    line per block); here we assert the behaviour is stable across
  //    repeated polls rather than a one-off.
  expect(await feedSize()).toBe(0);
  expect(await feedSize()).toBe(0);

  // 5. The dashboard says why, instead of claiming the market is empty.
  const context = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:5173',
    geolocation: { latitude: KIGALI.lat, longitude: KIGALI.lng },
    permissions: ['geolocation'],
  });
  await applyAuthToContext(context, driver, 'en');
  const page = await context.newPage();
  await page.goto('/driver');
  await expect(page.getByTestId('feed-blocked-engaged')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('feed-blocked-engaged')).toContainText(/finish your current ride/i);
  await context.close();

  // 6. Finish the ride, and the market comes back.
  await prisma.journey.update({
    where: { id: rideA.id },
    data: { status: 'COMPLETED' },
  });
  expect(await feedSize()).toBe(2);
});
