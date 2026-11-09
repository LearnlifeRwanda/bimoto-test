import type { PrismaClient, SmsInbound } from '@prisma/client';
import { SmsInboundStatus } from '@prisma/client';
import type { InboundContext } from './types';

export interface UpsertResult {
  row: SmsInbound;
  isFirstTime: boolean;
}

/**
 * Atomic upsert keyed by Africa's Talking message id. Used by the webhook
 * route to short-circuit AT retries: AT will POST the same id again on any
 * non-2xx response, so we must dedupe before doing anything that has side
 * effects (state transitions, outbound replies). If the row already exists
 * with a status other than PENDING, we treat it as already processed and
 * return isFirstTime=false so the caller can skip handler execution.
 */
export async function upsertInbound(
  ctx: InboundContext,
  prisma: PrismaClient,
): Promise<UpsertResult> {
  const existing = await prisma.smsInbound.findUnique({
    where: { atMessageId: ctx.atMessageId },
  });

  if (existing) {
    return { row: existing, isFirstTime: existing.status === SmsInboundStatus.PENDING };
  }

  const row = await prisma.smsInbound.create({
    data: {
      atMessageId: ctx.atMessageId,
      fromMsisdn: ctx.fromMsisdn,
      toShortcode: ctx.toShortcode,
      rawBody: ctx.rawBody,
      receivedAt: ctx.receivedAt,
    },
  });
  return { row, isFirstTime: true };
}
