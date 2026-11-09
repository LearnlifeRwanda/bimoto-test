import { Router } from 'express';
import { validate } from '../middleware/validate';
import { authMiddleware, driverOnly, customerOnly } from '../middleware/auth';
import {
  createBidSchema,
  acceptBidSchema,
  acceptBidForCardSchema,
  counterBidSchema,
  counterRespondSchema,
  SOCKET_EVENTS,
} from '@bimoto/shared';
import * as bidService from '../services/bid.service';
import { emitToJourney } from '../socket';
// CUTGUARD v2 G4 — the actor comes from the SESSION, never from a record.
// `sessionUserId(req)` is the only constructor of the branded id these
// services now require.
import { customerActor, sessionUserId } from '../services/session-actor';
import { isCurrentApp } from '../middleware/app-version';
import { notifyBidReceived } from '../services/notification.service';
import { announceBidDeclined } from '../services/bid-outcome';

const router = Router();

/**
 * @openapi
 * /api/journeys/{id}/bids:
 *   get:
 *     summary: List bids on a journey (visible to journey participants).
 *     tags: [Bids]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Bid array.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { type: object }
 */
// GET /api/journeys/:id/bids - list bids for journey
router.get('/:id/bids', authMiddleware, async (req, res, next) => {
  try {
    // CUTGUARD v2 G6 (B-2) — the savings preview goes only to a client
    // that can draw it. `isCurrentApp` is false for an absent or
    // unparseable header, so the default answer is the v13-safe one.
    const bids = await bidService.getBidsForJourney(req.params.id, req.user!.userId, {
      customerSavingsPreview: isCurrentApp(req),
    });
    res.json(bids);
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /api/journeys/{id}/bids:
 *   post:
 *     summary: Driver places a fixed-price bid with ETA.
 *     tags: [Bids]
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
 *             required: [price, etaMinutes]
 *             properties:
 *               price:      { type: number, example: 1500 }
 *               etaMinutes: { type: integer, example: 7 }
 *     responses:
 *       201:
 *         description: Created bid.
 *         content:
 *           application/json:
 *             schema: { type: object }
 */
// POST /api/journeys/:id/bids - create bid (driver only)
router.post('/:id/bids', authMiddleware, driverOnly, async (req, res, next) => {
  try {
    const { price, etaMinutes } = req.body;
    const bid = await bidService.createBid(req.params.id, req.user!.userId, price, etaMinutes);

    // LIVE-WIRE G2 — emit the bid in the shape the passenger's list
    // RENDERS, not the raw Prisma row.
    //
    // This emit has always been fast (measured p50 15 ms, websocket and
    // forced-polling alike). What it carried was a bare Bid row with no
    // `driver {}`, so the passenger's screen gained a nameless,
    // ratingless placeholder in 15 ms and only got a real offer when the
    // poll replaced it up to ten seconds later. That gap — not the
    // transport — is the field's "bids are too slow to appear" on this
    // side (docs/live-wire-measurements.md §1).
    //
    // Serialized for the customer, which is also correct for the
    // envelope: only the customer can be in `journey:<id>` while a
    // journey is REQUESTED, so this payload carries no commission data
    // (G4). A serialization failure must not fail a bid that is already
    // written — fall back to the raw row, exactly the old behaviour.
    let payload: unknown = bid;
    try {
      payload = (await bidService.getBidViewForCustomer(req.params.id, bid.id)) ?? bid;
    } catch {
      // keep the raw row
    }
    emitToJourney(req.params.id, SOCKET_EVENTS.BID_PLACED, payload);

    // LIVE-WIRE G3 — and the passenger's phone says so even in a pocket.
    // #159's helper: push-first, recipient's own language,
    // fire-and-forget. Announced to the customer only — never to the
    // driver, whose own action this is.
    bidService
      .getJourneyCustomerId(req.params.id)
      .then((customerId) => {
        if (customerId) notifyBidReceived(customerId, req.params.id, bid.id);
      })
      .catch(() => undefined);

    res.status(201).json(bid);
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /api/journeys/{id}/accept-bid:
 *   post:
 *     summary: Customer accepts a bid. May return a soft-block conflict for SCHEDULED rides.
 *     tags: [Bids]
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
 *               bidId:               { type: string, format: uuid }
 *               acknowledgeConflict: { type: boolean, default: false }
 *     responses:
 *       200:
 *         description: |
 *           When matched, returns the updated journey/bid pair.
 *           When `matched: false`, returns the conflict warning + retryUrl
 *           pointing at `/api/scheduled-rides/{id}/conflict-acknowledge`.
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - type: object
 *                   properties:
 *                     journey: { type: object }
 *                     bid:     { type: object }
 *                 - type: object
 *                   properties:
 *                     matched:
 *                       type: boolean
 *                       example: false
 *                     conflictWarning:
 *                       type: object
 *                       properties:
 *                         conflictingRides:
 *                           type: array
 *                           items: { type: object }
 *                     retryUrl: { type: string }
 */
// POST /api/journeys/:id/accept-bid - accept a bid (customer only)
router.post('/:id/accept-bid', authMiddleware, customerOnly, validate(acceptBidSchema), async (req, res, next) => {
  try {
    const acknowledgeConflict = req.body?.acknowledgeConflict === true;
    const result: any = await bidService.acceptBid(
      req.params.id,
      customerActor(sessionUserId(req)),
      req.body.bidId,
      {
        acknowledgeConflict,
        // CUTGUARD v2 amendment 2 — B-2's fourth surface.
        //
        // Reading the ACCEPTING client's version is right for both exits
        // of this handler, including the socket one, and that is worth
        // saying because it is the opposite of the bid-placed rule. The
        // journey-room fan-out below re-broadcasts this same object, and
        // for a REQUESTED journey the room is HER — the winning motari's
        // join is refused until MATCHED, and he learns on his own user
        // room. So unlike a bid-placed push, where the DRIVER's version
        // says nothing about the passenger's phone, here the requester
        // and the recipient are the same phone.
        customerSavingsPreview: isCurrentApp(req),
      },
    );
    if (result?.matched === false && result?.conflictWarning) {
      res.json({
        ...result,
        retryUrl: `/api/scheduled-rides/${req.params.id}/conflict-acknowledge`,
      });
      return;
    }
    emitToJourney(req.params.id, SOCKET_EVENTS.BID_ACCEPTED, result);
    res.json(result);
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /api/journeys/{id}/accept-bid-card:
 *   post:
 *     summary: Accept a bid with intent to pay by card; creates escrow without charging.
 *     description: |
 *       Mirrors `POST /accept-bid` but skips the MoMo gateway call. Returns
 *       `cardCheckout: { escrowId, txRef, amount }` for the client to initialize
 *       the Flutterwave Inline widget. After widget success, client calls
 *       `POST /api/payments/initiate-card` to verify the charge and flip the
 *       escrow to HELD. May return a soft-block conflict for SCHEDULED rides
 *       (same shape as `/accept-bid`).
 *     tags: [Bids]
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
 *               bidId:               { type: string, format: uuid }
 *               acknowledgeConflict: { type: boolean, default: false }
 *     responses:
 *       200:
 *         description: |
 *           When matched, returns the updated journey/bid pair plus
 *           `cardCheckout: { escrowId, txRef, amount }`. The escrow is left
 *           in PENDING; the `bid-accepted` socket event is NOT emitted here —
 *           it fires from the webhook after card verification succeeds.
 *           When `matched: false`, returns the conflict warning + retryUrl.
 *         content:
 *           application/json:
 *             schema: { type: object }
 */
// POST /api/journeys/:id/accept-bid-card - accept a bid intending to pay by card (customer only)
router.post(
  '/:id/accept-bid-card',
  authMiddleware,
  customerOnly,
  validate(acceptBidForCardSchema),
  async (req, res, next) => {
    try {
      const acknowledgeConflict = req.body?.acknowledgeConflict === true;
      const result: any = await bidService.acceptBidForCard(
        req.params.id,
        customerActor(sessionUserId(req)),
        req.body.bidId,
        // Card sibling. This one has no socket exit at all (see below),
        // so it is simply the accepting client's own version.
        { acknowledgeConflict, customerSavingsPreview: isCurrentApp(req) },
      );
      if (result?.matched === false && result?.conflictWarning) {
        // Same conflict-warning path as /accept-bid.
        res.json({
          ...result,
          retryUrl: `/api/scheduled-rides/${req.params.id}/conflict-acknowledge`,
        });
        return;
      }
      // Deliberately do NOT emit 'bid-accepted' here — the escrow is still
      // PENDING. That event fires from the webhook handler once the card
      // charge is verified (POST /api/payments/initiate-card → HELD).
      res.json(result);
    } catch (err) { next(err); }
  },
);

/**
 * @openapi
 * /api/journeys/{id}/bids/{bidId}/decline:
 *   post:
 *     summary: >-
 *       Passenger declines one driver's offer. The request stays open and
 *       every other offer stays live.
 *     tags: [Bids]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: bidId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: The declined bid.
 *       403:
 *         description: Caller is not this journey's passenger.
 *       404:
 *         description: No such bid on this journey.
 *       409:
 *         description: Already declined.
 */
// POST /api/journeys/:id/bids/:bidId/decline (customer only)
//
// TEAM-ANSWERS G4 — item 16a. Until now the only thing that set a bid
// DECLINED was accepting a rival, which mass-declined the others; a
// passenger who did not want THIS offer could only ignore it.
//
// The motari is told through exactly the same two channels an accept's
// losers already used (bid-declined socket event + the #159
// notification), so a decline is indistinguishable from losing to a
// rival — which is right: either way the ride is not his.
router.post('/:id/bids/:bidId/decline', authMiddleware, customerOnly, async (req, res, next) => {
  try {
    const bid = await bidService.declineBid(
      req.params.id,
      sessionUserId(req),
      req.params.bidId,
    );
    // DEVIATION from the dispatch's "emits the existing bid-update
    // socket shape", and the reason: the journey room during REQUESTED
    // holds only the PASSENGER (a bidding motari's journey-room join is
    // refused until he is matched — useSocket.ts's own note on
    // BID_ACCEPTED). The client's BID_DECLINED handler answers with the
    // toast "your bid was declined". Emitting to the journey room would
    // therefore tell the passenger, in the driver's words, that her own
    // bid had been declined — and reach nobody else. So the decline is
    // announced only where somebody is listening: the one motari whose
    // offer it was, on his own per-user room, through the same helper an
    // accept's losers already use. The passenger's list updates from her
    // own action, as it does for every other thing she does.
    if (bid) announceBidDeclined(req.params.id, { id: bid.id, driverId: bid.driverId });
    res.json(bid);
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /api/journeys/{id}/bids/{bidId}:
 *   delete:
 *     summary: Driver withdraws their own bid before it is accepted.
 *     tags: [Bids]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: bidId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Withdrawn bid.
 *         content:
 *           application/json:
 *             schema: { type: object }
 */
// DELETE /api/journeys/:id/bids/:bidId - withdraw bid (driver only)
router.delete('/:id/bids/:bidId', authMiddleware, driverOnly, async (req, res, next) => {
  try {
    const bid = await bidService.withdrawBid(req.params.bidId, req.user!.userId, 'USER');
    emitToJourney(req.params.id, SOCKET_EVENTS.BID_WITHDRAWN, bid);
    res.json(bid);
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /api/journeys/{id}/bids/{bidId}/counter:
 *   post:
 *     summary: Passenger suggests a different price for one bid (one counter per bid, ever). Dormant behind COUNTER_BID_ENABLED.
 *     tags: [Bids]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: bidId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [counterAmountRwf]
 *             properties:
 *               counterAmountRwf: { type: integer, example: 1200 }
 *     responses:
 *       200:
 *         description: The bid, now carrying the counter.
 *       400:
 *         description: The bid is not PENDING.
 *       403:
 *         description: COUNTER_DISABLED (the experiment is not switched on), or the caller is not this journey's passenger.
 *       404:
 *         description: No such journey, or no such bid on this journey.
 *       409:
 *         description: This bid already carries a counter.
 *       422:
 *         description: Out of MIN/MAX price bounds, or equal to the bid price.
 */
// POST /api/journeys/:id/bids/:bidId/counter (customer only)
//
// COUNTER-READY G2 — ruling D4. The passenger may suggest a different
// number for exactly one motari's offer, exactly once.
//
// SHIPS ASLEEP. With COUNTER_BID_ENABLED unset this route exists and
// answers 403 COUNTER_DISABLED before touching a row, which is the whole
// dormant-shipping design: APK 14 carries the machinery, Update 7 is an
// env flip on the pilot Mac, and until then plain bidding generates its
// baseline undisturbed.
router.post(
  '/:id/bids/:bidId/counter',
  authMiddleware,
  customerOnly,
  validate(counterBidSchema),
  async (req, res, next) => {
    try {
      const bid = await bidService.counterBid(
        req.params.id,
        sessionUserId(req),
        req.params.bidId,
        req.body.counterAmountRwf,
      );
      res.json(bid);
    } catch (err) { next(err); }
  },
);

/**
 * @openapi
 * /api/journeys/{id}/bids/{bidId}/counter/respond:
 *   post:
 *     summary: The bid's driver accepts or declines the counter. Accepting matches the journey at the countered price through the ordinary accept path. Dormant behind COUNTER_BID_ENABLED.
 *     tags: [Bids]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: bidId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [action]
 *             properties:
 *               action: { type: string, enum: [accept, decline] }
 *     responses:
 *       200:
 *         description: The outcome. On accept, the journey is MATCHED at the countered price.
 *       400:
 *         description: The bid is not PENDING.
 *       403:
 *         description: COUNTER_DISABLED, or the caller is not this bid's driver.
 *       404:
 *         description: No such bid on this journey, or it carries no counter.
 *       409:
 *         description: The counter was already answered, or the bid was matched from under it.
 */
// POST /api/journeys/:id/bids/:bidId/counter/respond (driver only)
//
// COUNTER-READY G2 — the motari's answer.
//
// An ACCEPT does not get a money path of its own. The service flips the
// agreed number onto the bid row and then calls acceptBid — the same
// function the passenger's own tap calls and the same one auto-accept
// calls — so the escrow, the commission ladder and the charge are the
// ordinary ones, computed from the agreed price.
router.post(
  '/:id/bids/:bidId/counter/respond',
  authMiddleware,
  driverOnly,
  validate(counterRespondSchema),
  async (req, res, next) => {
    try {
      const result = await bidService.respondToCounter(
        req.params.id,
        sessionUserId(req),
        req.params.bidId,
        req.body.action,
      );
      // The same journey-room announcement the customer's own accept
      // makes (see POST /:id/accept-bid above), carrying the same
      // acceptBid result — so her screen folds in the matched journey by
      // the path it already uses, and does not have to learn a second
      // one. Her TOAST comes separately, on her own user room, from
      // notifyCounterAccepted: the journey-room event is deliberately
      // silent on the client (useSocket's note on BID_ACCEPTED).
      //
      // CUTGUARD v2 amendment 2 — and this route deliberately does NOT
      // pass `customerSavingsPreview`. The requester here is the DRIVER;
      // the recipient of both the emit and the customer's own next read
      // is the PASSENGER, whose generation this request says nothing
      // about. With no signal the answer is the legacy shape, which is
      // what `acceptBid`'s default gives — the same rule the bid-placed
      // push follows, arrived at from the same absence.
      if (result.matched) {
        emitToJourney(req.params.id, SOCKET_EVENTS.BID_ACCEPTED, result.accepted);
      }
      res.json(result);
    } catch (err) { next(err); }
  },
);

export default router;
