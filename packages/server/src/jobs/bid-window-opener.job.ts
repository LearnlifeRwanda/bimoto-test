import prisma from '../prisma';
import {
  JourneyStatus,
  JourneyAction,
  transitionJourney,
  SOCKET_EVENTS,
} from '@bimoto/shared';
import { findScheduledJourneysReadyForBidWindow } from '../services/scheduled-rides';
import { emitToJourney } from '../socket';
import { withJobLock } from '../services/job-lock';

let intervalId: NodeJS.Timeout | null = null;

export async function processBidWindowOpener(now: Date = new Date()): Promise<number> {
  try {
    const journeys = await findScheduledJourneysReadyForBidWindow(now);
    let opened = 0;
    for (const journey of journeys) {
      if (journey.status !== JourneyStatus.SCHEDULED) continue;
      try {
        const nextStatus = transitionJourney(
          journey.status as JourneyStatus,
          JourneyAction.OPEN_BID_WINDOW,
        );
        const result = await prisma.journey.updateMany({
          where: { id: journey.id, status: JourneyStatus.SCHEDULED },
          data: { status: nextStatus },
        });
        if (result.count > 0) {
          opened += 1;
          emitToJourney(journey.id, SOCKET_EVENTS.SCHEDULED_RIDE_BID_WINDOW_OPENED, {
            journeyId: journey.id,
            scheduledFor: journey.scheduledFor,
            autoFallbackAt: journey.autoFallbackAt,
          });
        }
      } catch (err) {
        console.error(`[BID-WINDOW] Failed to open window for ${journey.id}:`, err);
      }
    }
    if (opened > 0) {
      console.log(`[BID-WINDOW] Opened ${opened} scheduled-ride bid window(s)`);
    }
    return opened;
  } catch (err) {
    console.error('[BID-WINDOW] Error processing bid-window opener:', err);
    return 0;
  }
}

export function startBidWindowOpenerJob() {
  console.log('[BID-WINDOW] Starting bid-window-opener job (every 60s)');
  // withJobLock: only the advisory-lock leader runs the tick when
  // overlapping server processes race (deploy, scale-out).
  intervalId = setInterval(() => {
    withJobLock('bid-window-opener.job', () => processBidWindowOpener()).catch((err) => {
      console.error('[BID-WINDOW] Top-level tick failed:', err);
    });
  }, 60 * 1000);
  withJobLock('bid-window-opener.job', () => processBidWindowOpener()).catch((err) => {
    console.error('[BID-WINDOW] Top-level tick failed:', err);
  });
}

export function stopBidWindowOpenerJob() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
