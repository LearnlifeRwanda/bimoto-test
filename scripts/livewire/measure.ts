/**
 * LIVE-WIRE G1 measurement harness.
 *
 * Drives the real HTTP + Socket.io loop against a live local stack and
 * records, per side, the wall-clock from the acting POST to the moment
 * the other side's socket delivers the event that would move its screen.
 *
 * Not a test: it is the instrument. Run it before and after G2.
 */
import { PrismaClient } from '@prisma/client';
import { io as ioClient, type Socket } from 'socket.io-client';
import jwt from 'jsonwebtoken';
const generateAccessToken = (p: { userId: string; role: string }) =>
  jwt.sign(p, process.env.JWT_SECRET as string, { expiresIn: '30m' });

const API = 'http://127.0.0.1:3000';
const prisma = new PrismaClient();

type Transport = 'websocket' | 'polling';

const ITERATIONS = Number(process.env.ITERATIONS ?? 12);
const EVENT_TIMEOUT_MS = Number(process.env.EVENT_TIMEOUT_MS ?? 8000);

function pct(xs: number[], p: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[i];
}

function fmt(xs: number[], attempts: number): string {
  if (!xs.length) return `no event in ${attempts} attempts (timeout ${EVENT_TIMEOUT_MS}ms)`;
  return `p50 ${pct(xs, 50)}ms  p95 ${pct(xs, 95)}ms  (n=${xs.length}/${attempts})`;
}

async function api(path: string, token: string, init: RequestInit = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });
  return res;
}

function connect(token: string, transport: Transport): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = ioClient(API, {
      auth: { token },
      transports: transport === 'websocket' ? ['websocket'] : ['polling'],
      // Forced-fallback run: allow no upgrade, so 'polling' stays polling.
      upgrade: transport === 'websocket',
      reconnection: false,
    });
    const timer = setTimeout(() => reject(new Error(`socket connect timeout (${transport})`)), 10_000);
    s.on('connect', () => {
      clearTimeout(timer);
      resolve(s);
    });
    s.on('connect_error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

function waitFor(
  s: Socket,
  event: string,
): { promise: Promise<{ at: number; payload: any } | null>; cancel: () => void } {
  let handler: (d: unknown) => void;
  let timer: NodeJS.Timeout;
  const promise = new Promise<{ at: number; payload: any } | null>((resolve) => {
    handler = (payload: unknown) => {
      clearTimeout(timer);
      resolve({ at: Date.now(), payload });
    };
    s.once(event, handler);
    timer = setTimeout(() => {
      s.off(event, handler);
      resolve(null);
    }, EVENT_TIMEOUT_MS);
  });
  return { promise, cancel: () => clearTimeout(timer) };
}

async function seedUsers(tag: string) {
  const customer = await prisma.user.create({
    data: {
      phoneEncrypted: `+25078${tag}0001`,
      phoneHash: `hash-cust-${tag}`,
      nickname: `cust-${tag}`,
      role: 'CUSTOMER',
      language: 'en',
    },
  });
  const driver = await prisma.user.create({
    data: {
      phoneEncrypted: `+25078${tag}0002`,
      phoneHash: `hash-drv-${tag}`,
      nickname: `drv-${tag}`,
      role: 'DRIVER',
      language: 'en',
      driverProfile: {
        create: {
          vehicleType: 'MOTO',
          vehicleDescription: 'red moto',
          registrationPlate: `RA${tag}A`,
          verificationStatus: 'VERIFIED',
          isOnline: true,
          lastLat: -1.9441,
          lastLng: 30.0619,
          lastLocationAt: new Date(),
        },
      },
    },
  });
  return { customer, driver };
}

async function makeJourney(customerId: string) {
  return prisma.journey.create({
    data: {
      customerId,
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
}

interface Row {
  transport: Transport;
  bidToPassenger: number[];
  bidAttempts: number;
  acceptToDriver: number[];
  acceptAttempts: number;
  acceptToDriverUserRoom: number[];
  /** Fields the passenger's list renders, present on the SOCKET payload. */
  socketPayloadHasDriver: boolean[];
  /** Server refusals of the bidding driver's journey-room join. */
  driverJoinRefusals: number;
}

async function runTransport(transport: Transport): Promise<Row> {
  const tag = Math.floor(Math.random() * 8999 + 1000).toString();
  const { customer, driver } = await seedUsers(tag);
  const custToken = generateAccessToken({ userId: customer.id, role: 'CUSTOMER' });
  const drvToken = generateAccessToken({ userId: driver.id, role: 'DRIVER' });

  const custSock = await connect(custToken, transport);
  const drvSock = await connect(drvToken, transport);

  const row: Row = {
    transport,
    bidToPassenger: [],
    bidAttempts: 0,
    acceptToDriver: [],
    acceptAttempts: 0,
    acceptToDriverUserRoom: [],
    socketPayloadHasDriver: [],
    driverJoinRefusals: 0,
  };

  drvSock.on('error', (e: any) => {
    if (e?.code === 'unauthorised-journey') row.driverJoinRefusals++;
  });

  for (let i = 0; i < ITERATIONS; i++) {
    const journey = await makeJourney(customer.id);

    // Passenger joins the journey room exactly as BidListPage does.
    await new Promise<void>((resolve) => {
      custSock.emit('join-journey', { journeyId: journey.id });
      setTimeout(resolve, 250);
    });
    // Driver attempts the same join BidPage performs.
    drvSock.emit('join-journey', { journeyId: journey.id });
    await new Promise((r) => setTimeout(r, 250));

    // --- A. bid placed -> passenger's list ---
    const placed = waitFor(custSock, 'bid-placed');
    row.bidAttempts++;
    const t0 = Date.now();
    const bidRes = await api(`/api/journeys/${journey.id}/bids`, drvToken, {
      method: 'POST',
      body: JSON.stringify({ price: 1300, etaMinutes: 6 }),
    });
    if (!bidRes.ok) {
      console.error('bid failed', bidRes.status, await bidRes.text());
      continue;
    }
    const bid = await bidRes.json();
    const placedEvt = await placed.promise;
    if (placedEvt !== null) {
      row.bidToPassenger.push(placedEvt.at - t0);
      row.socketPayloadHasDriver.push(
        placedEvt.payload?.driver?.nickname !== undefined,
      );
    }

    // --- B. accept -> driver's surface ---
    const acceptedJourneyRoom = waitFor(drvSock, 'bid-accepted');
    row.acceptAttempts++;
    const t1 = Date.now();
    const accRes = await api(`/api/journeys/${journey.id}/accept-bid`, custToken, {
      method: 'POST',
      body: JSON.stringify({ bidId: bid.id }),
    });
    if (!accRes.ok) {
      console.error('accept failed', accRes.status, await accRes.text());
      acceptedJourneyRoom.cancel();
      continue;
    }
    const accEvt = await acceptedJourneyRoom.promise;
    if (accEvt !== null) row.acceptToDriver.push(accEvt.at - t1);

    custSock.emit('leave-journey', { journeyId: journey.id });
    drvSock.emit('leave-journey', { journeyId: journey.id });
  }

  custSock.disconnect();
  drvSock.disconnect();
  return row;
}

async function main() {
  const results: Row[] = [];
  for (const transport of ['websocket', 'polling'] as Transport[]) {
    console.log(`\n--- transport: ${transport} ---`);
    results.push(await runTransport(transport));
  }

  console.log('\n================ LIVE-WIRE measurement ================');
  for (const r of results) {
    console.log(`transport=${r.transport}`);
    console.log(`  bid POST      -> passenger 'bid-placed'  : ${fmt(r.bidToPassenger, r.bidAttempts)}`);
    console.log(`  accept POST   -> driver 'bid-accepted'   : ${fmt(r.acceptToDriver, r.acceptAttempts)}`);
    const complete = r.socketPayloadHasDriver.filter(Boolean).length;
    console.log(
      `  socket bid payload carries driver{}     : ${complete}/${r.socketPayloadHasDriver.length}`,
    );
    console.log(`  bidding driver journey-room joins refused: ${r.driverJoinRefusals}/${r.bidAttempts}`);
  }
  console.log('=======================================================');
  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
