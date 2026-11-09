import prisma from '../prisma';
import { AppError } from '../middleware/error-handler';
import { MAX_MESSAGE_LENGTH } from '@bimoto/shared';

/**
 * AUTH-READ G2 — the one participant check both chat paths share.
 *
 * This is the check `createMessage` has always made before writing (a
 * journey that exists, and a caller who is one of its two parties). It
 * is extracted verbatim rather than re-implemented, because the read
 * path must answer the question the SAME way the write path does: the
 * bug being closed here is precisely that the read path never asked.
 *
 * Failure shapes follow the journey route family's convention, which is
 * what both chat routes belong to: a journey nobody can find is 404, and
 * a journey that exists but is not yours is 403. See the two nearest
 * read siblings — `GET /:id/eta` (journey.routes.ts:654,657) and
 * `GET /:id/emergency/active` (journey.routes.ts:1453) — which answer
 * the same pair the same way. (The uniform-404 pattern in
 * document-access.service is a different family's deliberate
 * anti-enumeration stance for opaque document keys, not this one's.)
 */
export async function assertJourneyParticipant(journeyId: string, userId: string) {
  const journey = await prisma.journey.findUnique({ where: { id: journeyId } });

  if (!journey) {
    throw new AppError(404, 'JOURNEY_NOT_FOUND', 'errors.journeyNotFound');
  }

  if (journey.customerId !== userId && journey.driverId !== userId) {
    throw new AppError(403, 'NOT_JOURNEY_PARTICIPANT', 'errors.notJourneyParticipant');
  }

  return journey;
}

export async function getMessages(journeyId: string, callerId: string, since?: Date) {
  // AUTH-READ G2 — the read learns whose chat it is. Before this line the
  // query was scoped by journeyId alone, so any authenticated account
  // that knew a journey UUID could read that journey's whole chat.
  await assertJourneyParticipant(journeyId, callerId);

  const messages = await prisma.message.findMany({
    where: {
      journeyId,
      ...(since ? { createdAt: { gt: since } } : {}),
    },
    include: {
      sender: {
        select: { id: true, nickname: true },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  return messages;
}

export async function createMessage(
  journeyId: string,
  senderId: string,
  text: string,
  isQuickMessage: boolean = false,
  quickMessageId?: string,
) {
  if (text.length > MAX_MESSAGE_LENGTH) {
    throw new AppError(400, 'MESSAGE_TOO_LONG', 'errors.messageTooLong');
  }

  // Verify journey exists and sender is a participant
  await assertJourneyParticipant(journeyId, senderId);

  const message = await prisma.message.create({
    data: {
      journeyId,
      senderId,
      text,
      isQuickMessage,
      quickMessageId: quickMessageId ?? null,
    },
    include: {
      sender: {
        select: { id: true, nickname: true },
      },
    },
  });

  return message;
}
