jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    syncEvent: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
    },
    journey: {
      findUnique: jest.fn(),
    },
    gpsPoint: {
      findMany: jest.fn(),
      createMany: jest.fn(),
    },
  },
}));

import prisma from '../prisma';
import * as syncService from '../services/sync.service';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Sync Service', () => {
  describe('processEvents', () => {
    test('processes new events and returns processed ids', async () => {
      (mockPrisma.syncEvent.findUnique as jest.Mock).mockResolvedValue(null);
      (mockPrisma.syncEvent.create as jest.Mock).mockResolvedValue({});

      const events = [
        {
          clientEventId: 'evt-1',
          eventType: 'JOURNEY_CREATED',
          payload: { pickupName: 'Kigali' },
          clientTimestamp: '2026-03-17T10:00:00Z',
        },
        {
          clientEventId: 'evt-2',
          eventType: 'BID_PLACED',
          payload: { price: 1500 },
          clientTimestamp: '2026-03-17T10:01:00Z',
        },
      ];

      const result = await syncService.processEvents('u1', events);

      expect(result.processed).toEqual(['evt-1', 'evt-2']);
      expect(result.rejected).toEqual([]);
      expect(mockPrisma.syncEvent.create).toHaveBeenCalledTimes(2);
    });

    test('deduplicates events by clientEventId', async () => {
      // First call: event already exists; second call: new event
      (mockPrisma.syncEvent.findUnique as jest.Mock)
        .mockResolvedValueOnce({ id: 'existing', clientEventId: 'evt-1' })
        .mockResolvedValueOnce(null);
      (mockPrisma.syncEvent.create as jest.Mock).mockResolvedValue({});

      const events = [
        {
          clientEventId: 'evt-1',
          eventType: 'JOURNEY_CREATED',
          payload: {},
          clientTimestamp: '2026-03-17T10:00:00Z',
        },
        {
          clientEventId: 'evt-2',
          eventType: 'BID_PLACED',
          payload: {},
          clientTimestamp: '2026-03-17T10:01:00Z',
        },
      ];

      const result = await syncService.processEvents('u1', events);

      // Both are "processed" but only evt-2 triggers a create
      expect(result.processed).toEqual(['evt-1', 'evt-2']);
      expect(mockPrisma.syncEvent.create).toHaveBeenCalledTimes(1);
    });

    test('captures errors as rejections', async () => {
      (mockPrisma.syncEvent.findUnique as jest.Mock).mockResolvedValue(null);
      (mockPrisma.syncEvent.create as jest.Mock).mockRejectedValue(
        new Error('DB constraint violation'),
      );

      const events = [
        {
          clientEventId: 'evt-bad',
          eventType: 'INVALID_TYPE',
          payload: {},
          clientTimestamp: '2026-03-17T10:00:00Z',
        },
      ];

      const result = await syncService.processEvents('u1', events);

      expect(result.processed).toEqual([]);
      expect(result.rejected).toEqual([
        {
          clientEventId: 'evt-bad',
          code: 'UNKNOWN',
          message: 'DB constraint violation',
        },
      ]);
    });

    test('sorts events by clientTimestamp before processing', async () => {
      const callOrder: string[] = [];
      (mockPrisma.syncEvent.findUnique as jest.Mock).mockResolvedValue(null);
      (mockPrisma.syncEvent.create as jest.Mock).mockImplementation(async ({ data }) => {
        callOrder.push(data.clientEventId);
        return {};
      });

      const events = [
        {
          clientEventId: 'evt-later',
          eventType: 'BID_PLACED',
          payload: {},
          clientTimestamp: '2026-03-17T11:00:00Z',
        },
        {
          clientEventId: 'evt-earlier',
          eventType: 'JOURNEY_CREATED',
          payload: {},
          clientTimestamp: '2026-03-17T09:00:00Z',
        },
      ];

      await syncService.processEvents('u1', events);

      expect(callOrder).toEqual(['evt-earlier', 'evt-later']);
    });
  });

  describe('saveGpsBatch', () => {
    test('saves new GPS points for an existing journey', async () => {
      (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue({
        id: 'j1',
        customerId: 'u1',
        driverId: 'd1',
      });
      (mockPrisma.gpsPoint.findMany as jest.Mock).mockResolvedValue([]);
      (mockPrisma.gpsPoint.createMany as jest.Mock).mockResolvedValue({ count: 3 });

      const points = [
        { lat: -1.95, lng: 29.87, timestamp: '2026-03-17T10:00:00Z' },
        { lat: -1.951, lng: 29.871, timestamp: '2026-03-17T10:00:10Z' },
        { lat: -1.952, lng: 29.872, timestamp: '2026-03-17T10:00:20Z' },
      ];

      const result = await syncService.saveGpsBatch('j1', points, 'd1');

      expect(result.saved).toBe(3);
      expect(mockPrisma.gpsPoint.createMany).toHaveBeenCalledTimes(1);
    });

    test('deduplicates GPS points by timestamp', async () => {
      (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue({
        id: 'j1',
        customerId: 'u1',
        driverId: 'd1',
      });
      (mockPrisma.gpsPoint.findMany as jest.Mock).mockResolvedValue([
        { timestamp: new Date('2026-03-17T10:00:00Z') },
      ]);
      (mockPrisma.gpsPoint.createMany as jest.Mock).mockResolvedValue({ count: 1 });

      const points = [
        { lat: -1.95, lng: 29.87, timestamp: '2026-03-17T10:00:00Z' }, // duplicate
        { lat: -1.951, lng: 29.871, timestamp: '2026-03-17T10:00:10Z' }, // new
      ];

      const result = await syncService.saveGpsBatch('j1', points, 'd1');

      expect(result.saved).toBe(1);
    });

    test('returns saved: 0 when all points are duplicates', async () => {
      (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue({
        id: 'j1',
        customerId: 'u1',
        driverId: 'd1',
      });
      (mockPrisma.gpsPoint.findMany as jest.Mock).mockResolvedValue([
        { timestamp: new Date('2026-03-17T10:00:00Z') },
      ]);

      const points = [
        { lat: -1.95, lng: 29.87, timestamp: '2026-03-17T10:00:00Z' },
      ];

      const result = await syncService.saveGpsBatch('j1', points, 'd1');

      expect(result.saved).toBe(0);
      expect(mockPrisma.gpsPoint.createMany).not.toHaveBeenCalled();
    });

    test('throws when journey not found', async () => {
      (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(syncService.saveGpsBatch('j-missing', [], 'd1'))
        .rejects.toThrow('errors.journeyNotFound');
    });

    // LOOSE-ENDS G5 — this used to check only that the journey EXISTED,
    // so any authenticated token could write position points into
    // anyone's ride. The read leg (getEventsSince) has always scoped
    // itself to customerId | driverId; the write leg now does too.
    describe('participation gate', () => {
      const points = [{ lat: -1.95, lng: 29.87, timestamp: '2026-03-17T10:00:00Z' }];

      beforeEach(() => {
        (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue({
          id: 'j1',
          customerId: 'u1',
          driverId: 'd1',
        });
        (mockPrisma.gpsPoint.findMany as jest.Mock).mockResolvedValue([]);
        (mockPrisma.gpsPoint.createMany as jest.Mock).mockResolvedValue({ count: 1 });
      });

      test.each([
        ['the motari riding it', 'd1'],
        ['the passenger on it', 'u1'],
      ])('%s writes exactly as before', async (_who, userId) => {
        const result = await syncService.saveGpsBatch('j1', points, userId);
        expect(result.saved).toBe(1);
        expect(mockPrisma.gpsPoint.createMany).toHaveBeenCalledTimes(1);
      });

      test('a stranger is refused, and writes nothing', async () => {
        await expect(syncService.saveGpsBatch('j1', points, 'x9')).rejects.toMatchObject({
          statusCode: 403,
          code: 'FORBIDDEN',
        });
        expect(mockPrisma.gpsPoint.createMany).not.toHaveBeenCalled();
      });

      test('an unmatched journey admits its customer and refuses everyone else', async () => {
        (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue({
          id: 'j1',
          customerId: 'u1',
          driverId: null,
        });

        await expect(syncService.saveGpsBatch('j1', points, 'u1')).resolves.toEqual({ saved: 1 });
        await expect(syncService.saveGpsBatch('j1', points, 'd1')).rejects.toMatchObject({
          statusCode: 403,
        });
      });

      test('a missing journey still 404s — existence is checked before participation', async () => {
        (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue(null);
        await expect(syncService.saveGpsBatch('j-missing', points, 'x9')).rejects.toMatchObject({
          statusCode: 404,
        });
      });
    });
  });
});
