-- PREPROTO-AUTH G3: revocable server-side sessions (adversarial review #3).
--
-- RefreshToken: one row per issued refresh token. familyId groups a
-- rotation chain (login mints a family; every refresh rotates to a new
-- jti in the same family, stamping replacedByJti on the old row).
-- Presenting an already-rotated/revoked token is treated as theft and
-- revokes the whole family. hashedToken is sha256 of the signed JWT —
-- the raw token is never at rest.
--
-- Purely additive. Refresh tokens issued before this migration carry no
-- jti and no row, so their next /refresh answers 401 and the client
-- re-logs-in — the intended hard cutover to revocable sessions.

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" UUID NOT NULL,
    "jti" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "familyId" TEXT NOT NULL,
    "hashedToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "replacedByJti" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_jti_key" ON "RefreshToken"("jti");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_revokedAt_idx" ON "RefreshToken"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "RefreshToken_familyId_idx" ON "RefreshToken"("familyId");
