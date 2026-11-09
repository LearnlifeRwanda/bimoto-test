// FIXTURE — rule S5, both directions.
//
// Parsed as text by the self-test; never imported, never built.
//
// The service fixture beside this one exports both gated and ungated
// functions, so the DERIVED set is exercised here rather than asserted
// against a hand-written list.

import { Router } from 'express';
import {
  gatedInSpread,
  gatedAtTheVariable,
  newCustomerSurface,
} from './version-gate.service';
import { isCurrentApp } from './app-version';

const router = Router();

// REFUSED — calls a gated function and says nothing. Absent means
// LEGACY, so this withholds from a current client rather than crashing an
// old one: the benign direction, and the one nobody notices.
router.get('/:id/forgot', async (req, res) => {
  const journey = await gatedInSpread();
  res.json(journey);
});

// ACCEPTED — declares the generation it is answering.
router.get('/:id/declared', async (req, res) => {
  const journey = await gatedInSpread({ customerSavingsPreview: isCurrentApp(req) });
  res.json(journey);
});

// ACCEPTED — declares it among other options, which is the real shape:
// `{ acknowledgeConflict, customerSavingsPreview: isCurrentApp(req) }`.
router.post('/:id/declared-with-siblings', async (req, res) => {
  const rows = await gatedAtTheVariable({
    customerSavingsPreview: isCurrentApp(req),
  });
  res.json(rows);
});

// NOT A FINDING — `newCustomerSurface` takes no options, so it is not in
// the derived set and S5 has nothing to ask of this route. S4 is what
// condemns that function, from the other side.
router.get('/:id/ungated-callee', async (_req, res) => {
  res.json(await newCustomerSurface());
});

export default router;
