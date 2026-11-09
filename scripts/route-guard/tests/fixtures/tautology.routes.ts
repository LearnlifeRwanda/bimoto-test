// FIXTURE — rule 3, both directions.
//
// The first handler is POST /scheduled-rides/:id/conflict-acknowledge as
// it stood at abb6a26, verbatim in shape: driverOnly, a journey fetched
// by the path param, and the JOURNEY'S OWN customerId handed to acceptBid
// as the actor. acceptBidCore then compared the row against itself.

import prisma from '../prisma';
import { authMiddleware, driverOnly, customerOnly } from '../middleware/auth';
import * as bidService from '../services/bid.service';
import { sessionUserId } from '../services/session-actor';

const router: any = {};

// REFUSED — the live defect.
router.post('/:id/conflict-acknowledge', authMiddleware, driverOnly, async (req: any, res: any) => {
  const journey = await prisma.journey.findUnique({ where: { id: req.params.id } });
  const result = await bidService.acceptBid(req.params.id, journey.customerId, req.body.bidId, {});
  res.json(result);
});

// REFUSED — the same thing with one more line. A local does not launder
// a record-sourced id.
router.post('/:id/launder', authMiddleware, driverOnly, async (req: any, res: any) => {
  const journey = await prisma.journey.findUnique({ where: { id: req.params.id } });
  const owner = journey.customerId;
  const result = await bidService.acceptBid(req.params.id, owner, req.body.bidId, {});
  res.json(result);
});

// ACCEPTED — the actor comes from the session.
router.post('/:id/accept-bid', authMiddleware, customerOnly, async (req: any, res: any) => {
  const result = await bidService.acceptBid(req.params.id, sessionUserId(req), req.body.bidId, {});
  res.json(result);
});

// ACCEPTED — a fetched row's own primary key handed to a Prisma lookup is
// how you fetch the next row, not an authorisation.
router.get('/:id/next', authMiddleware, async (req: any, res: any) => {
  const journey = await prisma.journey.findUnique({ where: { id: req.params.id } });
  const bids = await prisma.bid.findMany({ where: { journeyId: journey.id } });
  res.json(bids);
});

export default router;
