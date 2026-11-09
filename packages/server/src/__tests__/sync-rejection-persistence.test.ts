// R3-SYNC-REJECTION-MODEL — Group E persistence tests.
//
// Verifies that processEvents, when a SyncEvent INSERT throws (and
// classifyRejection emits a SyncRejection back to the client), ALSO
// persists a row to prisma.syncRejection. This is the data-layer half
// of the work that unlocks the diagnostic funnel offline-sync ratio
// (the read side is exercised by funnel-metrics.test.ts).

jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    syncEvent: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    syncRejection: {
      create: jest.fn().mockResolvedValue({}),
    },
  },
}));

jest.mock('@sentry/node', () => ({
  captureException: jest.fn(),
}));

import prisma from '../prisma';
import { processEvents } from '../services/sync.service';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const USER_ID = '11111111-1111-1111-1111-111111111111';

beforeEach(() => {
  jest.clearAllMocks();
  (mockPrisma.syncRejection.create as jest.Mock).mockResolvedValue({});
});

describe('R3-SYNC-REJECTION-MODEL — server-side persistence', () => {
  test('classifyRejection emitting non-null persists a SyncRejection row', async () => {
    (mockPrisma.syncEvent.findUnique as jest.Mock).mockResolvedValue(null);
    (mockPrisma.syncEvent.create as jest.Mock).mockRejectedValue(
      Object.assign(new Error('Foreign key constraint failed on the field: `journeyId`'), {
        code: 'P2003',
        meta: { field_name: 'journeyId' },
      }),
    );

    const result = await processEvents(USER_ID, [
      {
        clientEventId: 'evt-rejected-1',
        eventType: 'JOURNEY_CREATED',
        payload: { journeyId: 'missing' },
        clientTimestamp: '2026-03-17T10:00:00Z',
      },
    ]);

    // (a) Client still receives the rejection (existing behaviour preserved).
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]).toMatchObject({
      clientEventId: 'evt-rejected-1',
      code: 'FK_VIOLATION',
    });

    // (b) A SyncRejection row was persisted with the expected fields.
    expect(mockPrisma.syncRejection.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.syncRejection.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: USER_ID,
        clientEventId: 'evt-rejected-1',
        eventType: 'JOURNEY_CREATED',
        rejectionCode: 'FK_VIOLATION',
        rejectionMessage: expect.any(String),
      }),
    });
  });

  test('successful events do NOT persist a SyncRejection row', async () => {
    (mockPrisma.syncEvent.findUnique as jest.Mock).mockResolvedValue(null);
    (mockPrisma.syncEvent.create as jest.Mock).mockResolvedValue({});

    const result = await processEvents(USER_ID, [
      {
        clientEventId: 'evt-ok',
        eventType: 'JOURNEY_CREATED',
        payload: {},
        clientTimestamp: '2026-03-17T10:00:00Z',
      },
    ]);

    expect(result.processed).toEqual(['evt-ok']);
    expect(result.rejected).toEqual([]);
    expect(mockPrisma.syncRejection.create).not.toHaveBeenCalled();
  });

  test('payloadSummary is PII-free and ≤ 200 chars', async () => {
    (mockPrisma.syncEvent.findUnique as jest.Mock).mockResolvedValue(null);
    (mockPrisma.syncEvent.create as jest.Mock).mockRejectedValue(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
    );

    const phone = '+250788123456';
    const fullName = 'Jean-Baptiste Uwimana';
    const exactLat = -1.94567823;
    const exactLng = 30.05891204;

    await processEvents(USER_ID, [
      {
        clientEventId: 'evt-pii',
        eventType: 'JOURNEY_CREATED',
        payload: {
          customerPhone: phone,
          driverName: fullName,
          pickupLat: exactLat,
          pickupLng: exactLng,
          notes: 'a'.repeat(1000),
        },
        clientTimestamp: '2026-03-17T10:00:00Z',
      },
    ]);

    expect(mockPrisma.syncRejection.create).toHaveBeenCalledTimes(1);
    const createArgs = (mockPrisma.syncRejection.create as jest.Mock).mock.calls[0][0];
    const summary: string = createArgs.data.payloadSummary;

    expect(summary).not.toBeNull();
    expect(summary.length).toBeLessThanOrEqual(200);

    // Phone digits do not appear verbatim in the summary.
    expect(summary).not.toContain('250788123456');
    expect(summary).not.toContain('788123456');

    // Full name does not appear.
    expect(summary).not.toContain(fullName);
    expect(summary).not.toContain('Jean');
    expect(summary).not.toContain('Uwimana');

    // Exact GPS coords do not appear (sub-degree precision would identify the user).
    expect(summary).not.toContain('-1.94567823');
    expect(summary).not.toContain('30.05891204');
    expect(summary).not.toContain('1.945');
    expect(summary).not.toContain('30.058');

    // Sanity: the summary should still be useful — it should at least mention
    // some structural fact (key names are allowed; values are not).
    expect(summary).toContain('customerPhone');
    expect(summary).toContain('notes');
  });
});
