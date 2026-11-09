/**
 * PAYOUT-IDEMPOTENCY — standing CI rehearsal of the Kigali case.
 *
 * The migration 20260729000000_payout_idempotency_one_inflight_batch must
 * work on a database that ALREADY violates the invariant it introduces
 * (duplicate un-settled PENDING DriverPayoutBatch rows for one driver) —
 * the pilot database is live and the race this migration closes may have
 * already fired there. A migration that only works on a clean database is
 * not finished.
 *
 * Runs in the e2e workflow after the fresh `migrate deploy` + schema
 * faithfulness gate, against the same Postgres service:
 *
 *   1. asserts the partial unique index exists after a fresh deploy
 *      (the CI proof the index is really created);
 *   2. drops the index and seeds the violating fixture (a driver with
 *      three PENDING batches plus settled history, and a compliant
 *      driver with exactly one PENDING batch);
 *   3. re-executes the REAL migration file (prisma db execute --file —
 *      not a reimplementation of its SQL);
 *   4. asserts the deterministic resolution: oldest PENDING kept, later
 *      duplicates demoted to FAILED with failureReason naming the kept
 *      batch, settled history and the compliant driver untouched, no row
 *      deleted;
 *   5. asserts the re-created index rejects a fresh duplicate insert;
 *   6. removes the fixture rows so the later seed step starts clean.
 *
 * Standalone runnable:
 *   DATABASE_URL=... pnpm --filter @bimoto/server exec tsx scripts/rehearse-payout-idempotency-migration.ts
 */
import { execFileSync } from 'child_process';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const INDEX_NAME = 'DriverPayoutBatch_driverId_pending_key';
const MIGRATION_FILE = path.join(
  __dirname,
  '..',
  'prisma',
  'migrations',
  '20260729000000_payout_idempotency_one_inflight_batch',
  'migration.sql',
);

// Fixture ids — synthetic UUIDs, removed again in cleanup().
const DRIVER_A = 'feed0000-0000-4000-8000-00000000000a';
const DRIVER_B = 'feed0000-0000-4000-8000-00000000000b';
const A_OLDEST = 'feed0001-0000-4000-8000-000000000001';
const A_DUP_SAME_INSTANT = 'feed0001-0000-4000-8000-000000000002';
const A_DUP_NEXT_DAY = 'feed0001-0000-4000-8000-000000000003';
const A_SETTLED = 'feed0001-0000-4000-8000-000000000004';
const B_ONLY = 'feed0001-0000-4000-8000-000000000005';
const PROBE = 'feed0001-0000-4000-8000-000000000006';

function fail(msg: string): never {
  console.error(`[REHEARSAL] FAIL: ${msg}`);
  process.exit(1);
}

async function indexExists(): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ indexname: string }[]>`
    SELECT indexname FROM pg_indexes
    WHERE tablename = 'DriverPayoutBatch' AND indexname = ${INDEX_NAME}
  `;
  return rows.length === 1;
}

async function cleanup(): Promise<void> {
  await prisma.driverPayoutBatch.deleteMany({
    where: { driverId: { in: [DRIVER_A, DRIVER_B] } },
  });
}

async function main(): Promise<void> {
  // 1. Fresh migrate deploy must have created the index.
  if (!(await indexExists())) {
    fail(`fresh migrate deploy did not create ${INDEX_NAME}`);
  }
  console.log('[REHEARSAL] index present after fresh migrate deploy');

  // 2. Recreate the pre-migration world: no index, violating rows.
  await prisma.$executeRawUnsafe(`DROP INDEX "${INDEX_NAME}"`);
  await cleanup(); // defensive: stale fixture from an aborted run
  await prisma.driverPayoutBatch.createMany({
    data: [
      // Driver A: three un-settled PENDING batches — the violation. Two
      // share a createdAt instant (the double-tap shape), so the (id)
      // tie-break is exercised too.
      { id: A_OLDEST, driverId: DRIVER_A, amount: 5000, txRef: 'rehearsal-a-1', status: 'PENDING', trigger: 'SHIFT_END', createdAt: new Date('2026-07-28T10:00:00Z') },
      { id: A_DUP_SAME_INSTANT, driverId: DRIVER_A, amount: 5000, txRef: 'rehearsal-a-2', status: 'PENDING', trigger: 'SHIFT_END', createdAt: new Date('2026-07-28T10:00:00Z') },
      { id: A_DUP_NEXT_DAY, driverId: DRIVER_A, amount: 7000, txRef: 'rehearsal-a-3', status: 'PENDING', trigger: 'SHIFT_END', createdAt: new Date('2026-07-29T09:00:00Z') },
      // Driver A settled history — must survive untouched.
      { id: A_SETTLED, driverId: DRIVER_A, amount: 3000, txRef: 'rehearsal-a-settled', status: 'SUCCESS', trigger: 'SCHEDULED_22H', createdAt: new Date('2026-07-27T22:00:00Z'), paidOutAt: new Date('2026-07-27T22:01:00Z') },
      // Driver B: exactly one PENDING batch — compliant, must be untouched.
      { id: B_ONLY, driverId: DRIVER_B, amount: 4000, txRef: 'rehearsal-b-1', status: 'PENDING', trigger: 'SHIFT_END', createdAt: new Date('2026-07-29T09:30:00Z') },
    ],
  });

  // 3. Re-run the actual migration file against the violating database.
  execFileSync(
    'pnpm',
    ['exec', 'prisma', 'db', 'execute', '--file', MIGRATION_FILE, '--schema', path.join(__dirname, '..', 'prisma', 'schema.prisma')],
    { stdio: 'inherit', cwd: path.join(__dirname, '..') },
  );
  console.log('[REHEARSAL] migration re-executed against violating fixture');

  // 4. Deterministic resolution.
  const rows = await prisma.driverPayoutBatch.findMany({
    where: { driverId: { in: [DRIVER_A, DRIVER_B] } },
  });
  if (rows.length !== 5) {
    fail(`expected all 5 fixture rows to survive (none deleted), found ${rows.length}`);
  }
  const byId = new Map(rows.map((r) => [r.id, r]));
  const expectStatus = (id: string, status: string, label: string) => {
    const row = byId.get(id);
    if (!row) fail(`${label}: row ${id} missing`);
    if (row!.status !== status) {
      fail(`${label}: expected ${status}, got ${row!.status}`);
    }
  };
  expectStatus(A_OLDEST, 'PENDING', 'oldest PENDING kept');
  expectStatus(A_DUP_SAME_INSTANT, 'FAILED', 'same-instant duplicate demoted');
  expectStatus(A_DUP_NEXT_DAY, 'FAILED', 'next-day duplicate demoted');
  expectStatus(A_SETTLED, 'SUCCESS', 'settled history untouched');
  expectStatus(B_ONLY, 'PENDING', 'compliant driver untouched');

  const expectedReason = `duplicate_in_flight_superseded_by_${A_OLDEST}`;
  for (const id of [A_DUP_SAME_INSTANT, A_DUP_NEXT_DAY]) {
    const reason = byId.get(id)!.failureReason;
    if (reason !== expectedReason) {
      fail(`demoted row ${id}: failureReason "${reason}" != "${expectedReason}"`);
    }
  }
  if (byId.get(B_ONLY)!.failureReason !== null) {
    fail('compliant driver row gained a failureReason');
  }
  console.log('[REHEARSAL] violations resolved: oldest kept, duplicates demoted with audit trail');

  // 5. The invariant now holds mechanically.
  if (!(await indexExists())) {
    fail('migration did not re-create the partial unique index');
  }
  let rejected = false;
  try {
    await prisma.driverPayoutBatch.create({
      data: { id: PROBE, driverId: DRIVER_B, amount: 100, txRef: 'rehearsal-probe', status: 'PENDING', trigger: 'SHIFT_END' },
    });
  } catch (err: any) {
    rejected = err?.code === 'P2002';
  }
  if (!rejected) {
    fail('index failed to reject a second PENDING batch for one driver');
  }
  console.log('[REHEARSAL] index rejects a fresh duplicate (P2002)');

  // 6. Leave the database as the later seed step expects it.
  await cleanup();
  console.log('[REHEARSAL] PASS — fixture removed, database clean');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error('[REHEARSAL] error:', err);
    await prisma.$disconnect();
    process.exit(1);
  });
