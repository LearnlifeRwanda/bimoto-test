import prisma from '../../prisma';
import { ReconciliationResponse } from '@prisma/client';
import { emitToJourney } from '../../socket';
import { SOCKET_EVENTS } from '@bimoto/shared';

export type ReconcileVerdict = 'BOTH_ARRIVED' | 'CONFLICT';

export interface RecordReconciliationInput {
  journeyId: string;
  respondingUserId: string;
  response: ReconciliationResponse;
  gpsLat?: number | null;
  gpsLng?: number | null;
}

export interface RecordReconciliationResult {
  rowId: string;
  bothPartiesResponded: boolean;
  verdict?: ReconcileVerdict;
}

/**
 * Upserts a reconciliation response for (journeyId, respondingUserId).
 * After the write, queries the OTHER party's response. If both exist:
 *   - BOTH_ARRIVED: both responded ARRIVED_SAFELY
 *   - CONFLICT: any other combination (NEVER_ARRIVED, NEED_HELP, asymmetric)
 */
export async function recordReconciliationResponse(
  input: RecordReconciliationInput,
): Promise<RecordReconciliationResult> {
  const journey = await prisma.journey.findUnique({
    where: { id: input.journeyId },
    select: { id: true, customerId: true, driverId: true },
  });
  if (!journey) throw new Error('JOURNEY_NOT_FOUND');

  const upserted = await prisma.journeyReconciliationResponse.upsert({
    where: {
      journeyId_respondingUserId: {
        journeyId: input.journeyId,
        respondingUserId: input.respondingUserId,
      },
    },
    create: {
      journeyId: input.journeyId,
      respondingUserId: input.respondingUserId,
      response: input.response,
      gpsLat: input.gpsLat ?? null,
      gpsLng: input.gpsLng ?? null,
    },
    update: {
      response: input.response,
      gpsLat: input.gpsLat ?? null,
      gpsLng: input.gpsLng ?? null,
    },
  });

  const otherPartyId =
    journey.customerId === input.respondingUserId ? journey.driverId : journey.customerId;
  if (!otherPartyId) {
    return { rowId: upserted.id, bothPartiesResponded: false };
  }

  const otherResponse = await prisma.journeyReconciliationResponse.findUnique({
    where: {
      journeyId_respondingUserId: {
        journeyId: input.journeyId,
        respondingUserId: otherPartyId,
      },
    },
  });
  if (!otherResponse) {
    return { rowId: upserted.id, bothPartiesResponded: false };
  }

  const bothArrived =
    upserted.response === 'ARRIVED_SAFELY' && otherResponse.response === 'ARRIVED_SAFELY';
  return {
    rowId: upserted.id,
    bothPartiesResponded: true,
    verdict: bothArrived ? 'BOTH_ARRIVED' : 'CONFLICT',
  };
}

export async function getReconciliationStatus(journeyId: string, queryingUserId: string) {
  const journey = await prisma.journey.findUnique({
    where: { id: journeyId },
    select: {
      id: true,
      status: true,
      customerId: true,
      driverId: true,
      destinationName: true,
      reconciliationOpenedAt: true,
      lateCompletion: true,
      customerInitiatedCompletion: true,
    },
  });
  if (!journey) throw new Error('JOURNEY_NOT_FOUND');

  const responses = await prisma.journeyReconciliationResponse.findMany({
    where: { journeyId },
  });
  const ownResponse = responses.find((r) => r.respondingUserId === queryingUserId) ?? null;
  const otherPartyResponse = responses.find((r) => r.respondingUserId !== queryingUserId) ?? null;

  let verdict: ReconcileVerdict | null = null;
  if (ownResponse && otherPartyResponse) {
    verdict =
      ownResponse.response === 'ARRIVED_SAFELY' && otherPartyResponse.response === 'ARRIVED_SAFELY'
        ? 'BOTH_ARRIVED'
        : 'CONFLICT';
  }

  return { ownResponse, otherPartyResponse, verdict, journey };
}

export async function triggerReconciliationOpening(journeyId: string): Promise<void> {
  await prisma.journey.update({
    where: { id: journeyId },
    data: { reconciliationOpenedAt: new Date() },
  });
  emitToJourney(journeyId, SOCKET_EVENTS.JOURNEY_RECONCILIATION_REQUIRED, { journeyId });
}
