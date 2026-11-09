# Pilot triggers — evidence-gated backlog items

Two backlog items are deliberately **not built yet**. Each was deferred
by the panel to a measured trigger rather than a hunch: we build them
only if the pilot produces a number that says the cheaper existing
stack is insufficient. This page defines those numbers, where to read
them, and the review cadence.

The instrumentation behind trigger 1 is evidence, not enforcement: a
reported mismatch never freezes, flags, cancels, or notifies anyone.
It is a row a human reads. Keep it that way.

## 1. Per-ride dynamic QR/PIN (V-4) — pickup-mismatch rate

**The question.** Is the GPS-dot + jacket-number stack enough for a
customer to reliably confirm their driver at pickup, or do we need a
per-ride second factor (dynamic QR/PIN)?

**The signal.** When a matched driver's server-derived
`approachStatus` hits `'arrived'`, the customer's matched screen shows
an optional, dismissible prompt: *"Is this your driver?
(jacket #NNNN)"*. The answer is stored as one `PickupVerification` row
per journey (`POST /api/journeys/:id/pickup-verification`, last answer
wins):

- `MATCHED` — the customer confirmed the driver;
- `MISMATCH` — the customer said no, with an optional one-tap reason
  (`WRONG_NUMBER` / `NO_VEST` / `DIFFERENT_PERSON`);
- `UNSURE` — the customer couldn't tell.

**The metric.** The **pickup-mismatch rate** is

```
(MISMATCH + UNSURE) / all answered prompts
```

over the review window. Every answer that is not a clean "yes" counts:
an unsure customer is exactly the failure mode a second factor would
fix, so it belongs in the numerator.

**Where to read it.** `GET /api/admin/pickup-verifications/summary`
(adminOnly; `?since=<ISO date>`, default window the last 42 days)
returns the counts, the rate, and the most recent `MISMATCH`/`UNSURE`
answers (journey, jacket number, reason, time) for case-by-case
reading.

**Cadence and decision.** Review at pilot **week 6**, alongside the
rider/driver interviews (the same rhythm as the AML precision review
below). Read the rate together with the recent list — reasons matter:
a run of `WRONG_NUMBER` reads very differently from a run of
`NO_VEST`.

- **Mismatch rate non-trivial** (as a working line: above the low
  single digits percent on a meaningful number of answers, or any
  confirmed different-person case) → draft V-4 (per-ride dynamic
  QR/PIN) for panel review.
- **Rate trivial / noise** → V-4 stays unbuilt; keep the counter
  running and re-read at the next cadence.

Beware the denominator: answer volume is opt-in, so a low prompt
answer rate caps how much the percentage can be trusted. If almost
nobody answers, that is a prompt-UX finding, not evidence that pickup
works.

## 2. AML corroboration scoring — precision-ledger overturn rate

**Already measurable — no new code.** Build corroboration scoring only
if the week-6 precision-ledger overturn rate for a pattern exceeds
**one-third**. The number comes from
`GET /api/admin/aml-flags/precision` (the per-pattern `PrecisionBucket`
counts), and the reading procedure, caveats, and the week-6 decision
rule are documented in
[`aml-review-runbook.md` §6 — "Reading `/precision`, and the week-6
trigger"](./aml-review-runbook.md). Follow that section; this page only
points at it.
