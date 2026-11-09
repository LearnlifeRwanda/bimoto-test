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

import * as Sentry from '@sentry/node';
import { ZodError } from 'zod';
import prisma from '../prisma';
import { classifyRejection, processEvents } from '../services/sync.service';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('classifyRejection', () => {
  test('Prisma P2003 → FK_VIOLATION', () => {
    const err = Object.assign(new Error('Foreign key constraint failed on the field: `journeyId`'), {
      code: 'P2003',
      meta: { field_name: 'journeyId' },
    });
    const r = classifyRejection(err, 'evt-fk');
    expect(r.code).toBe('FK_VIOLATION');
    expect(r.clientEventId).toBe('evt-fk');
    expect(r.serverState).toEqual({ field_name: 'journeyId' });
  });

  test('Prisma P2002 → DUPLICATE_EVENT_ID', () => {
    const err = Object.assign(new Error('Unique constraint failed on the fields: (`clientEventId`)'), {
      code: 'P2002',
      meta: { target: ['clientEventId'] },
    });
    const r = classifyRejection(err, 'evt-dup');
    expect(r.code).toBe('DUPLICATE_EVENT_ID');
  });

  test('ZodError → VALIDATION_ERROR', () => {
    const err = new ZodError([
      { code: 'invalid_type', expected: 'string', received: 'number', path: ['clientEventId'], message: 'Expected string' } as any,
    ]);
    const r = classifyRejection(err, 'evt-bad');
    expect(r.code).toBe('VALIDATION_ERROR');
    expect(r.message).toContain('clientEventId');
  });

  test('Unknown error → UNKNOWN with sanitized message', () => {
    const err = new Error('boom\n    at /Users/secret/path/file.ts:42:10');
    const r = classifyRejection(err, 'evt-unk');
    expect(r.code).toBe('UNKNOWN');
    expect(r.message).toBe('boom');
    expect(r.message).not.toContain('/Users');
  });
});

describe('processEvents — rejection roundtrip', () => {
  const baseEvent = {
    eventType: 'JOURNEY_CREATED',
    payload: {},
    clientTimestamp: '2026-03-17T10:00:00Z',
  };

  test('emits FK_VIOLATION when create throws P2003', async () => {
    (mockPrisma.syncEvent.findUnique as jest.Mock).mockResolvedValue(null);
    (mockPrisma.syncEvent.create as jest.Mock).mockRejectedValue(
      Object.assign(new Error('Foreign key constraint failed'), {
        code: 'P2003',
        meta: { field_name: 'journeyId' },
      }),
    );

    const result = await processEvents('u1', [{ ...baseEvent, clientEventId: 'evt-fk' }]);

    expect(result.processed).toEqual([]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]).toMatchObject({ clientEventId: 'evt-fk', code: 'FK_VIOLATION' });
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tags: expect.objectContaining({ sync_rejection_code: 'FK_VIOLATION' }),
      }),
    );
  });

  test('emits DUPLICATE_EVENT_ID when create throws P2002', async () => {
    (mockPrisma.syncEvent.findUnique as jest.Mock).mockResolvedValue(null);
    (mockPrisma.syncEvent.create as jest.Mock).mockRejectedValue(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
    );

    const result = await processEvents('u1', [{ ...baseEvent, clientEventId: 'evt-dup' }]);

    expect(result.rejected[0]).toMatchObject({ code: 'DUPLICATE_EVENT_ID' });
  });

  test('well-formed event lands in processed[]', async () => {
    (mockPrisma.syncEvent.findUnique as jest.Mock).mockResolvedValue(null);
    (mockPrisma.syncEvent.create as jest.Mock).mockResolvedValue({});

    const result = await processEvents('u1', [{ ...baseEvent, clientEventId: 'evt-ok' }]);

    expect(result.processed).toEqual(['evt-ok']);
    expect(result.rejected).toEqual([]);
  });

  test('mixed batch: one accepted, one rejected', async () => {
    (mockPrisma.syncEvent.findUnique as jest.Mock).mockResolvedValue(null);
    (mockPrisma.syncEvent.create as jest.Mock)
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(Object.assign(new Error('FK'), { code: 'P2003' }));

    const result = await processEvents('u1', [
      { ...baseEvent, clientEventId: 'evt-ok', clientTimestamp: '2026-03-17T10:00:00Z' },
      { ...baseEvent, clientEventId: 'evt-fk', clientTimestamp: '2026-03-17T10:01:00Z' },
    ]);

    expect(result.processed).toEqual(['evt-ok']);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].code).toBe('FK_VIOLATION');
  });
});
