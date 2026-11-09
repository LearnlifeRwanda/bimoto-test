import { BookingMode, JourneyStatus, SmsInboundStatus } from '@prisma/client';
import * as journeyService from '../../journey.service';
import { REPLY_TEMPLATES, SCHEDULED_REPLY_WINDOW_HOURS } from '../config';
import type { HandlerFn, HandlerResult } from '../types';

export const handle: HandlerFn = async (_ctx, user, parsed, prisma) => {
  const now = Date.now();
  const horizon = new Date(now + SCHEDULED_REPLY_WINDOW_HOURS * 60 * 60 * 1000);

  const journey = await prisma.journey.findFirst({
    where: {
      customerId: user.id,
      bookingMode: BookingMode.SCHEDULED,
      status: { in: [JourneyStatus.SCHEDULED, JourneyStatus.MATCHED] },
      scheduledFor: { gte: new Date(now), lte: horizon },
    },
    orderBy: { scheduledFor: 'asc' },
  });

  if (!journey) {
    return {
      status: SmsInboundStatus.NO_MATCHING_SCHEDULED,
      replyBody: REPLY_TEMPLATES.NO_MATCHING_SCHEDULED,
    };
  }

  try {
    if (parsed.intent === 'CONFIRM_SCHEDULED' || parsed.intent === 'CONFIRM_JOURNEY') {
      // The schema does not carry an explicit confirmedViaSms flag for
      // scheduled rides; the reply itself is the confirmation surface and
      // we record the inbound row's resolvedEntityId for audit.
      return {
        status: SmsInboundStatus.PROCESSED,
        resolvedEntityId: journey.id,
        replyBody: REPLY_TEMPLATES.SCHEDULED_CONFIRMED,
      };
    }
    if (parsed.intent === 'CANCEL_SCHEDULED') {
      await journeyService.cancelScheduledJourney(journey.id, journey.customerId);
      return {
        status: SmsInboundStatus.PROCESSED,
        resolvedEntityId: journey.id,
        replyBody: REPLY_TEMPLATES.SCHEDULED_CANCELLED,
      };
    }
  } catch (err) {
    const result: HandlerResult = {
      status: SmsInboundStatus.ERROR,
      resolvedEntityId: journey.id,
      errorMessage: err instanceof Error ? err.message : String(err),
    };
    return result;
  }

  return {
    status: SmsInboundStatus.UNKNOWN_INTENT,
    replyBody: REPLY_TEMPLATES.UNKNOWN_INTENT,
  };
};
