import prisma from '../prisma';
import {
  JourneyStatus,
  JourneyAction,
  transitionJourney,
  SOCKET_EVENTS,
} from '@bimoto/shared';
import {
  findScheduledJourneysReadyForAutoFallback,
  executeAutoFallback,
} from '../services/scheduled-rides';
import { emitToJourney } from '../socket';
import { sendSms } from '../services/sms.service';
import { decryptedPhoneOrNull } from '../services/user-phone';
import { withJobLock } from '../services/job-lock';

let intervalId: NodeJS.Timeout | null = null;

export async function processAutoFallbackPick(now: Date = new Date()): Promise<{ matched: number; expired: number }> {
  let matched = 0;
  let expired = 0;
  try {
    const journeys = await findScheduledJourneysReadyForAutoFallback(now);
    for (const journey of journeys) {
      try {
        const result = await executeAutoFallback({
          id: journey.id,
          scheduledFor: journey.scheduledFor,
        });
        if (result.matched && result.matchedBid) {
          matched += 1;
          emitToJourney(journey.id, SOCKET_EVENTS.SCHEDULED_RIDE_MATCHED, {
            journeyId: journey.id,
            bidId: result.matchedBid.id,
            driverId: result.matchedBid.driverId,
            agreedPrice: result.matchedBid.price,
            autoFallback: true,
          });
        } else {
          const nextStatus = transitionJourney(
            journey.status as JourneyStatus,
            JourneyAction.EXPIRE,
          );
          await prisma.journey.update({
            where: { id: journey.id },
            data: { status: nextStatus },
          });
          expired += 1;
          emitToJourney(journey.id, SOCKET_EVENTS.SCHEDULED_RIDE_EXPIRED, { journeyId: journey.id });
          const customer = await prisma.user.findUnique({ where: { id: journey.customerId } });
          const customerPhone = decryptedPhoneOrNull(customer);
          if (customerPhone) {
            await sendSms(
              customerPhone,
              `Bimoto: no driver bid on your scheduled ride at ${journey.scheduledFor?.toISOString() ?? ''}. Please re-book.`,
            ).catch((e) => console.error('[AUTO-FALLBACK] SMS error:', e));
          }
        }
      } catch (err) {
        console.error(`[AUTO-FALLBACK] Error processing ${journey.id}:`, err);
      }
    }
    if (matched + expired > 0) {
      console.log(`[AUTO-FALLBACK] matched=${matched} expired=${expired}`);
    }
  } catch (err) {
    console.error('[AUTO-FALLBACK] Error processing auto-fallback pick:', err);
  }
  return { matched, expired };
}

export function startAutoFallbackPickJob() {
  console.log('[AUTO-FALLBACK] Starting auto-fallback-pick job (every 60s)');
  // withJobLock: only the advisory-lock leader runs the tick when
  // overlapping server processes race (deploy, scale-out).
  intervalId = setInterval(() => {
    withJobLock('auto-fallback-pick.job', () => processAutoFallbackPick()).catch((err) => {
      console.error('[AUTO-FALLBACK] Top-level tick failed:', err);
    });
  }, 60 * 1000);
  withJobLock('auto-fallback-pick.job', () => processAutoFallbackPick()).catch((err) => {
    console.error('[AUTO-FALLBACK] Top-level tick failed:', err);
  });
}

export function stopAutoFallbackPickJob() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
