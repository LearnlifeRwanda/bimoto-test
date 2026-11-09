jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    journey: {
      findUnique: jest.fn(),
    },
    message: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
  },
}));

jest.mock('../config', () => ({
  config: {
    DATABASE_URL: 'test',
    JWT_SECRET: 'test-jwt-secret-at-least-16-chars',
    JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-16-chars',
    ENCRYPTION_KEY: 'a'.repeat(64),
    PORT: 3000,
    CLIENT_URL: 'http://localhost:5173',
    NODE_ENV: 'test',
  },
}));

import prisma from '../prisma';
import * as messageService from '../services/message.service';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Message Service', () => {
  describe('createMessage', () => {
    test('persists isQuickMessage and quickMessageId on a quick message', async () => {
      (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue({
        id: 'j1',
        customerId: 'c1',
        driverId: 'd1',
      });
      (mockPrisma.message.create as jest.Mock).mockImplementation(async ({ data }) => ({
        id: 'm1',
        createdAt: new Date(),
        sender: { id: data.senderId, nickname: 'D' },
        ...data,
      }));

      const result = await messageService.createMessage(
        'j1',
        'd1',
        'On my way',
        true,
        'qm_on_my_way',
      );

      expect(mockPrisma.message.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            journeyId: 'j1',
            senderId: 'd1',
            text: 'On my way',
            isQuickMessage: true,
            quickMessageId: 'qm_on_my_way',
          }),
        }),
      );
      expect(result.isQuickMessage).toBe(true);
      expect(result.quickMessageId).toBe('qm_on_my_way');
    });

    test('defaults isQuickMessage to false and persists null quickMessageId for free text', async () => {
      (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue({
        id: 'j1',
        customerId: 'c1',
        driverId: 'd1',
      });
      (mockPrisma.message.create as jest.Mock).mockImplementation(async ({ data }) => ({
        id: 'm2',
        createdAt: new Date(),
        sender: { id: data.senderId, nickname: 'C' },
        ...data,
      }));

      const result = await messageService.createMessage('j1', 'c1', 'Behind the green gate');

      expect(mockPrisma.message.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            isQuickMessage: false,
            quickMessageId: null,
          }),
        }),
      );
      expect(result.isQuickMessage).toBe(false);
      expect(result.quickMessageId).toBeNull();
    });

    test('rejects when sender is not a journey participant', async () => {
      (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue({
        id: 'j1',
        customerId: 'c1',
        driverId: 'd1',
      });

      await expect(
        messageService.createMessage('j1', 'stranger', 'hi'),
      ).rejects.toThrow('errors.notJourneyParticipant');
      expect(mockPrisma.message.create).not.toHaveBeenCalled();
    });

    test('rejects when journey not found', async () => {
      (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        messageService.createMessage('missing', 'c1', 'hi'),
      ).rejects.toThrow('errors.journeyNotFound');
    });
  });

  describe('getMessages', () => {
    // The journey both parties are on, for the participant cases.
    const JOURNEY = { id: 'j1', customerId: 'c1', driverId: 'd1' };

    const stored = [
      {
        id: 'm1',
        journeyId: 'j1',
        senderId: 'd1',
        text: 'On my way',
        isQuickMessage: true,
        quickMessageId: 'qm_on_my_way',
        createdAt: new Date(),
        sender: { id: 'd1', nickname: 'D' },
      },
    ];

    test('returns persisted quick-message fields verbatim (round-trip)', async () => {
      (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue(JOURNEY);
      (mockPrisma.message.findMany as jest.Mock).mockResolvedValue(stored);

      const result = await messageService.getMessages('j1', 'c1');

      expect(result).toEqual(stored);
      expect(result[0].isQuickMessage).toBe(true);
      expect(result[0].quickMessageId).toBe('qm_on_my_way');
    });

    // AUTH-READ G3(b) — both parties still read. The driver case is not
    // redundant with the customer case above: the check tests two
    // different columns, and only one of them is nullable.
    test('the assigned driver reads the same rows the customer does', async () => {
      (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue(JOURNEY);
      (mockPrisma.message.findMany as jest.Mock).mockResolvedValue(stored);

      const result = await messageService.getMessages('j1', 'd1');

      expect(result).toEqual(stored);
    });

    // AUTH-READ G3(a) — the case no chat spec had: a read by someone who
    // is on neither side of the journey. Every existing chat test reads
    // as a participant, which is exactly why the IDOR survived.
    test('refuses a non-participant and reads no message rows', async () => {
      (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue(JOURNEY);

      await expect(
        messageService.getMessages('j1', 'stranger'),
      ).rejects.toThrow('errors.notJourneyParticipant');

      // The point of the fix: the query must never run for a stranger.
      // Asserting only on the throw would pass even if the rows had
      // already been fetched and then discarded.
      expect(mockPrisma.message.findMany).not.toHaveBeenCalled();
    });

    test('refuses an unmatched journey the caller has no part in', async () => {
      // driverId null — nobody is assigned yet, so the nullable column
      // must not accidentally match a caller.
      (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue({
        id: 'j1',
        customerId: 'c1',
        driverId: null,
      });

      await expect(
        messageService.getMessages('j1', 'stranger'),
      ).rejects.toThrow('errors.notJourneyParticipant');
      expect(mockPrisma.message.findMany).not.toHaveBeenCalled();
    });

    test('rejects when journey not found', async () => {
      (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        messageService.getMessages('missing', 'c1'),
      ).rejects.toThrow('errors.journeyNotFound');
      expect(mockPrisma.message.findMany).not.toHaveBeenCalled();
    });

    // Invariant 1 — `since` semantics unchanged for participants.
    test('passes the since filter through unchanged for a participant', async () => {
      (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue(JOURNEY);
      (mockPrisma.message.findMany as jest.Mock).mockResolvedValue([]);
      const since = new Date('2026-01-01T00:00:00.000Z');

      await messageService.getMessages('j1', 'c1', since);

      expect(mockPrisma.message.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { journeyId: 'j1', createdAt: { gt: since } },
          orderBy: { createdAt: 'asc' },
        }),
      );
    });
  });
});
