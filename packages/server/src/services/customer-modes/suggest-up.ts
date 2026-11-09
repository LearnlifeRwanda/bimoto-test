// SERVICES/CUSTOMER-MODES/SUGGEST-UP.TS
//
// Dispatch K3 — progressive suggest-up.
//
// Two tiers:
//   T1 = +50 RWF, available at 60s
//   T2 = +100 RWF, available at 120s (alongside T1)
//
// The customer sees one button at 60s, two buttons at 120s — never
// overwhelmed, escalation always opt-in. Each tap increments
// suggestUpCount and bumps wishPrice. The cascade re-broadcast that
// drivers see is K1's existing pattern — we emit a Socket.io event
// that K1's listeners pick up.

import type { PrismaClient } from '@prisma/client';
import type { Server as SocketIOServer } from 'socket.io';
import {
  SUGGEST_UP_TIER_1_AT_SECONDS,
  SUGGEST_UP_TIER_2_AT_SECONDS,
  SUGGEST_UP_TIER_1_AMOUNT_RWF,
  SUGGEST_UP_TIER_2_AMOUNT_RWF,
  SUGGEST_UP_VALID_AMOUNTS,
} from './config';
import type { SuggestUpStatus, SuggestUpValidation } from './types';
import { SOCKET_EVENTS } from '@bimoto/shared';

interface JourneyForValidation {
  id: string;
  customerId: string;
  status: string;
  discoveryStartedAt: Date | null;
  suggestUpCount: number;
  wishPrice: number | null;
}

export function validateSuggestUp(
  journey: JourneyForValidation,
  customerId: string,
  addRwf: number,
  now: Date = new Date(),
): SuggestUpValidation {
  if (journey.customerId !== customerId) {
    return { valid: false, reason: 'not-owner' };
  }
  if (journey.status !== 'REQUESTED') {
    return { valid: false, reason: 'journey-not-open' };
  }
  if (!SUGGEST_UP_VALID_AMOUNTS.includes(addRwf)) {
    return { valid: false, reason: 'invalid-amount' };
  }
  const start = journey.discoveryStartedAt ?? null;
  if (!start) {
    // Defensive: a REQUESTED journey should always have discoveryStartedAt.
    return { valid: false, reason: 'journey-not-open' };
  }
  const elapsedSec = (now.getTime() - start.getTime()) / 1000;
  if (addRwf === SUGGEST_UP_TIER_1_AMOUNT_RWF) {
    if (elapsedSec < SUGGEST_UP_TIER_1_AT_SECONDS) {
      return { valid: false, reason: 'too-early' };
    }
    return { valid: true, reason: 'ok' };
  }
  if (addRwf === SUGGEST_UP_TIER_2_AMOUNT_RWF) {
    if (elapsedSec < SUGGEST_UP_TIER_2_AT_SECONDS) {
      return { valid: false, reason: 'amount-not-yet-available' };
    }
    return { valid: true, reason: 'ok' };
  }
  // Defensive: if SUGGEST_UP_VALID_AMOUNTS contains a value the
  // tier-by-tier branches don't recognise, treat as invalid.
  return { valid: false, reason: 'invalid-amount' };
}

export interface ApplySuggestUpResult {
  newWishPrice: number;
  suggestUpCount: number;
}

export async function applySuggestUp(
  prisma: PrismaClient,
  io: SocketIOServer | null,
  journeyId: string,
  customerId: string,
  addRwf: number,
  now: Date = new Date(),
): Promise<ApplySuggestUpResult> {
  const journey = await prisma.journey.findUnique({ where: { id: journeyId } });
  if (!journey) {
    throw new Error('JOURNEY_NOT_FOUND');
  }
  const validation = validateSuggestUp(
    {
      id: journey.id,
      customerId: journey.customerId,
      status: journey.status,
      discoveryStartedAt: journey.discoveryStartedAt,
      suggestUpCount: journey.suggestUpCount ?? 0,
      wishPrice: journey.wishPrice,
    },
    customerId,
    addRwf,
    now,
  );
  if (!validation.valid) {
    throw new Error(`SUGGEST_UP_INVALID:${validation.reason}`);
  }

  const baseWish = journey.wishPrice ?? 0;
  const newWishPrice = baseWish + addRwf;

  const updated = await prisma.journey.update({
    where: { id: journeyId },
    data: {
      wishPrice: newWishPrice,
      suggestUpCount: { increment: 1 },
    },
  });

  // Emit a wish-price-updated event so K1's cascade listeners can
  // re-broadcast to drivers in the current ring. The downstream
  // consumer is the existing K1 pattern; we don't reimplement it.
  if (io) {
    io.to(`journey:${journeyId}`).emit(SOCKET_EVENTS.JOURNEY_WISH_PRICE_UPDATED, {
      journeyId,
      wishPrice: newWishPrice,
      suggestUpCount: updated.suggestUpCount,
      addRwf,
    });
  }

  return {
    newWishPrice,
    suggestUpCount: updated.suggestUpCount,
  };
}

export function getSuggestUpStatus(
  journey: { discoveryStartedAt: Date | null; suggestUpCount: number },
  now: Date = new Date(),
): SuggestUpStatus {
  const start = journey.discoveryStartedAt;
  if (!start) {
    return {
      availableAmounts: [],
      alreadyTakenCount: journey.suggestUpCount ?? 0,
      nextAmountAvailableAt: null,
    };
  }
  const elapsedSec = (now.getTime() - start.getTime()) / 1000;
  const tier1Ms = SUGGEST_UP_TIER_1_AT_SECONDS * 1000;
  const tier2Ms = SUGGEST_UP_TIER_2_AT_SECONDS * 1000;

  if (elapsedSec < SUGGEST_UP_TIER_1_AT_SECONDS) {
    return {
      availableAmounts: [],
      alreadyTakenCount: journey.suggestUpCount ?? 0,
      nextAmountAvailableAt: new Date(start.getTime() + tier1Ms),
    };
  }
  if (elapsedSec < SUGGEST_UP_TIER_2_AT_SECONDS) {
    return {
      availableAmounts: [SUGGEST_UP_TIER_1_AMOUNT_RWF],
      alreadyTakenCount: journey.suggestUpCount ?? 0,
      nextAmountAvailableAt: new Date(start.getTime() + tier2Ms),
    };
  }
  return {
    availableAmounts: [
      SUGGEST_UP_TIER_1_AMOUNT_RWF,
      SUGGEST_UP_TIER_2_AMOUNT_RWF,
    ],
    alreadyTakenCount: journey.suggestUpCount ?? 0,
    nextAmountAvailableAt: null,
  };
}
