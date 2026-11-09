/**
 * Standalone runnable script — executable via:
 *   pnpm --filter @bimoto/server tsx scripts/backfill-audit.ts
 *
 * Logic lives in src/services/audit-backfill.ts so the test suite can
 * import it without leaving rootDir.
 */
import { runBackfill } from '../src/services/audit-backfill';

runBackfill()
  .then((r) => {
    console.log(`[BACKFILL] ${JSON.stringify(r)}`);
    process.exit(0);
  })
  .catch((err) => {
    console.error('[BACKFILL] failed:', err);
    process.exit(1);
  });
