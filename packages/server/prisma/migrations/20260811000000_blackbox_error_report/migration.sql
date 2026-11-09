-- BLACKBOX G4: the team can read a crash instead of a memory of one.
--
-- One table for error-report bundles a user chose to send from the
-- Diagnostics screen. Nothing writes here automatically — the client has
-- no background upload path at all — so a row means a person tapped
-- Send report.
--
-- `entries` holds the device's error ledger verbatim. It was redacted on
-- the phone BEFORE being stored there (tokens dropped, phone shapes
-- masked, query strings stripped), so no secret can arrive in it, and it
-- is capped both on the device and again by the route.
--
-- Purely additive: a new table and its two indexes. No existing table,
-- column, constraint or row is touched, so a server on the old code runs
-- unchanged against this schema.

CREATE TABLE "ErrorReport" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "reporterRole" "UserRole" NOT NULL,
    "appBuild" TEXT NOT NULL,
    "entryCount" INTEGER NOT NULL,
    "entries" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErrorReport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ErrorReport_createdAt_idx" ON "ErrorReport"("createdAt");
CREATE INDEX "ErrorReport_userId_idx" ON "ErrorReport"("userId");

ALTER TABLE "ErrorReport" ADD CONSTRAINT "ErrorReport_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
