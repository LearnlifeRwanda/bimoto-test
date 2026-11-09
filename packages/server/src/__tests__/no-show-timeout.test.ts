// R3-N-2 — no-show-timeout cron tests.
//
// Covers:
//   Reminder pass:
//     - sends one reminder per matched journey older than 20 min with
//       noShowReminderSentAt:null
//     - does NOT re-send reminders to journeys with
//       noShowReminderSentAt already set
//     - WHERE filter excludes journeys < 20 min matched
//     - WHERE filter excludes journeys with startedAt set
//   Auto-cancel pass:
//     - selects only journeys MATCHED >= 30 min with startedAt:null
//     - derivation: no GPS points → DRIVER_NO_SHOW
//     - derivation: GPS within 50 m + recent broadcast → CUSTOMER_NO_SHOW
//     - derivation: GPS > 500 m + stale broadcast → DRIVER_NO_SHOW
//     - derivation: mixed signals → BOTH_NO_SHOW
//     - applyCancelAttribution called inside the same tx as the
//       journey update with the derived reason
//     - journey transitioned to CANCELLED with cancelReason set
//     - escrow refunded for HELD escrow
//     - emitToJourney called with journey-cancelled
//     - idempotency: status filter excludes already-cancelled rows

jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    journey: {
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
    },
    gpsPoint: { findFirst: jest.fn().mockResolvedValue(null) },
    user: { update: jest.fn() },
    $transaction: jest.fn(),
  },
}));

jest.mock('../socket', () => ({
  emitToJourney: jest.fn(),
}));

jest.mock('../services/escrow.service', () => ({
  refundEscrow: jest.fn().mockResolvedValue({}),
}));

// G6(a) — the four named helpers are the ones this file asserts on and
// keep their own jest.fn()s. The auto-stub underneath them is the floor:
// the "the cron path imports the dispatcher helper which references
// these" note below is exactly the drift this shape ends, because the
// next helper that note would have to mention is stubbed already.
jest.mock('../services/notification.service', () =>
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('./helpers/notification-service-mock').autoStubbedModule({
    notifyRideNotStarted: jest.fn(),
    // R3-N-4 — graduated penalty pushes; the cron path imports the
    // dispatcher helper which references these.
    notifyDriverAccountFlagged: jest.fn(),
    notifyDriverAccountSuspended: jest.fn(),
    notifyDriverNoShowWarning: jest.fn(),
  }),
);

jest.mock('../config', () => ({
  config: {
    DATABASE_URL: 'test',
    JWT_SECRET: 'test-jwt-secret-at-least-16-chars',
    JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-16-chars',
    ENCRYPTION_KEY: 'a'.repeat(64),
    PORT: 3000,
    CLIENT_URL: 'http://localhost:5173',
    NODE_ENV: 'test',
    SKIP_DRIVER_VERIFICATION: true,
  },
}));

import prisma from '../prisma';
import { CancelReason } from '@prisma/client';
import { JourneyStatus } from '@bimoto/shared';
import { processNoShowTimeout } from '../jobs/no-show-timeout.job';
import * as escrowService from '../services/escrow.service';
import * as notificationService from '../services/notification.service';
import { emitToJourney } from '../socket';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const mockEscrow = escrowService as jest.Mocked<typeof escrowService>;
const mockNotify = notificationService as jest.Mocked<typeof notificationService>;
const mockEmit = emitToJourney as jest.MockedFunction<typeof emitToJourney>;

function setupTxCapture() {
  const userUpdates: any[] = [];
  const journeyTxUpdates: any[] = [];
  (mockPrisma.$transaction as jest.Mock).mockImplementation(async (fn: any) => {
    const tx = {
      user: {
        update: jest.fn(async (args: any) => userUpdates.push(args)),
      },
      journey: {
        update: jest.fn(async (args: any) => {
          journeyTxUpdates.push(args);
          return { id: args.where.id, ...args.data };
        }),
      },
    };
    return fn(tx);
  });
  return { userUpdates, journeyTxUpdates };
}

beforeEach(() => {
  jest.clearAllMocks();
  (mockPrisma.journey.findMany as jest.Mock).mockResolvedValue([]);
  (mockPrisma.gpsPoint.findFirst as jest.Mock).mockResolvedValue(null);
});

describe('no-show-timeout.job — reminder pass (20 min)', () => {
  test('sends one reminder per matched journey, pushes BOTH parties, sets noShowReminderSentAt', async () => {
    (mockPrisma.journey.findMany as jest.Mock)
      .mockResolvedValueOnce([
        { id: 'jr1', customerId: 'c1', driverId: 'd1' },
      ])
      .mockResolvedValueOnce([]); // auto-cancel pass

    setupTxCapture();
    await processNoShowTimeout();

    expect(mockNotify.notifyRideNotStarted).toHaveBeenCalledTimes(2);
    expect(mockNotify.notifyRideNotStarted).toHaveBeenCalledWith('c1', 'jr1');
    expect(mockNotify.notifyRideNotStarted).toHaveBeenCalledWith('d1', 'jr1');
    expect(mockPrisma.journey.update).toHaveBeenCalledWith({
      where: { id: 'jr1' },
      data: { noShowReminderSentAt: expect.any(Date) },
    });
  });

  test('reminder pass WHERE filter excludes already-reminded and started rows', async () => {
    (mockPrisma.journey.findMany as jest.Mock)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    setupTxCapture();
    await processNoShowTimeout();

    const reminderCall = (mockPrisma.journey.findMany as jest.Mock).mock.calls[0][0];
    expect(reminderCall.where.status).toBe(JourneyStatus.MATCHED);
    expect(reminderCall.where.startedAt).toBeNull();
    expect(reminderCall.where.noShowReminderSentAt).toBeNull();
    expect(reminderCall.where.matchedAt.lt).toBeInstanceOf(Date);
  });

  test('reminder cutoff is exactly NO_SHOW_REMINDER_THRESHOLD_MIN minutes ago', async () => {
    (mockPrisma.journey.findMany as jest.Mock)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    setupTxCapture();
    const before = Date.now();
    await processNoShowTimeout();
    const after = Date.now();

    const reminderCall = (mockPrisma.journey.findMany as jest.Mock).mock.calls[0][0];
    const cutoffMs = reminderCall.where.matchedAt.lt.getTime();
    // Default threshold is 20 minutes → cutoff is now - 20*60_000.
    expect(cutoffMs).toBeGreaterThanOrEqual(before - 20 * 60 * 1000);
    expect(cutoffMs).toBeLessThanOrEqual(after - 20 * 60 * 1000);
  });

  test('driverless journey only pushes the customer (no crash on null driverId)', async () => {
    (mockPrisma.journey.findMany as jest.Mock)
      .mockResolvedValueOnce([
        { id: 'jr2', customerId: 'c2', driverId: null },
      ])
      .mockResolvedValueOnce([]);

    setupTxCapture();
    await processNoShowTimeout();

    expect(mockNotify.notifyRideNotStarted).toHaveBeenCalledTimes(1);
    expect(mockNotify.notifyRideNotStarted).toHaveBeenCalledWith('c2', 'jr2');
  });
});

describe('no-show-timeout.job — auto-cancel pass (30 min)', () => {
  function buildMatchedJourney(overrides: any = {}) {
    return {
      id: overrides.id ?? 'jc1',
      customerId: overrides.customerId ?? 'c1',
      driverId: overrides.driverId === undefined ? 'd1' : overrides.driverId,
      status: 'MATCHED',
      startedAt: null,
      pickupLat: overrides.pickupLat ?? -1.95,
      pickupLng: overrides.pickupLng ?? 30.06,
      escrow: 'escrow' in overrides ? overrides.escrow : { id: 'e1', status: 'HELD' },
    };
  }

  test('auto-cancel WHERE filter selects MATCHED with startedAt:null past the 30-min cutoff', async () => {
    (mockPrisma.journey.findMany as jest.Mock)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    setupTxCapture();
    await processNoShowTimeout();

    const cancelCall = (mockPrisma.journey.findMany as jest.Mock).mock.calls[1][0];
    expect(cancelCall.where.status).toBe(JourneyStatus.MATCHED);
    expect(cancelCall.where.startedAt).toBeNull();
    expect(cancelCall.where.matchedAt.lt).toBeInstanceOf(Date);
  });

  test('derivation: no GPS points → DRIVER_NO_SHOW', async () => {
    (mockPrisma.journey.findMany as jest.Mock)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([buildMatchedJourney()]);
    (mockPrisma.gpsPoint.findFirst as jest.Mock).mockResolvedValue(null);

    const { userUpdates, journeyTxUpdates } = setupTxCapture();
    await processNoShowTimeout();

    expect(journeyTxUpdates[0].data.cancelReason).toBe(CancelReason.DRIVER_NO_SHOW);
    // R3-N-4 — DRIVER_NO_SHOW path now reads back the post-increment
    // count via `select` so the graduated penalty thresholds can run
    // atomically inside the same tx.
    expect(userUpdates).toEqual([
      {
        where: { id: 'd1' },
        data: { noShowCount: { increment: 1 } },
        select: { noShowCount: true },
      },
    ]);
  });

  test('derivation: GPS within 50 m AND recent broadcast → CUSTOMER_NO_SHOW', async () => {
    (mockPrisma.journey.findMany as jest.Mock)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([buildMatchedJourney({ pickupLat: -1.95, pickupLng: 30.06 })]);
    // Same coords as pickup → 0 m distance → < 50 m.
    (mockPrisma.gpsPoint.findFirst as jest.Mock).mockResolvedValue({
      lat: -1.95,
      lng: 30.06,
      timestamp: new Date(Date.now() - 2 * 60 * 1000), // 2 min ago, recent
    });

    const { userUpdates, journeyTxUpdates } = setupTxCapture();
    await processNoShowTimeout();

    expect(journeyTxUpdates[0].data.cancelReason).toBe(CancelReason.CUSTOMER_NO_SHOW);
    expect(userUpdates).toEqual([
      { where: { id: 'c1' }, data: { noShowCount: { increment: 1 } } },
    ]);
  });

  test('derivation: GPS > 500 m AND stale broadcast → DRIVER_NO_SHOW', async () => {
    (mockPrisma.journey.findMany as jest.Mock)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([buildMatchedJourney({ pickupLat: -1.95, pickupLng: 30.06 })]);
    // ~1.1 km offset (0.01° lat ≈ 1.11 km) → well over 500 m.
    (mockPrisma.gpsPoint.findFirst as jest.Mock).mockResolvedValue({
      lat: -1.96,
      lng: 30.06,
      timestamp: new Date(Date.now() - 30 * 60 * 1000), // 30 min ago, stale
    });

    const { userUpdates, journeyTxUpdates } = setupTxCapture();
    await processNoShowTimeout();

    expect(journeyTxUpdates[0].data.cancelReason).toBe(CancelReason.DRIVER_NO_SHOW);
    expect(userUpdates).toEqual([
      {
        where: { id: 'd1' },
        data: { noShowCount: { increment: 1 } },
        select: { noShowCount: true },
      },
    ]);
  });

  test('derivation: mixed signals (200 m, 5 min ago) → BOTH_NO_SHOW', async () => {
    (mockPrisma.journey.findMany as jest.Mock)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([buildMatchedJourney({ pickupLat: -1.95, pickupLng: 30.06 })]);
    // ~220 m offset (0.002° lat ≈ 222 m) → between 50 and 500 m, recent.
    (mockPrisma.gpsPoint.findFirst as jest.Mock).mockResolvedValue({
      lat: -1.948,
      lng: 30.06,
      timestamp: new Date(Date.now() - 5 * 60 * 1000), // 5 min ago
    });

    const { userUpdates, journeyTxUpdates } = setupTxCapture();
    await processNoShowTimeout();

    expect(journeyTxUpdates[0].data.cancelReason).toBe(CancelReason.BOTH_NO_SHOW);
    // R3-N-4 — BOTH_NO_SHOW driver branch reads back the post-increment
    // count for graduated-penalty evaluation; customer branch unchanged.
    expect(userUpdates).toEqual(
      expect.arrayContaining([
        {
          where: { id: 'd1' },
          data: { noShowCount: { increment: 0.5 } },
          select: { noShowCount: true },
        },
        { where: { id: 'c1' }, data: { noShowCount: { increment: 0.5 } } },
      ]),
    );
    expect(userUpdates).toHaveLength(2);
  });

  test('auto-cancel transitions journey to CANCELLED with cancelReason and cancelledAt', async () => {
    (mockPrisma.journey.findMany as jest.Mock)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([buildMatchedJourney()]);

    const { journeyTxUpdates } = setupTxCapture();
    await processNoShowTimeout();

    expect(journeyTxUpdates).toHaveLength(1);
    expect(journeyTxUpdates[0].where).toEqual({ id: 'jc1' });
    expect(journeyTxUpdates[0].data.status).toBe(JourneyStatus.CANCELLED);
    expect(journeyTxUpdates[0].data.cancelledAt).toBeInstanceOf(Date);
    expect(journeyTxUpdates[0].data.cancelReason).toBeDefined();
  });

  test('auto-cancel calls escrowService.refundEscrow when escrow exists', async () => {
    (mockPrisma.journey.findMany as jest.Mock)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([buildMatchedJourney()]);

    setupTxCapture();
    await processNoShowTimeout();

    expect(mockEscrow.refundEscrow).toHaveBeenCalledWith('jc1', 'SYSTEM');
  });

  test('auto-cancel skips refundEscrow when journey has no escrow', async () => {
    (mockPrisma.journey.findMany as jest.Mock)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([buildMatchedJourney({ escrow: null })]);

    setupTxCapture();
    await processNoShowTimeout();

    expect(mockEscrow.refundEscrow).not.toHaveBeenCalled();
  });

  test('auto-cancel emits journey-cancelled with system attribution', async () => {
    (mockPrisma.journey.findMany as jest.Mock)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([buildMatchedJourney()]);

    setupTxCapture();
    await processNoShowTimeout();

    expect(mockEmit).toHaveBeenCalledWith(
      'jc1',
      'journey-cancelled',
      expect.objectContaining({
        journeyId: 'jc1',
        status: JourneyStatus.CANCELLED,
        cancelReason: expect.any(String),
        triggeredBy: 'system',
      }),
    );
  });

  test('idempotent across cron runs: WHERE filter excludes already-CANCELLED rows', async () => {
    // Simulate two consecutive ticks; the second tick's WHERE filter
    // (status = MATCHED) excludes the row that the first tick
    // CANCELLED, so no double-fire.
    (mockPrisma.journey.findMany as jest.Mock)
      .mockResolvedValueOnce([]) // tick1 reminders
      .mockResolvedValueOnce([buildMatchedJourney()]) // tick1 cancel
      .mockResolvedValueOnce([]) // tick2 reminders
      .mockResolvedValueOnce([]); // tick2 cancel — empty because status filter

    setupTxCapture();
    await processNoShowTimeout();
    await processNoShowTimeout();

    // Only one transaction across the two ticks.
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockEmit).toHaveBeenCalledTimes(1);
    // Both ticks asked for status=MATCHED on the auto-cancel pass.
    const cancelCalls = (mockPrisma.journey.findMany as jest.Mock).mock.calls.filter(
      ([arg]) => arg.include?.escrow,
    );
    expect(cancelCalls.every(([arg]) => arg.where.status === JourneyStatus.MATCHED)).toBe(true);
  });

  test('null driver: BOTH_NO_SHOW only increments customer (driver branch is no-op)', async () => {
    (mockPrisma.journey.findMany as jest.Mock)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([buildMatchedJourney({ driverId: null })]);
    (mockPrisma.gpsPoint.findFirst as jest.Mock).mockResolvedValue({
      lat: -1.948,
      lng: 30.06,
      timestamp: new Date(Date.now() - 5 * 60 * 1000),
    });

    const { userUpdates, journeyTxUpdates } = setupTxCapture();
    await processNoShowTimeout();

    expect(journeyTxUpdates[0].data.cancelReason).toBe(CancelReason.BOTH_NO_SHOW);
    expect(userUpdates).toEqual([
      { where: { id: 'c1' }, data: { noShowCount: { increment: 0.5 } } },
    ]);
  });
});
