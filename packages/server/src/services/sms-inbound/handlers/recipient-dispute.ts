// R3-RECIPIENT-CONFIRM-2 — recipient SMS-replies a dispute keyword.
//
// Mirror of recipient-confirm.ts, with three differences:
//   - matched leg is stamped with recipientConfirmStatus = 'DISPUTED'
//   - the verbatim SMS body is preserved in recipientDisputeReason so the
//     customer's UI can show the recipient's own words
//   - the locale-aware reply acknowledges the dispute (different wording)
//
// Same 60-min match window as recipient-confirm: the dispute is a reaction
// to the same parcel-delivered SMS. A recipient who takes >60min to
// dispute falls outside the window and gets the polite "couldn't find"
// reply — acceptable for v1 (rare; future calibration could widen the
// window or look up the dispatch row directly).
//
// Invoked from the dispatcher only when sender-lookup fails (no Bimoto
// user) AND the parsed intent is RECIPIENT_DISPUTE. Never called via
// handlerByIntent.

import { SmsInboundStatus, type Language, type PrismaClient } from '@prisma/client';
import type { HandlerResult, InboundContext } from '../types';
import { notifyAdminsOfNewRecipientDispute } from '../../admin-notifications.service';
import { freezeEscrowTx } from '../../escrow.service';

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
          escrow: true,
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
  // R3-RECIPIENT-DISPUTE-ESCROW-FREEZE — stamp the leg DISPUTED and freeze the
  // journey's escrow atomically. Freezing prevents the journey-level 24h
  // auto-confirm cron (auto-confirm.job.ts, which only releases escrow that is
  // still HELD) from paying the disputed funds to the driver before an admin
  // decides. By the time the admin sees the conflict at
  // /admin/conflicts/RECIPIENT_DISPUTE the escrow is FROZEN — directly
  // refundable via refundEscrowTx when the follow-up R3-RECIPIENT-DISPUTE-
  // WIRING-FIX wires decide(). Only freeze from HELD: if a prior dispute (or a
  // customer-initiated disputeJourney) already froze/refunded it, preserve that
  // state — the leg is still stamped DISPUTED so the admin sees the conflict.
  const escrow = (matched as any).journey?.escrow ?? null;
  await prisma.$transaction(async (tx: any) => {
    await tx.leg.update({
      where: { id: matched.id },
      data: {
        recipientConfirmedAt: ctx.receivedAt,
        recipientConfirmStatus: 'DISPUTED',
        recipientDisputeReason: ctx.rawBody,
      },
    });
    if (escrow && escrow.status === 'HELD') {
      await freezeEscrowTx(tx, escrow, matched.journey.customerId);
    }
  });

  // R3-CONFLICTS-NOTIFICATIONS — fire-and-forget admin push so ops
  // staff see new disputes in real time rather than only when they
  // happen to open the conflicts dashboard. Must NOT be awaited:
  // africastalking's inbound webhook has a tight timeout and the
  // dispute MUST be recorded even if the push pipeline is broken.
  notifyAdminsOfNewRecipientDispute({
    legId: matched.id,
    journeyId: matched.journeyId,
    customerNickname: matched.journey.customer.nickname ?? '',
    recipientPhone: ctx.fromMsisdn,
    disputeReason: ctx.rawBody,
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
        ? `Bimoto: nous avons enregistre votre reclamation. ${sender} sera notifie(e).`
        : 'Bimoto: nous avons enregistre votre reclamation. L\'expediteur sera notifie(e).';
    case 'en':
      return sender
        ? `Bimoto: we recorded your dispute. ${sender} will be notified.`
        : 'Bimoto: we recorded your dispute. The sender will be notified.';
    case 'rw':
    default:
      return sender
        ? `Bimoto: twanditse ikibazo cyawe. ${sender} azamenyeshwa.`
        : 'Bimoto: twanditse ikibazo cyawe. Uwakoherereje azamenyeshwa.';
  }
}
