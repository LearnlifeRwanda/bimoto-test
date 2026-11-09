// R3-CONFLICTS-RECIPIENT-DISPUTE — recipient-dispute conflict module.
//
// A parcel recipient who replies "WRONG ITEM" / "DAMAGED" / similar to the
// delivered-notification SMS lands at recipient-dispute.ts, which stamps
// Leg.recipientConfirmStatus = DISPUTED + preserves the verbatim SMS body in
// Leg.recipientDisputeReason. R3-RECIPIENT-CONFIRM-2 already shows the
// customer a red ⚠ badge on the journey detail page — but no admin surface
// aggregates these for review. This module wires DISPUTED legs into the
// existing admin conflicts dashboard as the 9th conflict type.
//
// Decisions (the 4 that map cleanly to recipient-dispute resolution):
//   - RESOLVED_REFUND: customer is refunded; parcel was wrong/damaged.
//   - RESOLVED_PAY: driver is paid in full; recipient's complaint dismissed
//     (driver did their job; the sender or recipient was mistaken).
//   - RESOLVED_SPLIT: partial refund + partial driver pay (shared fault).
//   - NO_ACTION: closed without financial movement (e.g. duplicate report).
//
// The admin's decision is recorded as an AdminAction row via the existing
// hash-chain audit service. The Leg's recipientConfirmStatus is preserved
// as DISPUTED forever — the dispute itself is immutable historical state;
// the AdminAction is the resolution layer above it.

import type {
  AdminAction,
  ConflictDecision,
  PrismaClient,
} from '@prisma/client';
import {
  appendAdminActionTx,
  assertConflictUndecidedTx,
} from '../../admin-action-audit.service';
import { appendAuditEntryTx } from '../../../escrow-audit.service';
import { refundEscrowTx, releaseEscrowTx } from '../../../escrow.service';
import { refundMomo } from '../../../payment/refund';
import type {
  ConflictDecisionArgs,
  ConflictDetail,
  ConflictListItem,
  ConflictModule,
} from '../types';

const VALID_DECISIONS: ReadonlyArray<ConflictDecision> = [
  'RESOLVED_REFUND',
  'RESOLVED_PAY',
  'RESOLVED_SPLIT',
  'NO_ACTION',
];

function disputeSummary(leg: any): string {
  const reason = (leg.recipientDisputeReason ?? '').trim();
  const truncatedReason =
    reason.length > 60 ? `${reason.slice(0, 57)}…` : reason || '(no reason)';
  const contact = leg.contactName ?? leg.contactPhone ?? 'recipient';
  return `Recipient ${contact} disputed leg #${leg.sequence ?? '?'}: ${truncatedReason}`;
}

async function listOpen(
  prisma: PrismaClient,
  opts: { limit: number },
): Promise<ConflictListItem[]> {
  const legs = await prisma.leg.findMany({
    where: { recipientConfirmStatus: 'DISPUTED' },
    orderBy: { recipientConfirmedAt: 'desc' },
    take: opts.limit,
  });
  const decided = await prisma.adminAction.findMany({
    where: {
      action: 'RESOLVE_RECIPIENT_DISPUTE',
      targetType: 'LEG',
      targetId: { in: legs.map((l: any) => l.id) },
    },
    select: { targetId: true },
  });
  const decidedIds = new Set<string>(decided.map((d: any) => d.targetId));
  return legs
    .filter((l: any) => !decidedIds.has(l.id))
    .map((l: any) => ({
      id: l.id,
      type: 'RECIPIENT_DISPUTE' as const,
      summary: disputeSummary(l),
      createdAt: l.recipientConfirmedAt ?? l.updatedAt ?? l.createdAt,
      metadata: {
        journeyId: l.journeyId,
        sequence: l.sequence,
        contactPhone: l.contactPhone,
        parcelSize: l.parcelSize,
        parcelCategory: l.parcelCategory,
      },
    }));
}

async function countOpen(prisma: PrismaClient): Promise<number> {
  return (await listOpen(prisma, { limit: 1000 })).length;
}

async function getDetail(
  prisma: PrismaClient,
  id: string,
): Promise<ConflictDetail | null> {
  const leg = await prisma.leg.findUnique({
    where: { id },
    include: {
      journey: {
        include: {
          customer: { select: { id: true, nickname: true } },
          driver: { select: { id: true, nickname: true } },
        },
      },
    },
  });
  if (!leg || leg.recipientConfirmStatus !== 'DISPUTED') return null;

  const priorActions = await prisma.adminAction.findMany({
    where: {
      action: 'RESOLVE_RECIPIENT_DISPUTE',
      targetType: 'LEG',
      targetId: id,
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      adminId: true,
      conflictDecision: true,
      reason: true,
      createdAt: true,
    },
  });

  return {
    id: leg.id,
    type: 'RECIPIENT_DISPUTE',
    summary: disputeSummary(leg),
    createdAt: leg.recipientConfirmedAt ?? leg.updatedAt ?? leg.createdAt,
    data: {
      leg: {
        id: leg.id,
        journeyId: leg.journeyId,
        sequence: leg.sequence,
        // DECRYPT v3 G5 — thawed. `Leg` has no `stopType` column; the schema
        // field is `type` (LegType), and the cast that used to sit here read
        // it off a shape the database never returns, so production shipped
        // this key as undefined while two suites kept it green from
        // hand-built mocks. The key name is unchanged — the admin detail
        // view renders the payload generically (AdminConflictDetail.tsx
        // walks Object.keys and stringifies each value, reading no key by
        // name), so nothing downstream depends on it — and the value is now
        // the real LegType.
        stopType: leg.type,
        contactName: leg.contactName,
        contactPhone: leg.contactPhone,
        parcelSize: leg.parcelSize,
        parcelCategory: leg.parcelCategory,
        recipientConfirmStatus: leg.recipientConfirmStatus,
        recipientConfirmedAt: leg.recipientConfirmedAt,
        recipientDisputeReason: leg.recipientDisputeReason,
        completedAt: leg.completedAt,
      },
      journey: leg.journey
        ? {
            id: leg.journey.id,
            type: leg.journey.type,
            agreedPrice: leg.journey.agreedPrice,
            status: leg.journey.status,
            createdAt: leg.journey.createdAt,
          }
        : null,
      customer: leg.journey?.customer ?? null,
      driver: leg.journey?.driver ?? null,
      priorActions,
    },
  };
}

async function decide(
  args: ConflictDecisionArgs,
  prisma: PrismaClient,
): Promise<AdminAction> {
  if (!VALID_DECISIONS.includes(args.decision)) {
    const err: any = new Error('INVALID_DECISION');
    err.code = 'INVALID_DECISION';
    throw err;
  }
  // R3-FLW-RECIPIENT-DISPUTE-REFUND-INTEGRATION — pre-$transaction MoMo refund
  // call. We deliberately fire the gateway call BEFORE the prisma.$transaction
  // so a network failure aborts the whole settlement (escrow stays FROZEN,
  // audit not written) rather than producing partial state (money moved at the
  // gateway, system record missing). If it throws, we never enter the
  // transaction; the admin retries (Flutterwave dedupes refunds by source tx
  // id, so retries are safe). We skip the gateway when no real money moved —
  // the SAME conditions as the in-tx settlement (escrow FROZEN) plus the
  // synthetic-payment skips: E2E_FAKE_PAYMENTS=1, null flwTxId, or a synthetic
  // 'e2e-' flwTxId. Mirrors PR #93's stale-no-show pattern.
  let flwRefundTxId: string | undefined;
  if (args.decision === 'RESOLVED_REFUND') {
    const pre = await prisma.leg.findUnique({
      where: { id: args.id },
      include: { journey: { include: { escrow: true } } },
    });
    const preEscrow = pre?.journey?.escrow ?? null;
    if (
      pre?.recipientConfirmStatus === 'DISPUTED' &&
      preEscrow &&
      preEscrow.status === 'FROZEN' &&
      preEscrow.flwTxId &&
      !String(preEscrow.flwTxId).startsWith('e2e-') &&
      process.env.E2E_FAKE_PAYMENTS !== '1'
    ) {
      const refundResult = await refundMomo({
        flwTxId: preEscrow.flwTxId,
        amount: preEscrow.amount,
        escrowId: preEscrow.id,
        reason: 'recipient-dispute-resolved-refund',
      });
      flwRefundTxId = refundResult.flwRefundTxId ?? undefined;
    }
  }

  return prisma.$transaction(async (tx: any) => {
    // BID-ATOMICITY G4 — single-winner: claim the decision before any
    // side-effect. A racing second admin serializes on the advisory
    // lock, sees the winner's AdminAction, and gets ALREADY_DECIDED
    // (409) with the whole transaction rolled back.
    await assertConflictUndecidedTx(tx, {
      action: 'RESOLVE_RECIPIENT_DISPUTE',
      targetType: 'LEG',
      targetId: args.id,
      conflictType: 'RECIPIENT_DISPUTE',
    });

    const leg = await tx.leg.findUnique({ where: { id: args.id } });
    if (!leg) {
      const err: any = new Error('LEG_NOT_FOUND');
      err.code = 'LEG_NOT_FOUND';
      throw err;
    }
    if (leg.recipientConfirmStatus !== 'DISPUTED') {
      const err: any = new Error('LEG_NOT_DISPUTED');
      err.code = 'LEG_NOT_DISPUTED';
      throw err;
    }

    // R3-RECIPIENT-DISPUTE-WIRING-FIX — escrow-only settlement.
    // Recipient-dispute is LEG-level: the parcel was delivered (leg COMPLETED)
    // and the journey is in its normal lifecycle (AWAITING_CONFIRMATION, or
    // COMPLETED post-auto-confirm) — NOT DISPUTED. So there is no journey
    // transition to make (ADMIN_REFUND/ADMIN_PAY only exit DISPUTED/MATCHED);
    // the journey completes via the standard auto-confirm path independently.
    // We only move the escrow, which PR #94 froze on dispute-SMS arrival.
    let crossLinkedEscrowAuditLogId: string | undefined;
    if (args.decision === 'RESOLVED_REFUND' || args.decision === 'RESOLVED_PAY') {
      const escrow = await tx.escrow.findUnique({
        where: { journeyId: leg.journeyId },
      });
      if (!escrow) {
        const err: any = new Error('ESCROW_NOT_FOUND');
        err.code = 'ESCROW_NOT_FOUND';
        throw err;
      }
      // Runtime guard: the escrow must be FROZEN (PR #94 freezes it when the
      // recipient-dispute SMS arrives). If it is RELEASED — the manual
      // customer-confirm edge surfaced in PR #94, where confirmJourney released
      // the escrow before the admin decided — settling here is impossible
      // without clawback design, so fail loudly rather than leave partial state.
      if (escrow.status !== 'FROZEN') {
        const err: any = new Error(
          `RECIPIENT_DISPUTE: cannot ${args.decision} — escrow is ${escrow.status} (expected FROZEN)`,
        );
        err.code = 'ESCROW_NOT_FROZEN';
        throw err;
      }

      const auditKind =
        args.decision === 'RESOLVED_REFUND'
          ? 'ADMIN_RECIPIENT_DISPUTE_REFUND'
          : 'ADMIN_RECIPIENT_DISPUTE_PAY';
      await appendAuditEntryTx(tx, escrow.id, auditKind, escrow.amount, args.adminId, {
        reason: args.reason,
        journeyId: leg.journeyId,
        legId: leg.id,
      });
      const log = await tx.escrowAuditLog.findFirst({
        where: { escrowId: escrow.id },
        orderBy: { sequenceNumber: 'desc' },
        select: { id: true },
      });
      crossLinkedEscrowAuditLogId = log?.id;

      if (args.decision === 'RESOLVED_REFUND') {
        // escrow FROZEN → REFUNDED. flwRefundTxId (populated above on the
        // real-money path) is recorded in the REFUNDED audit entry's metadata
        // by refundEscrowTx's internal audit-write.
        await refundEscrowTx(tx, escrow, args.adminId, flwRefundTxId);
      } else {
        // escrow FROZEN → RELEASED; driver credited via creditDriverBalance.
        await releaseEscrowTx(tx, escrow, args.adminId);
      }
    }
    // RESOLVED_SPLIT and NO_ACTION: audit-only (SPLIT deferred to
    // R3-SPLIT-SEMANTICS — no partial-amount schema). The leg's DISPUTED status
    // is intentionally preserved forever; the AdminAction is the resolution
    // layer above it.

    return appendAdminActionTx(tx, {
      adminId: args.adminId,
      action: 'RESOLVE_RECIPIENT_DISPUTE',
      targetType: 'LEG',
      targetId: args.id,
      reason: args.reason,
      payload: {
        journeyId: leg.journeyId,
        sequence: leg.sequence,
        disputeReason: leg.recipientDisputeReason,
      },
      conflictType: 'RECIPIENT_DISPUTE',
      conflictDecision: args.decision,
      crossLinkedEscrowAuditLogId,
    });
  });
}

export const recipientDisputeModule: ConflictModule = {
  type: 'RECIPIENT_DISPUTE',
  validDecisions: VALID_DECISIONS,
  listOpen,
  countOpen,
  getDetail,
  decide,
};
