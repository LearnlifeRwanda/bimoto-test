import prisma from '../prisma';
import { BID_EXPIRY_MINUTES, BidStatus, SOCKET_EVENTS } from '@bimoto/shared';
import { emitToJourney } from '../socket';
import { withJobLock } from '../services/job-lock';

let intervalId: NodeJS.Timeout | null = null;

async function processBidExpiry() {
  try {
    const expiryThreshold = new Date(Date.now() - BID_EXPIRY_MINUTES * 60 * 1000);

    const expiredBids = await prisma.bid.findMany({
      where: {
        status: BidStatus.PENDING,
        createdAt: { lt: expiryThreshold },
      },
    });

    for (const bid of expiredBids) {
      await prisma.bid.update({
        where: { id: bid.id },
        data: {
          status: BidStatus.EXPIRED,
          // COUNTER-READY G2 — an unanswered counter lapses with the bid
          // it was made on.
          //
          // `counterAmountRwf != null && counterOutcome == null` is
          // exactly "she countered and he never answered" (the
          // withdrawnSource convention: null means the event never
          // happened to this row). LAPSED closes it honestly rather than
          // leaving an open question on an expired offer forever, and it
          // is deliberately not DECLINED — nobody declined anything; the
          // clock ran out on both of them.
          //
          // Spread, not a second update: a bid with no counter, or with
          // one already answered, keeps exactly the write it had before
          // this dispatch. Nothing here depends on COUNTER_BID_ENABLED,
          // because a row that carries a counter carries it whether or
          // not the switch is still on — a flag turned back off must not
          // strand open counters.
          ...(bid.counterAmountRwf !== null && bid.counterOutcome === null
            ? { counterOutcome: 'LAPSED' as const }
            : {}),
        },
      });

      emitToJourney(bid.journeyId, SOCKET_EVENTS.BID_EXPIRED, {
        bidId: bid.id,
        journeyId: bid.journeyId,
        driverId: bid.driverId,
      });
    }

    if (expiredBids.length > 0) {
      console.log(`[BID-EXPIRY] Expired ${expiredBids.length} bids`);
    }
  } catch (error) {
    console.error('[BID-EXPIRY] Error processing bid expiry:', error);
  }
}

export function startBidExpiryJob() {
  console.log('[BID-EXPIRY] Starting bid expiry job (every 60s)');
  // withJobLock: only the advisory-lock leader runs the tick when
  // overlapping server processes race (deploy, scale-out).
  intervalId = setInterval(() => {
    withJobLock('bid-expiry.job', processBidExpiry).catch((err) => {
      console.error('[BID-EXPIRY] Top-level tick failed:', err);
    });
  }, 60 * 1000);
  // Run once immediately
  withJobLock('bid-expiry.job', processBidExpiry).catch((err) => {
    console.error('[BID-EXPIRY] Top-level tick failed:', err);
  });
}

export function stopBidExpiryJob() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
