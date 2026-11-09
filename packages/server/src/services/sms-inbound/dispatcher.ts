import * as Sentry from '@sentry/node';
import { BidStatus, SmsInboundStatus, UserRole } from '@prisma/client';
import prisma from '../../prisma';
import { sendSms } from '../sms.service';
import { config } from '../../config';
import {
  BID_REPLY_WINDOW_MINUTES,
  REPLY_TEMPLATES,
  REPLY_TIMEOUT_MS,
  unmatchedSenderReply,
} from './config';
import { isGatedIntent } from './tier';
import { upsertInbound } from './idempotency';
import { findUserByMsisdn } from './sender-lookup';
import { parseMessage } from './parser';
import { handlerByIntent, recipientConfirm, recipientDispute } from './handlers';
import type { HandlerResult, InboundContext, Intent, ParsedMessage } from './types';

function timeout(ms: number): Promise<HandlerResult> {
  return new Promise((resolve) =>
    setTimeout(
      () =>
        resolve({
          status: SmsInboundStatus.ERROR,
          errorMessage: `handler timed out after ${ms}ms`,
        }),
      ms,
    ),
  );
}

async function disambiguateBidContext(
  parsed: ParsedMessage,
  driverId: string,
): Promise<Intent> {
  if (parsed.intent !== 'CONFIRM_JOURNEY' && parsed.intent !== 'DISPUTE_JOURNEY') {
    return parsed.intent;
  }
  const cutoff = new Date(Date.now() - BID_REPLY_WINDOW_MINUTES * 60 * 1000);
  const openBid = await prisma.bid.findFirst({
    where: { driverId, status: BidStatus.PENDING, createdAt: { gte: cutoff } },
    select: { id: true },
  });
  if (!openBid) return parsed.intent;
  return parsed.intent === 'CONFIRM_JOURNEY' ? 'ACCEPT_BID' : 'DECLINE_BID';
}

export async function processInbound(ctx: InboundContext): Promise<HandlerResult> {
  const { row, isFirstTime } = await upsertInbound(ctx, prisma);

  if (!isFirstTime) {
    return {
      status: row.status,
      resolvedEntityId: row.resolvedEntityId ?? undefined,
      replyBody: row.replyBody ?? undefined,
      errorMessage: row.errorMessage ?? undefined,
    };
  }

  let result: HandlerResult = {
    status: SmsInboundStatus.ERROR,
    errorMessage: 'unprocessed',
  };
  let resolvedUserId: string | null = null;
  let effectiveIntent: Intent = 'UNKNOWN';

  try {
    const parsed = parseMessage(ctx.rawBody);
    effectiveIntent = parsed.intent;
    const user = await findUserByMsisdn(ctx.fromMsisdn, prisma);

    if (!user) {
      // R3-RECIPIENT-CONFIRM — a non-Bimoto sender replying with a confirmation
      // keyword is the parcel recipient acknowledging receipt. Route to the
      // recipient-confirm handler, which matches the inbound phone against
      // recently-completed GOODS_DROPOFF legs (no Bimoto user needed). Other
      // intents from non-Bimoto senders still fall through to UNMATCHED_SENDER.
      // R3-RECIPIENT-CONFIRM-2 — same branch handles RECIPIENT_DISPUTE: the
      // recipient flagged the parcel as wrong/damaged. Stamps DISPUTED status
      // + preserves the SMS body as the dispute reason.
      if (parsed.intent === 'RECIPIENT_CONFIRM') {
        result = await Promise.race([
          recipientConfirm.handle(ctx, prisma),
          timeout(REPLY_TIMEOUT_MS),
        ]);
      } else if (parsed.intent === 'RECIPIENT_DISPUTE') {
        result = await Promise.race([
          recipientDispute.handle(ctx, prisma),
          timeout(REPLY_TIMEOUT_MS),
        ]);
      } else {
        result = {
          status: SmsInboundStatus.UNMATCHED_SENDER,
          // SENDER-MATCH-2 — built, so the support clause carries a real
          // number or nothing. Never the placeholder this used to ship.
          replyBody: unmatchedSenderReply(),
        };
      }
    } else {
      resolvedUserId = user.id;

      if (user.smsOptOut && parsed.intent !== 'STOP' && parsed.intent !== 'HELP') {
        result = { status: SmsInboundStatus.OPT_OUT_RECORDED };
      } else {
        // SENDER-MATCH — a registered user CAN be a parcel recipient.
        //
        // handlers/index.ts used to route these two intents to unknown.handle
        // for a resolved sender, on the stated premise that "recipients have
        // no Bimoto account by definition". That premise was never tested: it
        // was only ever true because sender-lookup could not match anybody, so
        // every recipient reply arrived as a stranger. With the lookup fixed
        // the premise is false — every pilot tester has an account and can
        // receive a parcel — and routing them by account would BREAK receipt
        // confirmations that work today: they would resolve as users, skip the
        // leg match, and get the "reply YES/1" nudge instead of their receipt.
        //
        // The leg's contact-phone match is the authority for receipts, not the
        // sender's account. So attempt it regardless of user resolution, and
        // fall back to the existing UNKNOWN nudge only when no recent
        // GOODS_DROPOFF leg matches — which also gives a registered customer
        // who texts "YEGO" at a confirm prompt a sane path: their receipt if
        // they are a recipient, the YES/1 nudge if they are not.
        //
        // The handlers take (ctx, prisma) only: they never see `user`, so a
        // resolved sender walks byte-identically the same code a stranger does.
        if (parsed.intent === 'RECIPIENT_CONFIRM' || parsed.intent === 'RECIPIENT_DISPUTE') {
          const recipientHandler =
            parsed.intent === 'RECIPIENT_CONFIRM' ? recipientConfirm : recipientDispute;
          result = await Promise.race([
            recipientHandler.handle(ctx, prisma),
            timeout(REPLY_TIMEOUT_MS),
          ]);
          if (result.status === SmsInboundStatus.NO_MATCHING_JOURNEY) {
            result = await Promise.race([
              handlerByIntent[parsed.intent](ctx, user, parsed, prisma),
              timeout(REPLY_TIMEOUT_MS),
            ]);
          }
        } else {
          if (user.role === UserRole.DRIVER || user.role === UserRole.BOTH) {
            effectiveIntent = await disambiguateBidContext(parsed, user.id);
          }
          // SENDER-MATCH-2 — the tier gate, on the EFFECTIVE intent.
          //
          // Placed after disambiguateBidContext and before dispatch, so a
          // driver's YES that resolved to ACCEPT_BID is refused as the bid
          // action it became, and the same YES outside the bid window is
          // refused as CONFIRM_JOURNEY. Gating the PARSED intent would let a
          // bid action through whenever its keyword looked like a journey
          // reply — the disambiguation is exactly what makes the two differ.
          //
          // The handler is never constructed and never called: nothing reads
          // a journey, no escrow moves, no bid changes. The refusal is the
          // whole behaviour.
          if (isGatedIntent(effectiveIntent, config.SMS_COMMAND_TIER)) {
            result = {
              status: SmsInboundStatus.UNKNOWN_INTENT,
              replyBody: REPLY_TEMPLATES.USE_APP,
            };
          } else {
            const finalParsed: ParsedMessage = { ...parsed, intent: effectiveIntent };
            const handler = handlerByIntent[effectiveIntent];
            result = await Promise.race([handler(ctx, user, finalParsed, prisma), timeout(REPLY_TIMEOUT_MS)]);
          }
        }
      }
    }
  } catch (err) {
    Sentry.captureException(err);
    result = {
      status: SmsInboundStatus.ERROR,
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }

  let replySentAt: Date | null = null;
  if (result.replyBody) {
    try {
      await sendSms(ctx.fromMsisdn, result.replyBody);
      replySentAt = new Date();
    } catch (err) {
      console.warn('[sms-inbound] reply send failed:', err);
    }
  }

  try {
    await prisma.smsInbound.update({
      where: { id: row.id },
      data: {
        userId: resolvedUserId,
        intent: effectiveIntent,
        status: result.status,
        resolvedEntityId: result.resolvedEntityId ?? null,
        replyBody: result.replyBody ?? null,
        replySentAt,
        errorMessage: result.errorMessage ?? null,
        processedAt: new Date(),
      },
    });
  } catch (err) {
    Sentry.captureException(err);
    console.error('[sms-inbound] failed to update inbound row:', err);
  }

  return result;
}
