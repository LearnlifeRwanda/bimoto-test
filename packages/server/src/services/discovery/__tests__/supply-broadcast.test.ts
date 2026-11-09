import {
  broadcastToRingDrivers,
  scheduleCascadeBroadcasts,
  _resetNotifiedRegistryForTests,
} from '../supply-broadcast';
import { _resetTierConfigForTests } from '../../mobility/tier-classification';

const KIGALI = { lat: -1.9536, lng: 30.0606 }; // DENSE
const RURAL = { lat: -2.0, lng: 28.5 }; // SPARSE

function makePrismaWithDrivers(
  rows: Array<{
    userId: string;
    lastLat: number;
    lastLng: number;
  }>,
) {
  return {
    driverProfile: {
      findMany: jest.fn().mockResolvedValue(rows),
    },
  } as any;
}

function makeIo() {
  const emit = jest.fn();
  const to = jest.fn().mockReturnValue({ emit });
  return {
    io: { to } as any,
    spies: { to, emit },
  };
}

beforeEach(() => {
  _resetNotifiedRegistryForTests();
  _resetTierConfigForTests();
});

describe('discovery/supply-broadcast — broadcastToRingDrivers', () => {
  it('emits journey:available to user:<id> rooms for in-ring drivers', async () => {
    const prisma = makePrismaWithDrivers([
      { userId: 'd1', lastLat: KIGALI.lat + 0.0001, lastLng: KIGALI.lng },
      { userId: 'd2', lastLat: KIGALI.lat - 0.0001, lastLng: KIGALI.lng },
    ]);
    const { io, spies } = makeIo();
    const newlyNotified = await broadcastToRingDrivers({
      prisma,
      io,
      journeyId: 'jX',
      pickup: KIGALI,
      ringRadiusMeters: 200,
    });
    expect(newlyNotified.sort()).toEqual(['d1', 'd2']);
    expect(spies.to).toHaveBeenCalledWith('user:d1');
    expect(spies.to).toHaveBeenCalledWith('user:d2');
    expect(spies.emit).toHaveBeenCalledWith('journey:available', {
      journeyId: 'jX',
    });
  });

  it('does not double-notify drivers across ring expansions', async () => {
    const prisma = makePrismaWithDrivers([
      { userId: 'd1', lastLat: KIGALI.lat + 0.0001, lastLng: KIGALI.lng },
    ]);
    const { io } = makeIo();
    const first = await broadcastToRingDrivers({
      prisma,
      io,
      journeyId: 'jY',
      pickup: KIGALI,
      ringRadiusMeters: 200,
    });
    const second = await broadcastToRingDrivers({
      prisma,
      io,
      journeyId: 'jY',
      pickup: KIGALI,
      ringRadiusMeters: 500,
    });
    expect(first).toEqual(['d1']);
    expect(second).toEqual([]);
  });

  it('queries with frozenAt:null so frozen drivers are not selected', async () => {
    const prisma = makePrismaWithDrivers([]);
    await broadcastToRingDrivers({
      prisma,
      io: null,
      journeyId: 'jZ',
      pickup: KIGALI,
      ringRadiusMeters: 200,
    });
    const where = prisma.driverProfile.findMany.mock.calls[0][0].where;
    expect(where.user).toEqual({ frozenAt: null });
    expect(where.isOnline).toBe(true);
    expect(where.lastLocationAt).toBeDefined();
  });

  it('with no-limit ring (-1), every fresh+online driver is notified', async () => {
    const prisma = makePrismaWithDrivers([
      { userId: 'far1', lastLat: 1, lastLng: 1 },
      { userId: 'far2', lastLat: -1, lastLng: -1 },
    ]);
    const { io } = makeIo();
    const newlyNotified = await broadcastToRingDrivers({
      prisma,
      io,
      journeyId: 'jSparse',
      pickup: RURAL,
      ringRadiusMeters: -1,
    });
    expect(newlyNotified.sort()).toEqual(['far1', 'far2']);
  });
});

describe('discovery/supply-broadcast — scheduleCascadeBroadcasts (DENSE)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('fires 4 broadcasts at 0/30/60/90s for a Kigali pickup', async () => {
    const prisma = makePrismaWithDrivers([]);
    const { io } = makeIo();
    const handle = scheduleCascadeBroadcasts({
      prisma,
      io,
      journeyId: 'jD',
      pickup: KIGALI,
      discoveryStartedAt: new Date(),
    });
    expect(handle.timers.length).toBe(3); // ring 0 fires sync; rings 1-3 are scheduled

    // Ring 0 fired immediately
    expect(prisma.driverProfile.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.driverProfile.findMany.mock.calls[0][0].where.lastLat).toMatchObject({
      gte: expect.any(Number),
      lte: expect.any(Number),
    });

    jest.advanceTimersByTime(30_000);
    await Promise.resolve();
    expect(prisma.driverProfile.findMany).toHaveBeenCalledTimes(2);

    jest.advanceTimersByTime(30_000);
    await Promise.resolve();
    expect(prisma.driverProfile.findMany).toHaveBeenCalledTimes(3);

    jest.advanceTimersByTime(30_000);
    await Promise.resolve();
    expect(prisma.driverProfile.findMany).toHaveBeenCalledTimes(4);
  });

  it('cancel() clears all pending ring broadcasts', async () => {
    const prisma = makePrismaWithDrivers([]);
    const { io } = makeIo();
    const handle = scheduleCascadeBroadcasts({
      prisma,
      io,
      journeyId: 'jCancel',
      pickup: KIGALI,
      discoveryStartedAt: new Date(),
    });
    handle.cancel();
    jest.advanceTimersByTime(120_000);
    await Promise.resolve();
    // Only the immediate ring 0 fired; everything else cancelled.
    expect(prisma.driverProfile.findMany).toHaveBeenCalledTimes(1);
  });
});
