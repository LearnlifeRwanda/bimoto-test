-- ACCOUNT-RIGHTS-CORE G1 — the 72-hour deletion hold and the lawful
-- tombstone.
--
-- Additive throughout: one new enum, two new tables, one new foreign key
-- from a new table to User. Nothing existing is altered, renamed or
-- dropped, so a server running the previous build keeps working against
-- this schema until the code that reads these tables ships alongside it.

-- The three states a deletion request can be in. PENDING is cancellable;
-- both terminal states are not.
CREATE TYPE "DeletionRequestStatus" AS ENUM ('PENDING', 'CANCELLED', 'EXECUTED');

CREATE TABLE "DeletionRequest" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "status" "DeletionRequestStatus" NOT NULL DEFAULT 'PENDING',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "executesAt" TIMESTAMP(3) NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "deferredReason" TEXT,

    CONSTRAINT "DeletionRequest_pkey" PRIMARY KEY ("id")
);

-- Serves the execution job's due-row sweep: PENDING rows whose clock has
-- run out.
CREATE INDEX "DeletionRequest_status_executesAt_idx" ON "DeletionRequest"("status", "executesAt");

-- Serves the per-user "do I have a pending request" read that GET /me and
-- the scheduled-ride carve-out both make.
CREATE INDEX "DeletionRequest_userId_status_idx" ON "DeletionRequest"("userId", "status");

-- ONE PENDING REQUEST PER USER, in the database rather than in a hope.
--
-- Prisma's schema language cannot express a partial unique index, so this
-- is raw SQL here plus a find-then-create in the service — exactly the
-- shape PAYOUT-IDEMPOTENCY used for the in-flight payout batch
-- (20260729000000) and SOS-FOLLOW for the active emergency alert
-- (20260819000000). PARTIAL on purpose: CANCELLED and EXECUTED rows are
-- unlimited per user, because a user who cancels and asks again must be
-- able to, and the history of asking is worth keeping. Only two live
-- requests at once are impossible.
--
-- Prisma's introspection ignores partial indexes, so the e2e
-- schema-faithfulness gate (`migrate diff --from-url ... --exit-code`)
-- does not see it and will never propose dropping it. A companion comment
-- on the DeletionRequest model in schema.prisma documents this.
CREATE UNIQUE INDEX "DeletionRequest_one_pending_per_user" ON "DeletionRequest"("userId") WHERE "status" = 'PENDING';

-- Cascade, and it never fires. Erasure ANONYMISES the User row; it never
-- deletes it. The cascade states the ownership truthfully rather than
-- describing a path any code takes.
ALTER TABLE "DeletionRequest" ADD CONSTRAINT "DeletionRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The lawful minimal tombstone: founder ruling D2's three facts, keyed by
-- the ORIGINAL phone hash, and nothing more. No relation to User — the
-- tombstone must outlive and out-scope the row it came from. No encrypted
-- phone: a hash is one-way, a ciphertext is not.
CREATE TABLE "AccountTombstone" (
    "phoneHash" TEXT NOT NULL,
    "deletionCount" INTEGER NOT NULL DEFAULT 0,
    "wasSuspended" BOOLEAN NOT NULL DEFAULT false,
    "lastDeletedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountTombstone_pkey" PRIMARY KEY ("phoneHash")
);
