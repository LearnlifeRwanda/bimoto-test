/**
 * BID-ATOMICITY G3 — standing CI rehearsal of the Kigali case.
 *
 * The migration 20260731000000_bid_atomicity_audit_chain_unique must work
 * on a database that ALREADY violates the invariant it introduces
 * (duplicate (escrowId, sequenceNumber) EscrowAuditLog rows) — the pilot
 * database is live and the race this migration closes may have already
 * fired there. A migration that only works on a clean database is not
 * finished. And because this is the money audit trail, the rehearsal also
 * proves the STOP path: divergent-payload forks must ABORT the migration
 * untouched, never auto-resolve.
 *
 * Runs in the e2e workflow after the fresh `migrate deploy` + schema
 * faithfulness gate, against the same Postgres service:
 *
 *   1. asserts the unique index exists after a fresh deploy;
 *   2. drops the index and seeds the BENIGN violating fixture (an escrow
 *      whose CHARGE_CONFIRMED entry was double-appended by the race —
 *      same action/amount/previousHash, different timestamps/hashes —
 *      plus a compliant escrow);
 *   3. re-executes the REAL migration file (prisma db execute --file —
 *      not a reimplementation of its SQL);
 *   4. asserts the deterministic resolution: earliest duplicate keeps its
 *      sequence number, the later one moves past the chain tail with
 *      metadata.resequencedFrom/resequencedBy stamped, nothing deleted,
 *      no hash rewritten, the compliant escrow untouched;
 *   5. asserts the re-created index rejects a fresh duplicate insert;
 *   6. drops the index again and seeds a DIVERGENT fork (same chain
 *      position, different action) — re-executing the migration must
 *      FAIL, leave every row byte-identical, and create no index;
 *   7. removes the fixtures, re-runs the migration on the clean database
 *      to restore the index, and leaves the DB as the seed step expects.
 *
 * Standalone runnable:
 *   DATABASE_URL=... pnpm --filter @bimoto/server exec tsx scripts/rehearse-audit-chain-migration.ts
 */
import { execFileSync } from 'child_process';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const INDEX_NAME = 'EscrowAuditLog_escrowId_sequenceNumber_key';
const MIGRATION_NAME = '20260731000000_bid_atomicity_audit_chain_unique';
const MIGRATION_FILE = path.join(
  __dirname,
  '..',
  'prisma',
  'migrations',
  MIGRATION_NAME,
  'migration.sql',
);

// Fixture ids — synthetic UUIDs, removed again in cleanup().
const CUSTOMER = 'feed0002-0000-4000-8000-0000000000c1';
const DRIVER = 'feed0002-0000-4000-8000-0000000000d1';
const JOURNEY_A = 'feed0002-0000-4000-8000-00000000001a';
const JOURNEY_B = 'feed0002-0000-4000-8000-00000000001b';
const ESCROW_A = 'feed0002-0000-4000-8000-00000000002a';
const ESCROW_B = 'feed0002-0000-4000-8000-00000000002b';
const A_SEQ0 = 'feed0002-0000-4000-8000-000000000030';
const A_DUP_KEEPER = 'feed0002-0000-4000-8000-000000000031';
const A_DUP_MOVER = 'feed0002-0000-4000-8000-000000000032';
const A_SEQ2 = 'feed0002-0000-4000-8000-000000000033';
const B_SEQ0 = 'feed0002-0000-4000-8000-000000000034';
const DIVERGENT_1 = 'feed0002-0000-4000-8000-000000000035';
const DIVERGENT_2 = 'feed0002-0000-4000-8000-000000000036';
const PROBE = 'feed0002-0000-4000-8000-000000000037';

function fail(msg: string): never {
  console.error(`[REHEARSAL:audit-chain] FAIL: ${msg}`);
  process.exit(1);
}

async function indexExists(): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ indexname: string }[]>`
    SELECT indexname FROM pg_indexes
    WHERE tablename = 'EscrowAuditLog' AND indexname = ${INDEX_NAME}
  `;
  return rows.length === 1;
}

function runMigration(): void {
  execFileSync(
    'pnpm',
    [
      'exec',
      'prisma',
      'db',
      'execute',
      '--file',
      MIGRATION_FILE,
      '--schema',
      path.join(__dirname, '..', 'prisma', 'schema.prisma'),
    ],
    { stdio: 'inherit', cwd: path.join(__dirname, '..') },
  );
}

function runMigrationExpectFailure(): boolean {
  try {
    execFileSync(
      'pnpm',
      [
        'exec',
        'prisma',
        'db',
        'execute',
        '--file',
        MIGRATION_FILE,
        '--schema',
        path.join(__dirname, '..', 'prisma', 'schema.prisma'),
      ],
      { stdio: 'pipe', cwd: path.join(__dirname, '..') },
    );
    return false;
  } catch {
    return true;
  }
}

async function cleanupAuditRows(): Promise<void> {
  await prisma.escrowAuditLog.deleteMany({
    where: { escrowId: { in: [ESCROW_A, ESCROW_B] } },
  });
}

async function cleanupAll(): Promise<void> {
  await cleanupAuditRows();
  await prisma.escrow.deleteMany({ where: { id: { in: [ESCROW_A, ESCROW_B] } } });
  await prisma.journey.deleteMany({ where: { id: { in: [JOURNEY_A, JOURNEY_B] } } });
  await prisma.user.deleteMany({ where: { id: { in: [CUSTOMER, DRIVER] } } });
}

async function seedParents(): Promise<void> {
  // These two rows exist only to satisfy the FK on the fixture journeys and
  // are deleted by cleanupAll(); nothing ever decrypts phoneEncrypted here,
  // so a literal stands in for ciphertext. The `as any` that used to sit on
  // this array is gone: it would have hidden this very field rename from the
  // compiler even after the file was brought under typecheck.
  await prisma.user.createMany({
    data: [
      { id: CUSTOMER, phoneEncrypted: '+250700000901', phoneHash: 'rehearsal-audit-hash-c', nickname: 'rehearsal-customer', role: 'CUSTOMER' },
      { id: DRIVER, phoneEncrypted: '+250700000902', phoneHash: 'rehearsal-audit-hash-d', nickname: 'rehearsal-driver', role: 'DRIVER' },
    ],
  });
  await prisma.journey.createMany({
    data: [JOURNEY_A, JOURNEY_B].map((id) => ({
      id,
      customerId: CUSTOMER,
      status: 'MATCHED',
      pickupLat: -1.95,
      pickupLng: 30.06,
      pickupName: 'rehearsal',
      destinationLat: -1.96,
      destinationLng: 30.07,
      destinationName: 'rehearsal',
    })) as any,
  });
  await prisma.escrow.createMany({
    data: [
      { id: ESCROW_A, journeyId: JOURNEY_A, customerId: CUSTOMER, driverId: DRIVER, amount: 2000, commission: 200, driverPayout: 1800, status: 'HELD', txRef: 'rehearsal-audit-a' },
      { id: ESCROW_B, journeyId: JOURNEY_B, customerId: CUSTOMER, driverId: DRIVER, amount: 3000, commission: 300, driverPayout: 2700, status: 'HELD', txRef: 'rehearsal-audit-b' },
    ] as any,
  });
}

function auditRow(
  id: string,
  escrowId: string,
  sequenceNumber: number,
  action: string,
  amount: number,
  previousHash: string,
  entryHash: string,
  createdAt: string,
) {
  return {
    id,
    escrowId,
    sequenceNumber,
    action,
    previousHash,
    entryHash,
    amount,
    triggeredBy: 'rehearsal',
    createdAt: new Date(createdAt),
  };
}

async function main(): Promise<void> {
  // 1. Fresh migrate deploy must have created the unique index.
  if (!(await indexExists())) {
    fail(`fresh migrate deploy did not create ${INDEX_NAME}`);
  }
  console.log('[REHEARSAL:audit-chain] index present after fresh migrate deploy');

  // 2. Recreate the pre-migration world: no unique index, benign
  //    violating rows.
  await prisma.$executeRawUnsafe(`DROP INDEX "${INDEX_NAME}"`);
  await cleanupAll(); // defensive: stale fixture from an aborted run
  await seedParents();
  await prisma.escrowAuditLog.createMany({
    data: [
      // Escrow A: CREATED_PENDING at 0, then the CHARGE_CONFIRMED entry
      // double-appended at seq 1 by the race (same action/amount/prev,
      // different timestamps + hashes), then a later RELEASED at seq 2.
      auditRow(A_SEQ0, ESCROW_A, 0, 'CREATED_PENDING', 2000, 'GENESIS', 'rehearsal-hash-a0', '2026-07-28T10:00:00Z'),
      auditRow(A_DUP_KEEPER, ESCROW_A, 1, 'CHARGE_CONFIRMED', 2000, 'rehearsal-hash-a0', 'rehearsal-hash-a1', '2026-07-28T10:01:00Z'),
      auditRow(A_DUP_MOVER, ESCROW_A, 1, 'CHARGE_CONFIRMED', 2000, 'rehearsal-hash-a0', 'rehearsal-hash-a1-dup', '2026-07-28T10:01:00.500Z'),
      auditRow(A_SEQ2, ESCROW_A, 2, 'RELEASED', 2000, 'rehearsal-hash-a1', 'rehearsal-hash-a2', '2026-07-28T10:30:00Z'),
      // Escrow B: a compliant chain — must be untouched.
      auditRow(B_SEQ0, ESCROW_B, 0, 'CREATED_PENDING', 3000, 'GENESIS', 'rehearsal-hash-b0', '2026-07-28T11:00:00Z'),
    ],
  });

  // 3. Re-run the actual migration file against the violating database.
  runMigration();
  console.log('[REHEARSAL:audit-chain] migration re-executed against benign violating fixture');

  // 4. Deterministic resolution: nothing deleted, keeper kept, mover
  //    resequenced past the tail with the reversibility marker.
  const rows = await prisma.escrowAuditLog.findMany({
    where: { escrowId: { in: [ESCROW_A, ESCROW_B] } },
  });
  if (rows.length !== 5) {
    fail(`expected all 5 fixture audit rows to survive (none deleted), found ${rows.length}`);
  }
  const byId = new Map(rows.map((r) => [r.id, r]));
  const expectSeq = (id: string, seq: number, label: string) => {
    const row = byId.get(id);
    if (!row) fail(`${label}: row ${id} missing`);
    if (row!.sequenceNumber !== seq) {
      fail(`${label}: expected sequenceNumber ${seq}, got ${row!.sequenceNumber}`);
    }
  };
  expectSeq(A_SEQ0, 0, 'seq-0 untouched');
  expectSeq(A_DUP_KEEPER, 1, 'earliest duplicate keeps its position');
  expectSeq(A_DUP_MOVER, 3, 'later duplicate moved past the tail (max 2 + 1)');
  expectSeq(A_SEQ2, 2, 'tail row untouched');
  expectSeq(B_SEQ0, 0, 'compliant escrow untouched');

  const mover = byId.get(A_DUP_MOVER)!;
  const meta = (mover.metadata ?? {}) as Record<string, unknown>;
  if (meta.resequencedFrom !== 1 || meta.resequencedBy !== MIGRATION_NAME) {
    fail(`mover metadata marker wrong: ${JSON.stringify(mover.metadata)}`);
  }
  if (mover.entryHash !== 'rehearsal-hash-a1-dup') {
    fail('mover entryHash was rewritten — hashes must never change');
  }
  if ((byId.get(B_SEQ0)!.metadata ?? null) !== null) {
    fail('compliant escrow row gained metadata');
  }
  console.log('[REHEARSAL:audit-chain] benign duplicates resolved: earliest kept, mover resequenced with reversibility marker');

  // 5. The invariant now holds mechanically.
  if (!(await indexExists())) {
    fail('migration did not re-create the unique index');
  }
  let rejected = false;
  try {
    await prisma.escrowAuditLog.create({
      data: auditRow(PROBE, ESCROW_B, 0, 'CHARGE_CONFIRMED', 3000, 'rehearsal-hash-b0', 'rehearsal-hash-probe', '2026-07-28T11:05:00Z'),
    });
  } catch (err: any) {
    rejected = err?.code === 'P2002';
  }
  if (!rejected) {
    fail('index failed to reject a second entry at an occupied chain position');
  }
  console.log('[REHEARSAL:audit-chain] index rejects a fresh duplicate (P2002)');

  // 6. STOP path: a divergent fork must abort the migration untouched.
  await prisma.$executeRawUnsafe(`DROP INDEX "${INDEX_NAME}"`);
  await cleanupAuditRows();
  await prisma.escrowAuditLog.createMany({
    data: [
      auditRow(DIVERGENT_1, ESCROW_A, 0, 'RELEASED', 2000, 'GENESIS', 'rehearsal-hash-div1', '2026-07-28T12:00:00Z'),
      auditRow(DIVERGENT_2, ESCROW_A, 0, 'REFUNDED', 2000, 'GENESIS', 'rehearsal-hash-div2', '2026-07-28T12:00:01Z'),
    ],
  });
  if (!runMigrationExpectFailure()) {
    fail('migration SUCCEEDED on a divergent-hash fork — it must abort for human review');
  }
  const divergent = await prisma.escrowAuditLog.findMany({
    where: { escrowId: ESCROW_A },
    orderBy: { createdAt: 'asc' },
  });
  if (
    divergent.length !== 2 ||
    divergent[0].sequenceNumber !== 0 ||
    divergent[1].sequenceNumber !== 0 ||
    divergent[0].metadata !== null ||
    divergent[1].metadata !== null
  ) {
    fail('divergent fork rows were modified by the aborted migration');
  }
  if (await indexExists()) {
    fail('aborted migration still created the unique index');
  }
  console.log('[REHEARSAL:audit-chain] divergent fork ABORTS the migration and leaves rows byte-identical');

  // 7. Leave the database as the later seed step expects it: fixtures
  //    gone, index restored by the real migration on a clean table.
  await cleanupAll();
  runMigration();
  if (!(await indexExists())) {
    fail('final clean re-run did not restore the unique index');
  }
  console.log('[REHEARSAL:audit-chain] PASS — fixtures removed, index restored, database clean');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error('[REHEARSAL:audit-chain] error:', err);
    await prisma.$disconnect();
    process.exit(1);
  });
