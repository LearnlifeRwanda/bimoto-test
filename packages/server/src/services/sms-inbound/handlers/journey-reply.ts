import { JourneyStatus, SmsInboundStatus } from '@prisma/client';
import * as journeyService from '../../journey.service';
import { DISPUTE_REPLY_WINDOW_HOURS, REPLY_TEMPLATES } from '../config';
import type { HandlerFn, HandlerResult } from '../types';

export const handle: HandlerFn = async (_ctx, user, parsed, prisma) => {
  const cutoff = new Date(Date.now() - DISPUTE_REPLY_WINDOW_HOURS * 60 * 60 * 1000);

  // SENDER-MATCH-2 — customer-side only, restoring #177's authorization model.
  //
  // This used to match `OR: [{ customerId: user.id }, { driverId: user.id }]`
  // and then call confirmJourney(journey.id, journey.customerId) — passing
  // the CUSTOMER's id as the actor whoever the sender was. confirmJourney's
  // own `journey.customerId !== customerId` ownership guard therefore always
  // passed, because the handler was the thing supplying the id it checks.
  // The effect: a driver texting YES performed his passenger's confirmation
  // and released his own payment, over a channel authenticated by caller ID.
  // #177 made this action customerOnly in the app; SMS was quietly exempt.
  //
  // Matching customer-side closes it at the matcher rather than at the gate,
  // so the capability is gone even on the day SMS_COMMAND_TIER=full opens.
  // A driver who texts YES now falls through to NO_MATCHING_JOURNEY — worded
  // for customers ("No active rides found in the last 24h"), which reads
  // oddly for a driver who does have a recent ride. That is a wording-card
  // note, deliberately not new copy here.
  const journey = await prisma.journey.findFirst({
    where: {
      customerId: user.id,
      status: {
        in: [
          JourneyStatus.AWAITING_CONFIRMATION,
          JourneyStatus.COMPLETED,
          JourneyStatus.INTERRUPTED,
        ],
      },
      endedAt: { gte: cutoff },
    },
    orderBy: { endedAt: 'desc' },
  });

  if (!journey) {
    return {
      status: SmsInboundStatus.NO_MATCHING_JOURNEY,
      replyBody: REPLY_TEMPLATES.NO_MATCHING_JOURNEY,
    };
  }

  try {
    if (parsed.intent === 'CONFIRM_JOURNEY') {
      await journeyService.confirmJourney(journey.id, journey.customerId);
      return {
        status: SmsInboundStatus.PROCESSED,
        resolvedEntityId: journey.id,
        replyBody: REPLY_TEMPLATES.CONFIRMED,
      };
    }
    if (parsed.intent === 'DISPUTE_JOURNEY') {
      await journeyService.disputeJourney(
        journey.id,
        journey.customerId,
        'Disputed via inbound SMS',
      );
      return {
        status: SmsInboundStatus.PROCESSED,
        resolvedEntityId: journey.id,
        replyBody: REPLY_TEMPLATES.DISPUTED,
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
