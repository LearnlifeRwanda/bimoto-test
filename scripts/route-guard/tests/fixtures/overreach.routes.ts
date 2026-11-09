// INCLUDE-REACH G6 fixture — the GET route the planted read hangs off.
//
// Deliberately a DELEGATED handler: the include is not here, it is a file
// away. That is the whole point of rule 2 running at the data-access layer
// rather than the route layer, and rule 1 cannot see past this line.

import { Router } from 'express';
import * as thingService from '../services/overreach.service';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.get('/:id', authMiddleware, async (req, res, next) => {
  try {
    res.json(await thingService.getThingById(req.params.id));
  } catch (err) {
    next(err);
  }
});

router.get('/:id/scoped', authMiddleware, async (req, res, next) => {
  try {
    res.json(await thingService.getScopedThingById(req.params.id, req.user!.userId));
  } catch (err) {
    next(err);
  }
});

export default router;
