// R3-RECIPIENT-CONFIRM — closes the parcel-delivery trust circle.
//
// R3-DELIVERY-NOTIFICATIONS sends a "your parcel has been delivered" SMS to
// recipients (people whose phone is in Leg.contactPhone). This handler
// receives their reply ("RECEIVED", "OK", "MURAKOZE", …): match the inbound
// phone against recently-completed GOODS_DROPOFF legs, stamp
// recipientConfirmedAt on the most recent unconfirmed match, and reply with
// a localized thank-you. If no match (window expired, already confirmed, or
// phone never received a delivery), reply with a polite not-found message.
//
// Invoked from the dispatcher only when sender-lookup fails (no Bimoto user)
// AND the parsed intent is RECIPIENT_CONFIRM. Never called via handlerByIntent.
//
// Signature is intentionally narrower than HandlerFn (no `user` param — the
// recipient is not a Bimoto user by definition).

import { SmsInboundStatus, type Language, type PrismaClient } from '@prisma/client';
import type { HandlerResult, InboundContext } from '../types';

const CONFIRMATION_WINDOW_MINUTES = 60;

export async function handle(
  ctx: InboundContext,
  prisma: PrismaClient,
): Promise<HandlerResult> {
  const cutoff = new Date(
    ctx.receivedAt.getTime() - CONFIRMATION_WINDOW_MINUTES * 60 * 1000,
  );

  const candidates = await prisma.leg.findMany({
    where: {
      contactPhone: ctx.fromMsisdn,
      type: 'GOODS_DROPOFF',
      status: 'COMPLETED',
      recipientConfirmedAt: null,
      completedAt: { gt: cutoff },
    },
    include: {
      journey: {
        include: {
          customer: { select: { language: true, nickname: true } },
        },
      },
    },
    orderBy: { completedAt: 'desc' },
  });

  if (candidates.length === 0) {
    return {
      status: SmsInboundStatus.NO_MATCHING_JOURNEY,
      replyBody: composeReply('rw', false, null),
    };
  }

  const matched = candidates[0];
  await prisma.leg.update({
    where: { id: matched.id },
    data: {
      recipientConfirmedAt: ctx.receivedAt,
      // R3-RECIPIENT-CONFIRM-2 — stamp the discriminator so the customer-side
      // UI can pick the green ✓ badge (vs. amber AUTO_TIMEOUT / red DISPUTED).
      recipientConfirmStatus: 'EXPLICIT_REPLY',
    },
  });

  return {
    status: SmsInboundStatus.PROCESSED,
    resolvedEntityId: matched.id,
    replyBody: composeReply(
      matched.journey.customer.language,
      true,
      matched.journey.customer.nickname,
    ),
  };
}

function composeReply(
  language: Language,
  matched: boolean,
  customerName: string | null,
): string {
  if (!matched) {
    switch (language) {
      case 'fr':
        return "Bimoto: nous n'avons pas trouve de livraison recente a votre numero. Si vous avez besoin d'aide, contactez l'expediteur.";
      case 'en':
        return "Bimoto: we couldn't find a recent delivery to your phone. If you need help, contact the sender.";
      case 'rw':
      default:
        return 'Bimoto: nta pake yagezweho mu masegonda ashize. Niba ukeneye ubufasha, hamagara uwakoherereje.';
    }
  }

  const sender = customerName?.trim() ?? '';
  switch (language) {
    case 'fr':
      return sender
        ? `Bimoto: merci d'avoir confirme la reception. ${sender} sera notifie(e).`
        : "Bimoto: merci d'avoir confirme la reception. L'expediteur sera notifie(e).";
    case 'en':
      return sender
        ? `Bimoto: thanks for confirming receipt. ${sender} will be notified.`
        : 'Bimoto: thanks for confirming receipt. The sender will be notified.';
    case 'rw':
    default:
      return sender
        ? `Bimoto: murakoze kwemeza ko mwabonye ipake. ${sender} azamenyeshwa.`
        : 'Bimoto: murakoze kwemeza ko mwabonye ipake. Uwakoherereje azamenyeshwa.';
  }
}
