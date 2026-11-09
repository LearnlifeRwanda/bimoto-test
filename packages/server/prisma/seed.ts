import { PrismaClient } from '@prisma/client';
import {
  KIGALI_LANDMARKS,
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
} from '@bimoto/shared';
import crypto from 'crypto';
import {
  assertSeedAllowed,
  resolveSeedEncryptionKey,
  shouldSeedDevAdmin,
} from '../src/seed-guards';

const prisma = new PrismaClient();

// Replicate crypto utils for seeding (avoid config dependency)
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;

// PILOT-GUARD Item 3 — no fallback key. See src/seed-guards.ts: the old
// `process.env.ENCRYPTION_KEY || 'a'.repeat(64)` did not fail, it wrote
// ciphertext the real server cannot decrypt.
function getKey(): Buffer {
  return Buffer.from(resolveSeedEncryptionKey(process.env.ENCRYPTION_KEY), 'hex');
}

function encrypt(text: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();
  return iv.toString('hex') + ':' + encrypted + ':' + tag.toString('hex');
}

function hashPhone(phone: string): string {
  return crypto.createHash('sha256').update(phone).digest('hex');
}

async function main() {
  // PILOT-GUARD Item 3 — refuse before touching anything.
  //
  // Ordered cheapest-first on purpose: the two refusals that need no
  // database answer without one, so `NODE_ENV=production` and a missing
  // ENCRYPTION_KEY are refused even when DATABASE_URL points nowhere.
  assertSeedAllowed({ NODE_ENV: process.env.NODE_ENV, existingUserCount: 0 });
  // Fail on a missing or malformed key here rather than on the first
  // encrypt(), so the refusal arrives before any row is written.
  resolveSeedEncryptionKey(process.env.ENCRYPTION_KEY);
  // A database that already holds users is a live one, not a fixture.
  assertSeedAllowed({
    NODE_ENV: process.env.NODE_ENV,
    existingUserCount: await prisma.user.count(),
  });

  console.log('Seeding Bimoto database...');

  // Log Kigali landmarks (stored in shared, not in DB)
  console.log(`\nKigali Landmarks (${KIGALI_LANDMARKS.length} total):`);
  for (const landmark of KIGALI_LANDMARKS) {
    console.log(`  - ${landmark.name} [${landmark.category}] (${landmark.point.lat}, ${landmark.point.lng})`);
  }

  // Create test customer
  const customerPhone = '+250781234567';
  const customer = await prisma.user.upsert({
    where: { phoneHash: hashPhone(customerPhone) },
    update: {},
    create: {
      phoneEncrypted: encrypt(customerPhone),
      phoneHash: hashPhone(customerPhone),
      nickname: 'TestCustomer',
      role: 'CUSTOMER',
      language: 'rw',
    },
  });
  console.log(`\nCreated test customer: ${customer.nickname} (${customer.id})`);

  // Create test driver
  const driverPhone = '+250789876543';
  const driver = await prisma.user.upsert({
    where: { phoneHash: hashPhone(driverPhone) },
    update: {},
    create: {
      phoneEncrypted: encrypt(driverPhone),
      phoneHash: hashPhone(driverPhone),
      nickname: 'TestDriver',
      role: 'BOTH',
      language: 'en',
    },
  });
  console.log(`Created test driver: ${driver.nickname} (${driver.id})`);

  // Create driver profile (MOTO)
  await prisma.driverProfile.upsert({
    where: { userId: driver.id },
    update: {},
    create: {
      userId: driver.id,
      vehicleType: 'MOTO',
      registrationPlate: 'RAC 123A',
      vehicleDescription: 'Honda CB125 - Red',
      isOnline: true,
      lastLat: -1.9500,
      lastLng: 29.8739,
      lastLocationAt: new Date(),
    },
  });
  console.log(`Created driver profile for ${driver.nickname} (MOTO, plate RAC 123A)`);

  // Create test BOTH user (can be customer and driver)
  const bothPhone = '+250782345678';
  const bothUser = await prisma.user.upsert({
    where: { phoneHash: hashPhone(bothPhone) },
    update: {},
    create: {
      phoneEncrypted: encrypt(bothPhone),
      phoneHash: hashPhone(bothPhone),
      nickname: 'TestBothUser',
      role: 'BOTH',
      language: 'fr',
      completedRides: 15,
    },
  });
  console.log(`Created BOTH user: ${bothUser.nickname} (${bothUser.id})`);

  // Create driver profile for BOTH user (BIKE)
  await prisma.driverProfile.upsert({
    where: { userId: bothUser.id },
    update: {},
    create: {
      userId: bothUser.id,
      vehicleType: 'BIKE',
      vehicleDescription: 'Mountain Bike - Blue',
      isOnline: false,
      lastLat: -1.9571,
      lastLng: 29.8935,
      lastLocationAt: new Date(),
    },
  });
  console.log(`Created driver profile for ${bothUser.nickname} (BIKE)`);

  // Create E_BIKE test driver
  const ebikePhone = '+250781000004';
  const ebikeDriver = await prisma.user.upsert({
    where: { phoneHash: hashPhone(ebikePhone) },
    update: {},
    create: {
      phoneEncrypted: encrypt(ebikePhone),
      phoneHash: hashPhone(ebikePhone),
      nickname: 'EBikeJean',
      role: 'DRIVER',
      language: 'rw',
    },
  });
  console.log(`Created E_BIKE driver: ${ebikeDriver.nickname} (${ebikeDriver.id})`);

  await prisma.driverProfile.upsert({
    where: { userId: ebikeDriver.id },
    update: {},
    create: {
      userId: ebikeDriver.id,
      vehicleType: 'E_BIKE',
      vehicleDescription: 'Green electric bicycle with front basket',
      verificationStatus: 'VERIFIED', // E_BIKE doesn't require verification currently
      isOnline: true,
      lastLat: -1.9520,
      lastLng: 29.8800,
      lastLocationAt: new Date(),
    },
  });
  console.log(`Created driver profile for ${ebikeDriver.nickname} (E_BIKE)`);

  // Create a sample completed journey with agreed price (for fair price testing)
  const sampleJourney = await prisma.journey.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      customerId: customer.id,
      driverId: driver.id,
      type: 'PASSENGER',
      status: 'COMPLETED',
      pickupLat: -1.9500,
      pickupLng: 29.8739,
      pickupName: 'Kigali Heights',
      destinationLat: -1.9486,
      destinationLng: 29.8996,
      destinationName: 'Kimironko Market',
      agreedPrice: 1500,
      commissionAmount: 75,
      estimatedDistance: 3.2,
      startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      endedAt: new Date(Date.now() - 1.5 * 60 * 60 * 1000),
      confirmedAt: new Date(Date.now() - 1 * 60 * 60 * 1000),
    },
  });
  console.log(`Created sample completed journey: ${sampleJourney.id}`);

  // Create escrow for the completed journey
  await prisma.escrow.upsert({
    where: { journeyId: sampleJourney.id },
    update: {},
    create: {
      journeyId: sampleJourney.id,
      customerId: customer.id,
      driverId: driver.id,
      amount: 1500,
      commission: 75,
      driverPayout: 1425,
      status: 'RELEASED',
      releasedAt: new Date(Date.now() - 1 * 60 * 60 * 1000),
    },
  });
  console.log(`Created escrow for completed journey`);

  // Create a sample rating for the completed journey
  await prisma.rating.upsert({
    where: { journeyId_raterId: { journeyId: sampleJourney.id, raterId: customer.id } },
    update: {},
    create: {
      journeyId: sampleJourney.id,
      raterId: customer.id,
      ratedId: driver.id,
      stars: 5,
      comment: 'Great ride, very safe driver!',
    },
  });
  console.log(`Created sample rating (5 stars)`);

  // PILOT-GUARD Item 3 — the fixed-phone ADMIN leaves the default path.
  //
  // '+250780000000' is published in this repo, in the runbook, and in the
  // e2e helpers. Under SMS_MODE=simulated — the configuration the runbook
  // recommends for a keyless pilot — its login OTP lands in the /api/sim
  // inbox, so anyone who can read that inbox becomes an administrator.
  // CI's e2e job needs the account and asks for it explicitly
  // (SEED_DEV_ADMIN=1 in .github/workflows/e2e.yml); an operator
  // following the runbook does not get one.
  const seedDevAdmin = shouldSeedDevAdmin(process.env.SEED_DEV_ADMIN);
  const adminPhone = '+250780000000';
  const admin = seedDevAdmin
    ? await prisma.user.upsert({
        where: { phoneHash: hashPhone(adminPhone) },
        update: {},
        create: {
          phoneEncrypted: encrypt(adminPhone),
          phoneHash: hashPhone(adminPhone),
          nickname: 'Admin',
          role: 'ADMIN',
          language: 'en',
        },
      })
    : null;
  if (admin) {
    console.log(`Created admin user: ${admin.nickname} (${admin.id})`);
  } else {
    console.log(
      'Skipped the fixed-phone ADMIN account (set SEED_DEV_ADMIN=1 to create ' +
        'it — dev and CI only; it logs in on a published number).',
    );
  }

  // INTEL-DECK G4 — the read-only intelligence account.
  //
  // Deliberately separate from the admin above: the point of the role is
  // that the person who reads Kigali's demand curve is NOT the person who
  // can read a passenger's phone number. This account logs in, lands on
  // /intel, and every other guard in the product refuses it. Consent is
  // pre-stamped so a demo login reaches the reading room in one step.
  //
  // PILOT-GUARD Item 3 — gated with the ADMIN for the same reason. This
  // is a second fixed, published phone attached to a privileged role: it
  // cannot read a passenger's number, but it can read the whole city's
  // demand curve, and its OTP lands in the same simulated inbox.
  const analystPhone = '+250780000001';
  const analyst = seedDevAdmin
    ? await prisma.user.upsert({
        where: { phoneHash: hashPhone(analystPhone) },
        update: {},
        create: {
          phoneEncrypted: encrypt(analystPhone),
          phoneHash: hashPhone(analystPhone),
          nickname: 'Analyst',
          role: 'ANALYST',
          language: 'en',
          privacyConsentAt: new Date(),
          privacyConsentVersion: CURRENT_PRIVACY_VERSION,
          termsAcceptedAt: new Date(),
          termsAcceptedVersion: CURRENT_TERMS_VERSION,
        },
      })
    : null;
  if (analyst) {
    console.log(`Created analyst user: ${analyst.nickname} (${analyst.id})`);
  } else {
    console.log('Skipped the fixed-phone ANALYST account (SEED_DEV_ADMIN=1 creates it).');
  }

  // -------------------------------------------------------------------------
  // PREPROTO-SIM G5 — pilot demo accounts.
  //
  // Five employee-customer accounts for the pre-prototype run (consent
  // pre-stamped so a pilot login lands straight on the journey screen),
  // the seeded drivers pushed to VERIFIED (jacket number + plate + insurance,
  // the fields driver-verification.service requires), and a starting
  // simulated wallet balance so the payout path has something to move.
  // Everything below is upsert-idempotent: re-running the seed never
  // duplicates accounts and never clobbers balances a pilot has accrued.
  // -------------------------------------------------------------------------

  const consentStamp = {
    privacyConsentAt: new Date(),
    privacyConsentVersion: CURRENT_PRIVACY_VERSION,
    termsAcceptedAt: new Date(),
    termsAcceptedVersion: CURRENT_TERMS_VERSION,
  };

  const employees: { phone: string; nickname: string; language: 'rw' | 'en' | 'fr' }[] = [
    { phone: '+250781000101', nickname: 'PilotEmployee1', language: 'rw' },
    { phone: '+250781000102', nickname: 'PilotEmployee2', language: 'en' },
    { phone: '+250781000103', nickname: 'PilotEmployee3', language: 'fr' },
    { phone: '+250781000104', nickname: 'PilotEmployee4', language: 'rw' },
    { phone: '+250781000105', nickname: 'PilotEmployee5', language: 'en' },
  ];
  for (const emp of employees) {
    const user = await prisma.user.upsert({
      where: { phoneHash: hashPhone(emp.phone) },
      update: {},
      create: {
        phoneEncrypted: encrypt(emp.phone),
        phoneHash: hashPhone(emp.phone),
        nickname: emp.nickname,
        role: 'CUSTOMER',
        language: emp.language,
        ...consentStamp,
      },
    });
    console.log(`Created pilot employee customer: ${user.nickname} (${emp.phone})`);
  }

  // Verify the seeded drivers. `update` (not just `create`) so re-running
  // the seed also repairs an existing database where they are still
  // PENDING. Jacket numbers are fixed values — idempotent under the
  // unique constraint.
  const driverVerifications: { userId: string; jacket: string; plate: string | null }[] = [
    { userId: driver.id, jacket: 'BM-SIM-001', plate: 'RAC 123A' },
    { userId: bothUser.id, jacket: 'BM-SIM-002', plate: null }, // BIKE — no plate required
    { userId: ebikeDriver.id, jacket: 'BM-SIM-003', plate: null }, // E_BIKE
  ];
  for (const v of driverVerifications) {
    await prisma.driverProfile.update({
      where: { userId: v.userId },
      data: {
        verificationStatus: 'VERIFIED',
        verifiedAt: new Date(),
        ruraAuthorizationNumber: v.jacket,
        ...(v.plate ? { registrationPlate: v.plate } : {}),
        insuranceConfirmed: true,
      },
    });
    // Consent for drivers too — pilot drivers log in like everyone else.
    await prisma.user.update({ where: { id: v.userId }, data: consentStamp });
    console.log(`Verified driver profile ${v.jacket} (user ${v.userId})`);
  }

  // Starting simulated wallet balance (pending payout). Create-only:
  // upsert with update:{} so a re-seed never resets a balance the
  // simulated settlement flow has since changed.
  for (const v of driverVerifications) {
    await prisma.driverBalance.upsert({
      where: { driverId: v.userId },
      update: {},
      create: { driverId: v.userId, pendingAmount: 5000 },
    });
  }
  console.log('Seeded starting driver balances (5000 RWF pending each)');

  // Stamp consent on the original customer + admin as well.
  await prisma.user.update({ where: { id: customer.id }, data: consentStamp });
  if (admin) {
    await prisma.user.update({ where: { id: admin.id }, data: consentStamp });
  }

  console.log('\nSeed completed successfully!');
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
