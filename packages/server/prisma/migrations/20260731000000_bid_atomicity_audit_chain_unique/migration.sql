-- BID-ATOMICITY G3: the escrow audit chain cannot fork — at most one
-- EscrowAuditLog entry per (escrowId, sequenceNumber), enforced by the
-- database rather than a read-then-insert check.
--
-- Why: appendAuditEntryTx reads the last entry, computes last+1 and
-- inserts. Two appends racing on one escrow both compute the same
-- sequence number, both insert, and the hash chain (prevHash → hash)
-- forks; verifyAuditChain then reports BROKEN permanently. The old
-- @@index([escrowId, sequenceNumber]) is not unique, so nothing stopped
-- the second row. With this unique index the losing insert fails at the
-- database and appendAuditEntryTx re-reads, recomputes and retries, so
-- legitimate concurrent appends serialize instead of forking.
--
-- Pre-flight: the live pilot database may already hold rows that violate
-- the invariant (the race this migration closes may have already fired).
-- Naive index creation would then fail mid-deploy. Two duplicate shapes,
-- handled differently — this is the money audit trail, so NOTHING is
-- deleted and no hash is rewritten:
--
--   * BENIGN double-append: rows sharing (escrowId, sequenceNumber) that
--     also agree on (action, amount, previousHash) — the same logical
--     event written twice by the race. Deterministic, reversible
--     resolution: keep the earliest row (by createdAt, then id) at its
--     sequence number; move each later duplicate past the escrow's chain
--     tail (max sequenceNumber + 1, +2, …, ordered by createdAt, id),
--     stamping metadata.resequencedFrom with the original number and
--     metadata.resequencedBy with this migration's name. Reversal =
--     restore sequenceNumber from metadata.resequencedFrom. The chain's
--     verification status for that escrow is unchanged by this move (it
--     was already broken by the fork; repairing hashes would mean
--     falsifying audit rows, which is out of bounds) — the move only
--     makes the invariant enforceable without losing a single row.
--
--   * DIVERGENT fork: rows sharing (escrowId, sequenceNumber) that
--     DISAGREE on action, amount or previousHash — two different events
--     claiming the same chain position. No deterministic rule may pick a
--     survivor here. The migration ABORTS (RAISE EXCEPTION) listing the
--     rows; a human resolves them and re-runs the deploy. The abort
--     happens before any resequencing or index work, and the exception
--     rolls back the migration transaction, so a divergent database is
--     left byte-identical.
--
-- Expected case (no violations): both blocks are silent no-ops.

DO $$
DECLARE
  divergent_rows text;
  resolved integer;
BEGIN
  -- 1. STOP on divergent forks: same chain position, different payloads.
  SELECT string_agg(
           format(
             'escrowId=%s seq=%s ids=[%s] actions=[%s] amounts=[%s] previousHashes=[%s]',
             d."escrowId", d."sequenceNumber", d.ids, d.actions, d.amounts, d.prev_hashes
           ),
           E'\n'
         )
    INTO divergent_rows
    FROM (
      SELECT "escrowId",
             "sequenceNumber",
             string_agg("id"::text, ', ' ORDER BY "createdAt", "id") AS ids,
             string_agg(DISTINCT "action", ', ') AS actions,
             string_agg(DISTINCT "amount"::text, ', ') AS amounts,
             string_agg(DISTINCT "previousHash", ', ') AS prev_hashes
      FROM "EscrowAuditLog"
      GROUP BY "escrowId", "sequenceNumber"
      HAVING count(*) > 1
         AND (count(DISTINCT "action") > 1
           OR count(DISTINCT "amount") > 1
           OR count(DISTINCT "previousHash") > 1)
    ) d;

  IF divergent_rows IS NOT NULL THEN
    RAISE EXCEPTION USING
      MESSAGE = 'BID-ATOMICITY: divergent audit-chain fork(s) found — two different events claim the same (escrowId, sequenceNumber). This migration will not choose a survivor in the money audit trail. Resolve manually, then re-run. Rows:' || E'\n' || divergent_rows,
      ERRCODE = 'P0001';
  END IF;

  -- 2. Resequence benign double-appends past the chain tail.
  WITH dup AS (
    SELECT "id",
           "escrowId",
           "sequenceNumber",
           row_number() OVER (
             PARTITION BY "escrowId", "sequenceNumber"
             ORDER BY "createdAt" ASC, "id" ASC
           ) AS rn_in_group
    FROM "EscrowAuditLog"
    WHERE ("escrowId", "sequenceNumber") IN (
      SELECT "escrowId", "sequenceNumber"
      FROM "EscrowAuditLog"
      GROUP BY "escrowId", "sequenceNumber"
      HAVING count(*) > 1
    )
  ),
  movers AS (
    SELECT d."id",
           d."escrowId",
           d."sequenceNumber" AS original_seq,
           row_number() OVER (
             PARTITION BY d."escrowId"
             ORDER BY d."sequenceNumber" ASC, d.rn_in_group ASC
           ) AS move_rank
    FROM dup d
    WHERE d.rn_in_group > 1
  ),
  tails AS (
    SELECT "escrowId", max("sequenceNumber") AS tail_seq
    FROM "EscrowAuditLog"
    GROUP BY "escrowId"
  ),
  moved AS (
    UPDATE "EscrowAuditLog" e
    SET "sequenceNumber" = t.tail_seq + m.move_rank,
        "metadata" = coalesce(e."metadata", '{}'::jsonb)
          || jsonb_build_object(
               'resequencedFrom', m.original_seq,
               'resequencedBy', '20260731000000_bid_atomicity_audit_chain_unique'
             )
    FROM movers m
    JOIN tails t ON t."escrowId" = m."escrowId"
    WHERE e."id" = m."id"
    RETURNING e."id"
  )
  SELECT count(*) INTO resolved FROM moved;

  IF resolved > 0 THEN
    RAISE WARNING
      'BID-ATOMICITY: resequenced % benign duplicate audit row(s) past their chain tail (metadata.resequencedFrom records the original sequenceNumber; metadata.resequencedBy = 20260731000000_bid_atomicity_audit_chain_unique). No rows were deleted and no hash was rewritten; the earliest row per (escrowId, sequenceNumber) keeps its position. See docs/deployment/runbook.md.',
      resolved;
  END IF;
END $$;

-- The invariant itself. IF EXISTS on the drop keeps the migration
-- re-runnable by the CI rehearsal script, which re-executes this file
-- against a seeded violating database after the fresh deploy.
DROP INDEX IF EXISTS "EscrowAuditLog_escrowId_sequenceNumber_idx";

CREATE UNIQUE INDEX "EscrowAuditLog_escrowId_sequenceNumber_key"
  ON "EscrowAuditLog"("escrowId", "sequenceNumber");
