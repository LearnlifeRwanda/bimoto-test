/**
 * Standalone runnable script — executable via:
 *   pnpm --filter @bimoto/server tsx scripts/backfill-settlement-credit.ts          (dry run)
 *   pnpm --filter @bimoto/server tsx scripts/backfill-settlement-credit.ts --apply  (repair)
 *
 * Credits drivers shortchanged by the pre-ESCROW-CREDIT auto-confirm job
 * (escrow released without the driver balance credit / completedShifts
 * increment). Dry run is the default and prints what WOULD be repaired;
 * --apply performs the repair. Idempotent — safe to re-run; see
 * src/services/settlement-credit-backfill.ts for the evidence rules.
 *
 * Logic lives in src/services/settlement-credit-backfill.ts so the test
 * suite can import it without leaving rootDir.
 */
import { runSettlementCreditBackfill } from '../src/services/settlement-credit-backfill';

const apply = process.argv.includes('--apply');

runSettlementCreditBackfill({ apply })
  .then((r) => {
    const mode = r.applied ? 'APPLIED' : 'DRY RUN';
    console.log(`[SETTLEMENT-BACKFILL] mode=${mode}`);
    for (const f of r.findings) {
      console.log(
        `[SETTLEMENT-BACKFILL] driver=${f.driverId} journey=${f.journeyId} ` +
          `escrow=${f.escrowId} amount=${f.driverPayout} RWF ` +
          `releasedAt=${f.releasedAt ? f.releasedAt.toISOString() : 'unknown'}`,
      );
    }
    for (const a of r.ambiguous) {
      console.warn(`[SETTLEMENT-BACKFILL] REFUSED escrow=${a.escrowId}: ${a.reason}`);
    }
    console.log(
      `[SETTLEMENT-BACKFILL] ${JSON.stringify({
        scanned: r.scanned,
        alreadySettled: r.alreadySettled,
        alreadyRepaired: r.alreadyRepaired,
        ambiguous: r.ambiguous.length,
        findings: r.findings.length,
        totalAmount: r.totalAmount,
        applied: r.applied,
      })}`,
    );
    if (!r.applied && r.findings.length > 0) {
      console.log('[SETTLEMENT-BACKFILL] dry run only — re-run with --apply to repair');
    }
    process.exit(0);
  })
  .catch((err) => {
    console.error('[SETTLEMENT-BACKFILL] failed:', err);
    process.exit(1);
  });
