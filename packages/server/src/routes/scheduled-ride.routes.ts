import { Router } from 'express';
import { authMiddleware, driverOnly, customerOnly } from '../middleware/auth';
import prisma from '../prisma';
import * as bidService from '../services/bid.service';
import { BidStatus, JourneyStatus, SOCKET_EVENTS } from '@bimoto/shared';
import { emitToJourney } from '../socket';
// CUTGUARD v2 G4 — the actor comes from the session, never from a record.
import { customerActor, sessionUserId } from '../services/session-actor';
import { isCurrentApp } from '../middleware/app-version';

const router = Router();

/**
 * @openapi
 * /api/scheduled-rides:
 *   get:
 *     summary: List the authenticated driver's future SCHEDULED rides — those assigned to them and those they have a live offer on.
 *     description: |
 *       A ride is listed when the driver is assigned to it (`commitment:
 *       ASSIGNED`) or holds a PENDING/ACCEPTED bid on it
 *       (`commitment: BID_PENDING`). `myBid` carries that bid when there
 *       is one. Filtering on assignment alone left the list permanently
 *       empty, because a SCHEDULED journey has no driver until a bid is
 *       accepted inside a window that opens 60 minutes before pickup.
 *     tags: [Scheduled Rides]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Future scheduled rides ordered by `scheduledFor` ascending.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   commitment: { type: string, enum: [ASSIGNED, BID_PENDING] }
 *                   myBid:      { type: object, nullable: true }
 */
// GET /api/scheduled-rides - driver's committed scheduled rides
//
// FIELD-FIT G2 — the motari reported this page as "can not get the data
// of scheduled rides", and the reproduction (docs/field-fit-reproduction.md,
// row 1b) showed why: the old filter was `driverId: me` alone, and a
// SCHEDULED journey carries no driverId until the customer accepts a
// bid. Since bidding on a scheduled ride only opens 60 minutes before
// pickup, the list could never hold anything except a ride starting
// within the hour — and a driver who had already offered a price and an
// ETA on a future ride saw nothing at all.
//
// The fix is a read: a ride belongs on this page when the driver is
// committed to it (assigned) OR has a live offer on it (a PENDING or
// ACCEPTED bid). Nothing about who may bid, or when, changes here —
// `myBid` is attached so the page can say which of the two it is.
const LIVE_BID_STATUSES = [BidStatus.PENDING, BidStatus.ACCEPTED];

router.get('/', authMiddleware, driverOnly, async (req, res, next) => {
  try {
    const now = new Date();
    const driverId = req.user!.userId;
    const rides = await prisma.journey.findMany({
      where: {
        bookingMode: 'SCHEDULED',
        status: { in: [JourneyStatus.SCHEDULED, JourneyStatus.REQUESTED, JourneyStatus.MATCHED] },
        scheduledFor: { gt: now },
        OR: [
          { driverId },
          { bids: { some: { driverId, status: { in: LIVE_BID_STATUSES } } } },
        ],
      },
      include: {
        bids: {
          where: { driverId, status: { in: LIVE_BID_STATUSES } },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { scheduledFor: 'asc' },
    });

    // `commitment` is what the row means to this driver, decided
    // server-side so the two clients cannot disagree about it.
    res.json(
      rides.map(({ bids, ...ride }: any) => ({
        ...ride,
        myBid: bids[0] ?? null,
        commitment: ride.driverId === driverId ? 'ASSIGNED' : 'BID_PENDING',
      })),
    );
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/scheduled-rides/customer:
 *   get:
 *     summary: List the authenticated customer's future SCHEDULED rides (with bids).
 *     tags: [Scheduled Rides]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Future scheduled rides with bid array, ordered by `scheduledFor`.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { type: object }
 */
// GET /api/scheduled-rides/customer - customer's scheduled rides
router.get('/customer', authMiddleware, customerOnly, async (req, res, next) => {
  try {
    const now = new Date();
    // CUTGUARD v2 G1 — surfaced by scripts/serialization-guard, not by a
    // human reading this file. It was `include: { bids: true }` on a raw
    // `findMany`, and it handed the passenger two things she must not
    // have:
    //
    //   1. `agreedPrice` AND `commissionAmount` on the same row. Those
    //      two subtract to the motari's net — the exact number #202/#207
    //      removed from `commissionBreakdown` and MONEY-VIEW v2 removed
    //      from the escrow row, arriving intact by a third door.
    //   2. every rival's bid, raw. #206 stopped bidding motaris reading
    //      each other's prices; this endpoint was still printing the
    //      whole board to the customer, and `bids` is not even rendered.
    //
    // The `select` is the fix AND the discipline: the home sheet
    // (components/journey/UpcomingRidesSection.tsx) renders exactly `id`,
    // `scheduledFor`, `pickupName` and `destinationName` — those four and
    // `status`, which the sheet's caller uses to route. A column added to
    // Journey tomorrow does not join this payload.
    const rides = await prisma.journey.findMany({
      where: {
        customerId: req.user!.userId,
        bookingMode: 'SCHEDULED',
        status: { in: [JourneyStatus.SCHEDULED, JourneyStatus.REQUESTED, JourneyStatus.MATCHED] },
        scheduledFor: { gt: now },
      },
      select: {
        id: true,
        status: true,
        scheduledFor: true,
        pickupName: true,
        destinationName: true,
      },
      orderBy: { scheduledFor: 'asc' },
    });
    res.json(rides);
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/scheduled-rides/{id}/conflict-acknowledge:
 *   post:
 *     summary: Driver explicitly accepts a soft-block conflict and re-attempts bid acceptance.
 *     description: |
 *       Used as the `retryUrl` returned by `POST /api/journeys/{id}/accept-bid`
 *       when scheduling-conflict detection produced a `matched: false` warning.
 *       Re-runs `acceptBid` with `acknowledgeConflict: true`.
 *     tags: [Scheduled Rides]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [bidId]
 *             properties:
 *               bidId: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Bid accepted; journey transitions to MATCHED.
 *         content:
 *           application/json:
 *             schema: { type: object }
 *       400:
 *         description: bidId missing.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       404:
 *         description: Journey not found.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       409:
 *         description: Stale conflict — another booking has filled the slot since the warning.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
// POST /api/scheduled-rides/:id/conflict-acknowledge — the PASSENGER
// acknowledges the double-booking warning and accepts anyway.
//
// CUTGUARD v2 G4 (U-1) — THIS WAS LIVE ON THE PILOT, and it was the worst
// kind of hole: an authorization check that looked present and could not
// fire.
//
//   router.post(..., authMiddleware, driverOnly, ...)
//     const journey = await prisma.journey.findUnique(...)
//     await bidService.acceptBid(req.params.id, journey.customerId, bidId, ...)
//
// `acceptBidCore` then compared `journey.customerId !== customerId` — the
// row against itself. Any motari with an ordinary session could accept
// any bid on any journey: a stranger matched a passenger he had no
// relationship with, at a price she never accepted, and her money was
// HELD against him.
//
// TWO THINGS WERE WRONG AND BOTH ARE FIXED HERE.
//
//   1. The actor was sourced from a fetched RECORD instead of the
//      session. That is now impossible: `acceptBid` takes a
//      `BidAcceptActor` and the only way to build a customer one is
//      `customerActor(sessionUserId(req))`. Passing `journey.customerId`
//      does not compile.
//
//   2. `driverOnly` was the wrong gate. The soft-block warns the
//      PASSENGER that the motari she is about to match has a conflicting
//      commitment (bid.service's assertNoBlockingConflict; the same
//      reason respondToCounter passes acknowledgeConflict when the
//      DRIVER is deciding about his own calendar). So the acknowledgment
//      is hers to give. The route is `customerOnly` now, and the
//      `retryUrl` that accept-bid has always advertised to her client is
//      finally callable by the client it is advertised to —
//      BidListPage's own comment recorded that it was not, and used
//      accept-bid's `acknowledgeConflict` flag instead. That flag still
//      works and still runs the identical path; this route is no longer
//      a door with a broken lock standing beside it.
router.post('/:id/conflict-acknowledge', authMiddleware, customerOnly, async (req, res, next) => {
  try {
    const { bidId } = req.body as { bidId?: string };
    if (!bidId) {
      res.status(400).json({ error: { code: 'BID_ID_REQUIRED', message: 'errors.bidIdRequired' } });
      return;
    }
    const result = await bidService.acceptBid(
      req.params.id,
      customerActor(sessionUserId(req)),
      bidId,
      {
        acknowledgeConflict: true,
        // CUTGUARD v2 amendment 2 — the same exit as POST /accept-bid and
        // the same answer, because it IS that accept: the passenger
        // re-accepting the offer she was warned about. Found by the
        // route-side rule (S5) rather than by reading, and it was the
        // benign direction of the bug — a v14 passenger who came through
        // the conflict dialog silently lost her savings line while the
        // same passenger on the direct path kept it.
        customerSavingsPreview: isCurrentApp(req),
      },
    );
    emitToJourney(req.params.id, SOCKET_EVENTS.BID_ACCEPTED, result);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
