// R3-LEGS — multi-stop trip foundation. Pure service-layer logic for
// leg creation, validation, and state transitions. Pilot-invisible:
// single-leg journeys (the entirety of pilot v1 traffic to date) ship
// with legs: [] and never enter this code path. R3-DELIVERY and
// R3-POOL build on top of this primitive.

import type { Prisma } from '@prisma/client';
import prisma from '../../prisma';
import type { LegInput } from '@bimoto/shared';
import {
  notifyRecipientParcelDelivered,
  notifyCustomerDriverArrivedAtPickup,
} from '../recipient-sms-notification.service';
import { decryptedPhoneOrNull } from '../user-phone';

export type LegValidationCode =
  | 'EMPTY_LEGS_OK' // legs.length === 0 — single-leg journey, valid
  | 'WAIT_AT_BOUNDARY' // first or last leg is WAIT
  | 'INVALID_LAT_LNG' // lat/lng out of valid range
  | 'EMPTY_NAME' // leg.name is empty/whitespace
  | 'PARCEL_SIZE_ON_NON_GOODS_LEG' // R3-DELIVERY — parcelSize set but type !== GOODS_*
  | 'PARCEL_SIZE_REQUIRED_FOR_GOODS_LEG' // R3-DELIVERY — type is GOODS_* but parcelSize missing
  | 'PARCEL_CATEGORY_ON_NON_GOODS_LEG'; // R3-DELIVERY-V2 — parcelCategory set but type !== GOODS_*

export type LegValidationResult =
  | { valid: true }
  | { valid: false; reason: string; code: LegValidationCode };

/**
 * R3-LEGS — sequence validation for an input array of legs. Empty
 * arrays are always valid (single-leg journey). Each leg must have
 * valid lat/lng, a non-empty name, and WAIT legs cannot appear at
 * the first or last position (a journey must start and end with
 * something concrete — pickup is the journey origin and the final
 * leg must be a real dropoff or pickup, never a wait state).
 */
export function validateLegSequence(legs: LegInput[]): LegValidationResult {
  if (legs.length === 0) return { valid: true };
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    if (leg.lat < -90 || leg.lat > 90 || leg.lng < -180 || leg.lng > 180) {
      return {
        valid: false,
        reason: `Leg ${i} has invalid lat/lng`,
        code: 'INVALID_LAT_LNG',
      };
    }
    if (!leg.name || !leg.name.trim()) {
      return {
        valid: false,
        reason: `Leg ${i} has empty name`,
        code: 'EMPTY_NAME',
      };
    }
    if (leg.type === 'WAIT' && (i === 0 || i === legs.length - 1)) {
      return {
        valid: false,
        reason: `Leg ${i} is WAIT at sequence boundary`,
        code: 'WAIT_AT_BOUNDARY',
      };
    }
    // R3-DELIVERY — parcel-size × leg-type cross-validation. Goods
    // stops require a parcelSize (drives the parcelMultiplier in
    // fair-price.service); non-goods stops MUST NOT carry one.
    const isGoodsLeg = leg.type === 'GOODS_PICKUP' || leg.type === 'GOODS_DROPOFF';
    if (isGoodsLeg && !leg.parcelSize) {
      return {
        valid: false,
        reason: `Leg ${i} is a goods stop but has no parcelSize`,
        code: 'PARCEL_SIZE_REQUIRED_FOR_GOODS_LEG',
      };
    }
    if (!isGoodsLeg && leg.parcelSize) {
      return {
        valid: false,
        reason: `Leg ${i} is type ${leg.type} but has parcelSize set`,
        code: 'PARCEL_SIZE_ON_NON_GOODS_LEG',
      };
    }
    // R3-DELIVERY-V2 — parcelCategory mirrors parcelSize's non-goods
    // forbidden rule, but is OPTIONAL on goods legs (no required-for
    // counterpart — UI defaults to OTHER on submit).
    if (!isGoodsLeg && leg.parcelCategory) {
      return {
        valid: false,
        reason: `Leg ${i} is type ${leg.type} but has parcelCategory set`,
        code: 'PARCEL_CATEGORY_ON_NON_GOODS_LEG',
      };
    }
  }
  return { valid: true };
}

/**
 * R3-LEGS — create legs for a journey within a transaction. Caller
 * passes the Prisma transaction client to keep the journey + its
 * legs atomic. Sequence is assigned 0..N-1 in input order.
 */
export async function createLegsForJourney(
  tx: Prisma.TransactionClient,
  journeyId: string,
  legs: LegInput[],
): Promise<void> {
  if (legs.length === 0) return;
  await tx.leg.createMany({
    data: legs.map((leg, sequence) => ({
      journeyId,
      sequence,
      type: leg.type,
      lat: leg.lat,
      lng: leg.lng,
      name: leg.name,
      contactName: leg.contactName ?? null,
      contactPhone: leg.contactPhone ?? null,
      expectedDurationMinutes: leg.expectedDurationMinutes ?? null,
      parcelSize: leg.parcelSize ?? null,
      parcelCategory: leg.parcelCategory ?? null,
      recipientLanguage: leg.recipientLanguage ?? null,
    })),
  });
}

/**
 * R3-LEGS — mark a single leg as completed. The driver taps
 * "completed this stop" via POST /api/journeys/:id/legs/:legId/complete.
 * State transitions are PENDING → ACTIVE → COMPLETED (the ACTIVE state
 * is for future use when a "I'm at this stop" indicator ships in
 * R3-DELIVERY's UI; the V1 endpoint goes straight to COMPLETED).
 *
 * The composite where clause (legId AND journeyId) ensures a driver
 * cannot mark a leg complete on a journey they are not assigned to,
 * even if they somehow craft a request with another journey's legId.
 */
export async function markLegCompleted(
  legId: string,
  journeyId: string,
): Promise<void> {
  const result = await prisma.leg.updateMany({
    where: { id: legId, journeyId },
    data: { status: 'COMPLETED', completedAt: new Date() },
  });
  if (result.count === 0) {
    throw new Error('Leg not found for journey');
  }

  // R3-DELIVERY-NOTIFICATIONS — fire-and-forget parcel-delivered SMS
  // to the recipient when a GOODS_DROPOFF leg with contactPhone is
  // marked complete. Fetched post-update so the main flow's success
  // does not depend on SMS dispatch.
  const leg = await prisma.leg.findUnique({ where: { id: legId } });
  if (
    leg &&
    leg.type === 'GOODS_DROPOFF' &&
    leg.contactPhone &&
    leg.contactPhone.trim() !== ''
  ) {
    const journey = await prisma.journey.findUnique({
      where: { id: journeyId },
      include: {
        customer: { select: { nickname: true, phoneEncrypted: true, language: true } },
      },
    });
    if (journey?.customer) {
      notifyRecipientParcelDelivered({
        recipientPhone: leg.contactPhone,
        // R3-DELIVERY-NOTIFICATIONS-2 — per-leg language hint wins; falls
        // back to the customer's language when unset.
        language: leg.recipientLanguage ?? journey.customer.language,
        customerName: journey.customer.nickname,
        // The recipient is told "contact {name} at {number}" — it has to
        // be a number they can actually dial, not the stored ciphertext.
        customerPhone: decryptedPhoneOrNull(journey.customer) ?? '',
      });
    }
  }
}

/**
 * R3-DELIVERY-NOTIFICATIONS-2 — flip a PENDING leg to ACTIVE. Mirrors
 * markLegCompleted's composite-where pattern (legId AND journeyId) so a
 * driver cannot activate a leg on a journey they are not assigned to.
 *
 * When a GOODS_PICKUP leg becomes ACTIVE, fires a fire-and-forget SMS
 * to the journey's customer ("the moto-taxi has arrived at the pickup
 * point") — the customer wants to know pickup happened so they can
 * stop wondering between the en-route SMS and the delivered SMS.
 *
 * The ACTIVE LegStatus has existed since R3-LEGS but was never used
 * by any code path; this dispatch is its first user.
 */
export async function markLegActive(
  legId: string,
  journeyId: string,
): Promise<void> {
  const result = await prisma.leg.updateMany({
    where: { id: legId, journeyId },
    data: { status: 'ACTIVE' },
  });
  if (result.count === 0) {
    throw new Error('Leg not found for journey');
  }

  const leg = await prisma.leg.findUnique({ where: { id: legId } });
  if (leg && leg.type === 'GOODS_PICKUP') {
    const journey = await prisma.journey.findUnique({
      where: { id: journeyId },
      include: {
        customer: { select: { phoneEncrypted: true, language: true } },
      },
    });
    if (journey?.customer) {
      notifyCustomerDriverArrivedAtPickup({
        customerPhone: decryptedPhoneOrNull(journey.customer),
        language: journey.customer.language,
      });
    }
  }
}

/**
 * R3-LEGS — fetch a journey's legs in execution order (sequence asc).
 */
export async function getJourneyLegs(journeyId: string) {
  return prisma.leg.findMany({
    where: { journeyId },
    orderBy: { sequence: 'asc' },
  });
}
