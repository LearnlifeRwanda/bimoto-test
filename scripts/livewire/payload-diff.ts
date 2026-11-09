/**
 * LIVE-WIRE G4 acceptance evidence.
 *
 * Fetches the SAME bid, on the SAME journey, through the SAME endpoint,
 * as the customer and as the bidding driver, and prints both payloads
 * plus the key-level diff. The unit suite asserts this; this prints it,
 * so the claim "the passenger sees only their price" can be read rather
 * than taken on trust.
 */
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';

const API = 'http://127.0.0.1:3000';
const prisma = new PrismaClient();
const token = (p: { userId: string; role: string }) =>
  jwt.sign(p, process.env.JWT_SECRET as string, { expiresIn: '30m' });

async function get(path: string, t: string) {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
  });
  return { status: res.status, body: await res.json() };
}

async function main() {
  const tag = Math.floor(Math.random() * 8999 + 1000).toString();
  const customer = await prisma.user.create({
    data: {
      phoneEncrypted: `+25079${tag}0001`,
      phoneHash: `pd-cust-${tag}`,
      nickname: `cust-${tag}`,
      role: 'CUSTOMER',
      language: 'en',
      completedRides: 50,
    },
  });
  const driver = await prisma.user.create({
    data: {
      phoneEncrypted: `+25079${tag}0002`,
      phoneHash: `pd-drv-${tag}`,
      nickname: `Jean-${tag}`,
      role: 'DRIVER',
      language: 'en',
      driverProfile: {
        create: {
          vehicleType: 'MOTO',
          vehicleDescription: 'red moto',
          registrationPlate: `RB${tag}A`,
          verificationStatus: 'VERIFIED',
          isOnline: true,
          totalRides: 200,
          lastLat: -1.9441,
          lastLng: 30.0619,
          lastLocationAt: new Date(),
        },
      },
    },
  });
  const journey = await prisma.journey.create({
    data: {
      customerId: customer.id,
      type: 'PASSENGER',
      status: 'REQUESTED',
      pickupLat: -1.9441,
      pickupLng: 30.0619,
      pickupName: 'Nyabugogo',
      destinationLat: -1.9536,
      destinationLng: 30.0606,
      destinationName: 'Kimironko',
      wishPrice: 1200,
      discoveryStartedAt: new Date(),
    },
  });

  const custToken = token({ userId: customer.id, role: 'CUSTOMER' });
  const drvToken = token({ userId: driver.id, role: 'DRIVER' });

  await fetch(`${API}/api/journeys/${journey.id}/bids`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${drvToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ price: 1200, etaMinutes: 6 }),
  });

  const asCustomer = await get(`/api/journeys/${journey.id}/bids`, custToken);
  const asDriver = await get(`/api/journeys/${journey.id}/bids`, drvToken);

  const c = asCustomer.body[0];
  const d = asDriver.body[0];

  console.log('\n=== GET /api/journeys/:id/bids — SAME bid, two roles ===\n');
  console.log('--- as the CUSTOMER (the passenger) ---');
  console.log(JSON.stringify(c, null, 2));
  console.log('\n--- as the DRIVER who placed it ---');
  console.log(JSON.stringify(d, null, 2));

  const ck = new Set(Object.keys(c ?? {}));
  const dk = new Set(Object.keys(d ?? {}));
  console.log('\n--- keys present for the DRIVER and withheld from the CUSTOMER ---');
  console.log([...dk].filter((k) => !ck.has(k)));
  console.log('--- keys present for the CUSTOMER and withheld from the DRIVER ---');
  console.log([...ck].filter((k) => !dk.has(k)));

  const leak = JSON.stringify(c ?? {});
  const forbidden = [
    'driverPayout',
    'driverCommissionRate',
    'driverSavings',
    'totalCommissionAmount',
    'totalCommissionRate',
  ].filter((k) => leak.includes(k));
  console.log('\ncommission fields reachable in the CUSTOMER response:', forbidden);

  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
