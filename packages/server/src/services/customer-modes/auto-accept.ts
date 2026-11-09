// SERVICES/CUSTOMER-MODES/AUTO-ACCEPT.TS
//
// Dispatch K3 — auto-accept evaluator for NEED_TO_GO journeys.
//
// Two layers:
//   1. bidQualifiesForAutoAccept — pure check, no DB. Compares the
//      bid against the journey's locked priceCeilingRwf (NOT
//      wishPrice — that's the smallest-wrongness gotcha) and the
//      auto-accept window. Single source of truth for "should this
//      fire?".
//   2. tryAutoAcceptBid — full evaluator. Reads the journey as a cheap
//      eligibility pre-filter, then reuses the existing acceptBid path
//      so vehicle / ownership / journey-status / commission / escrow
//      checks all run identically to the manual customer-tap accept.
//
// BID-ATOMICITY G2 — the single-winner arbiter is acceptBid's atomic
// claim (status-predicated updates inside one transaction, see
// acceptBidCore), NOT a lock here. This module previously took SELECT
// FOR UPDATE on the journey row in its own transaction — but that lock
// died with the transaction, before acceptBid ran, so it proved the
// journey WAS eligible without protecting the acceptance itself.
// Holding the lock across acceptBid would instead mean threading a
// transaction through acceptBid's signature and pinning a journey row
// lock across gateway I/O (chargeMomo), so the lock is deliberately
// degraded to a plain read: a stale read here costs one no-op acceptBid
// call, never a mis-accept. A lost race surfaces as acceptBid's
// BID_NOT_PENDING and maps to the calm 'race-lost' no-op.
//
// Idempotency: re-calling tryAutoAcceptBid on a journey that's already
// MATCHED returns {triggered: false, reason: 'race-lost'} without
// invoking acceptBid a second time.

import type { PrismaClient, Prisma } from '@prisma/client';
import { acceptBid } from '../bid.service';
import { systemActor } from '../session-actor';
import { AUTO_ACCEPT_WINDOW_SECONDS } from './config';
import type {
  AutoAcceptResult,
  RequestMode,
  AutoAcceptReason,
} from './types';

interface JourneyLike {
  status: string;
  requestMode: RequestMode | string;
  priceCeilingRwf: number | null;
  discoveryStartedAt: Date | null;
}

interface BidLike {
  price: number;
  createdAt: Date;
}

export interface QualifiesResult {
  qualifies: boolean;
  reason: AutoAcceptReason | 'qualifies';
}

export function bidQualifiesForAutoAccept(
  journey: JourneyLike,
  bid: BidLike,
  windowSeconds: number = AUTO_ACCEPT_WINDOW_SECONDS,
  now: Date = new Date(),
): QualifiesResult {
  if (journey.requestMode !== 'NEED_TO_GO') {
    return { qualifies: false, reason: 'mode-not-need-to-go' };
  }
  if (journey.status !== 'REQUESTED') {
    return { qualifies: false, reason: 'journey-not-open' };
  }
  if (journey.priceCeilingRwf === null || journey.priceCeilingRwf === undefined) {
    return { qualifies: false, reason: 'no-ceiling-set' };
  }
  // CRITICAL: compare against priceCeilingRwf (the locked ceiling),
  // NOT wishPrice. The customer committed with a known number when
  // they ticked NEED_TO_GO; that number is the ceiling.
  if (bid.price > journey.priceCeilingRwf) {
    return { qualifies: false, reason: 'price-exceeds-ceiling' };
  }
  const start = journey.discoveryStartedAt;
  if (start) {
    const windowEndsAt = new Date(start.getTime() + windowSeconds * 1000);
    if (now > windowEndsAt) {
      return { qualifies: false, reason: 'window-expired' };
    }
  }
  return { qualifies: true, reason: 'qualifies' };
}

interface EligibleJourneyRow {
  id: string;
  customerId: string;
  status: string;
  requestMode: string;
  priceCeilingRwf: number | null;
  discoveryStartedAt: Date | null;
}

// Allow tests to override acceptBid without spinning up the full
// payment / escrow stack.
type AcceptBidFn = typeof acceptBid;
let acceptBidImpl: AcceptBidFn = acceptBid;
export function _setAcceptBidForTests(fn: AcceptBidFn | null): void {
  acceptBidImpl = fn ?? acceptBid;
}

export async function tryAutoAcceptBid(
  prisma: PrismaClient,
  journeyId: string,
  bidId: string,
  now: Date = new Date(),
): Promise<AutoAcceptResult> {
  // BID-ATOMICITY G2 — eligibility pre-filter, not an arbiter. A plain
  // read: a journey already off REQUESTED exits cheaply; a journey that
  // loses the race AFTER this read is caught by acceptBid's atomic
  // claim below.
  const eligible = await prisma.journey.findUnique({
    where: { id: journeyId },
    select: {
      id: true,
      customerId: true,
      status: true,
      requestMode: true,
      priceCeilingRwf: true,
      discoveryStartedAt: true,
    },
  }) as EligibleJourneyRow | null;

  if (!eligible || eligible.status !== 'REQUESTED') {
    return { triggered: false, bidId: null, reason: 'race-lost' };
  }

  const bid = await prisma.bid.findUnique({ where: { id: bidId } });
  if (!bid) {
    return { triggered: false, bidId: null, reason: 'bid-missing' };
  }

  const check = bidQualifiesForAutoAccept(
    {
      status: eligible.status,
      requestMode: eligible.requestMode,
      priceCeilingRwf: eligible.priceCeilingRwf,
      discoveryStartedAt: eligible.discoveryStartedAt,
    },
    { price: bid.price, createdAt: bid.createdAt },
    AUTO_ACCEPT_WINDOW_SECONDS,
    now,
  );
  if (!check.qualifies) {
    return {
      triggered: false,
      bidId: null,
      reason: check.reason as AutoAcceptReason,
    };
  }

  // Reuse the existing manual-accept path. Same vehicle, ownership,
  // journey-status, commission, escrow flow — auto-accept is just a
  // different trigger for the same state machine. acceptBid's atomic
  // claim is the single-winner arbiter: if a manual accept (or another
  // auto-accept) wins the race between our read above and this call,
  // the claim throws BID_NOT_PENDING and we report a calm race-lost —
  // the loser mutated nothing.
  try {
    // CUTGUARD v2 G4 — a NAMED system actor, not the journey's own
    // customer id.
    //
    // This passed `eligible.customerId`, a fetched record, which made
    // acceptBidCore's customer check compare the row against itself.
    // Harmless here — a cron has no session to check, and the eligibility
    // filter above is what authorises the accept — but it was spelled
    // exactly like the tautology that was NOT harmless (U-1, the
    // scheduled-ride conflict-acknowledge route). `systemActor` says out
    // loud that no session is acting, so nobody has to work out which of
    // the two this is.
    await acceptBidImpl(eligible.id, systemActor('customer-modes/auto-accept'), bid.id, {});
  } catch (err) {
    if ((err as { code?: string })?.code === 'BID_NOT_PENDING') {
      return { triggered: false, bidId: null, reason: 'race-lost' };
    }
    throw err;
  }
  return { triggered: true, bidId: bid.id, reason: 'auto-accepted' };
}

// Test-only Prisma type helper — keeps the production import surface
// minimal but lets the test file ergonomically construct mock clients.
export type _PrismaTransactionFn = Prisma.TransactionClient;
