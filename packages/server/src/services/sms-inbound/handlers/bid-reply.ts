import { BidStatus, SmsInboundStatus } from '@prisma/client';
import * as bidService from '../../bid.service';
import { BID_REPLY_WINDOW_MINUTES, REPLY_TEMPLATES } from '../config';
import type { HandlerFn, HandlerResult } from '../types';

export const handle: HandlerFn = async (_ctx, user, parsed, prisma) => {
  const cutoff = new Date(Date.now() - BID_REPLY_WINDOW_MINUTES * 60 * 1000);

  const bid = await prisma.bid.findFirst({
    where: {
      driverId: user.id,
      status: BidStatus.PENDING,
      createdAt: { gte: cutoff },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!bid) {
    return {
      status: SmsInboundStatus.NO_MATCHING_BID,
      replyBody: REPLY_TEMPLATES.NO_MATCHING_BID,
    };
  }

  try {
    if (parsed.intent === 'ACCEPT_BID' || parsed.intent === 'CONFIRM_JOURNEY') {
      // Drivers do not unilaterally "accept" their own bid in the codebase;
      // the customer accepts. We acknowledge the driver's commitment and
      // record the bid id on the inbound row for audit. Once the customer
      // accepts via app/SMS, the existing acceptBid path handles the rest.
      return {
        status: SmsInboundStatus.PROCESSED,
        resolvedEntityId: bid.id,
        replyBody: REPLY_TEMPLATES.BID_ACCEPTED,
      };
    }
    if (parsed.intent === 'DECLINE_BID' || parsed.intent === 'DISPUTE_JOURNEY') {
      // The driver texted the decline themselves — human-initiated.
      await bidService.withdrawBid(bid.id, user.id, 'USER');
      return {
        status: SmsInboundStatus.PROCESSED,
        resolvedEntityId: bid.id,
        replyBody: REPLY_TEMPLATES.BID_DECLINED,
      };
    }
  } catch (err) {
    const result: HandlerResult = {
      status: SmsInboundStatus.ERROR,
      resolvedEntityId: bid.id,
      errorMessage: err instanceof Error ? err.message : String(err),
    };
    return result;
  }

  return {
    status: SmsInboundStatus.UNKNOWN_INTENT,
    replyBody: REPLY_TEMPLATES.UNKNOWN_INTENT,
  };
};
