-- PREPROTO-SIM G3: simulated SMS inbox storage.
--
-- SimulatedMessage: one row per outbound SMS captured while
-- SMS_MODE=simulated. Rows carry login OTP codes, so read access is
-- restricted to the guarded /api/sim routes (admin session or
-- constant-time SIM_INBOX_TOKEN header) — never world-readable.
--
-- Purely additive; the live SMS path never touches this table.

-- CreateTable
CREATE TABLE "SimulatedMessage" (
    "id" UUID NOT NULL,
    "toPhone" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "category" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SimulatedMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SimulatedMessage_createdAt_idx" ON "SimulatedMessage"("createdAt");
