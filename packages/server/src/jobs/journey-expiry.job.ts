import prisma from '../prisma';
import {
  JOURNEY_EXPIRY_MINUTES,
  JourneyStatus,
  JourneyAction,
  transitionJourney,
  BidStatus,
  BidAction,
  transitionBid,
  SOCKET_EVENTS,
} from '@bimoto/shared';
import { emitToJourney } from '../socket';
import {
  findStaleInProgressJourneys,
  assertStaleAndInterrupt,
} from '../services/journey-resilience';
import { onJourneyExitsRequested } from '../services/journey-state-transitions';
import { withJobLock } from '../services/job-lock';

let intervalId: NodeJS.Timeout | null = null;

async function processJourneyExpiry() {
  try {
    const expiryThreshold = new Date(Date.now() - JOURNEY_EXPIRY_MINUTES * 60 * 1000);

    const journeys = await prisma.journey.findMany({
      where: {
        status: JourneyStatus.REQUESTED,
        createdAt: { lt: expiryThreshold },
      },
      include: {
        bids: {
          where: { status: BidStatus.PENDING },
        },
      },
    });

    for (const journey of journeys) {
      try {
        const nextStatus = transitionJourney(
          journey.status as JourneyStatus,
          JourneyAction.EXPIRE,
        );

        await prisma.journey.update({
          where: { id: journey.id },
          data: { status: nextStatus },
        });

        // Dispatch Q — REQUESTED→EXPIRED: cancel suggest-up timers.
        onJourneyExitsRequested(journey.id, 'journey-expired');

        // Decline all pending bids
        for (const bid of journey.bids) {
          try {
            const nextBidStatus = transitionBid(
              bid.status as BidStatus,
              BidAction.DECLINE,
            );

            await prisma.bid.update({
              where: { id: bid.id },
              data: { status: nextBidStatus },
            });

            emitToJourney(journey.id, SOCKET_EVENTS.BID_DECLINED, {
              bidId: bid.id,
              journeyId: journey.id,
              driverId: bid.driverId,
              reason: 'journey_expired',
            });
          } catch (error) {
            console.error(`[JOURNEY-EXPIRY] Error declining bid ${bid.id}:`, error);
          }
        }

        emitToJourney(journey.id, SOCKET_EVENTS.JOURNEY_EXPIRED, {
          journeyId: journey.id,
          status: nextStatus,
        });
      } catch (error) {
        console.error(`[JOURNEY-EXPIRY] Error expiring journey ${journey.id}:`, error);
      }
    }

    if (journeys.length > 0) {
      console.log(`[JOURNEY-EXPIRY] Expired ${journeys.length} REQUESTED journeys`);
    }

    // Also expire MATCHED journeys where the driver hasn't started after 30 minutes
    const matchedExpiryThreshold = new Date(Date.now() - 30 * 60 * 1000);
    const staleMatchedJourneys = await prisma.journey.findMany({
      where: {
        status: JourneyStatus.MATCHED,
        updatedAt: { lt: matchedExpiryThreshold },
      },
      include: { escrow: true },
    });

    for (const journey of staleMatchedJourneys) {
      try {
        const nextStatus = transitionJourney(
          journey.status as JourneyStatus,
          JourneyAction.EXPIRE,
        );

        // MONEY-ATOMIC G4 — expiring a matched journey and refunding the
        // customer's escrow are ONE unit.
        //
        // They were two statements inside a catch that only logged. If the
        // refund threw, the journey was already committed EXPIRED, the loop
        // moved on, and the next tick's `status: MATCHED` filter no longer
        // matched it: the customer's money stayed HELD forever with a
        // console line as the only trace. Rolling the EXPIRED stamp back
        // with the refund is what makes the retry happen — the journey
        // stays MATCHED and the next tick picks it up again.
        await prisma.$transaction(async (tx: any) => {
          await tx.journey.update({
            where: { id: journey.id },
            data: { status: nextStatus },
          });

          // Refund escrow if it exists
          if (journey.escrow && journey.escrow.status === 'HELD') {
            await tx.escrow.update({
              where: { journeyId: journey.id },
              data: { status: 'REFUNDED' },
            });
          }
        });

        emitToJourney(journey.id, SOCKET_EVENTS.JOURNEY_EXPIRED, {
          journeyId: journey.id,
          status: nextStatus,
          reason: 'driver_no_show',
        });
      } catch (error) {
        // The whole unit rolled back, so this journey is still MATCHED and
        // the next tick will try it again. The loop continues to the next
        // journey rather than abandoning the sweep.
        console.error(
          `[JOURNEY-EXPIRY] Error expiring matched journey ${journey.id} — rolled back, still MATCHED, will retry next tick:`,
          error,
        );
      }
    }

    if (staleMatchedJourneys.length > 0) {
      console.log(`[JOURNEY-EXPIRY] Expired ${staleMatchedJourneys.length} stale MATCHED journeys`);
    }

    // IN_PROGRESS journeys with no GPS heartbeat past the distance-aware
    // threshold -> auto-INTERRUPT (then reconciliation modal kicks in).
    const stale = await findStaleInProgressJourneys(new Date());
    let interrupted = 0;
    for (const j of stale) {
      try {
        await assertStaleAndInterrupt(j.id);
        interrupted += 1;
      } catch (error) {
        console.error(`[JOURNEY-EXPIRY] Error auto-interrupting stale IN_PROGRESS ${j.id}:`, error);
      }
    }
    if (interrupted > 0) {
      console.log(`[JOURNEY-EXPIRY] Auto-INTERRUPTed ${interrupted} stale IN_PROGRESS journeys`);
    }
  } catch (error) {
    console.error('[JOURNEY-EXPIRY] Error processing journey expiry:', error);
  }
}

export { processJourneyExpiry };

export function startJourneyExpiryJob() {
  console.log('[JOURNEY-EXPIRY] Starting journey expiry job (every 5min)');
  // withJobLock: only the advisory-lock leader runs the tick when
  // overlapping server processes race (deploy, scale-out).
  intervalId = setInterval(() => {
    withJobLock('journey-expiry.job', processJourneyExpiry).catch((err) => {
      console.error('[JOURNEY-EXPIRY] Top-level tick failed:', err);
    });
  }, 5 * 60 * 1000);
  // Run once immediately
  withJobLock('journey-expiry.job', processJourneyExpiry).catch((err) => {
    console.error('[JOURNEY-EXPIRY] Top-level tick failed:', err);
  });
}

export function stopJourneyExpiryJob() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
