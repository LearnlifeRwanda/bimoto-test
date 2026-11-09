import crypto from 'crypto';
import prisma from '../prisma';
import { encrypt, hashPhone } from '../utils/crypto';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  REFRESH_TOKEN_TTL_MS,
  TokenPayload,
} from '../utils/jwt';
import { AppError } from '../middleware/error-handler';
import { CLIENT_USER_INCLUDE, toClientUser } from './client-user';
import { sendLoginOtp, verifyLoginOtp } from './otp.service';
import {
  persistRefreshToken,
  findByJti,
  rotateRefreshToken,
  revokeFamily,
  hashToken,
} from './refresh-token.service';

// PREPROTO-AUTH G1 — OTP generation/verification lives in otp.service
// (CSPRNG + HMAC-at-rest + constant-time compare). This module only
// orchestrates the login flow: request → verify → user provisioning →
// token issuance.
//
// PREPROTO-AUTH G3 — sessions are server-side: every refresh token has a
// RefreshToken row keyed by jti. Login mints a new family; refresh
// rotates within the family; reuse of a rotated/revoked token revokes
// the family (reuse = theft); logout and freeze revoke server-side.

export async function requestOtp(phone: string) {
  const { testOnlyCode } = await sendLoginOtp(phone);
  // testOnlyCode exists ONLY under NODE_ENV=test (gated inside
  // otp.service) — the e2e suite reads it because the plaintext is no
  // longer recoverable from the DB. Absent in every other environment.
  return {
    success: true,
    message: 'OTP sent',
    ...(testOnlyCode ? { testOtp: testOnlyCode } : {}),
  };
}

/** Mint a new session: access token + refresh token in a fresh family. */
async function issueSession(payload: TokenPayload) {
  const jti = crypto.randomUUID();
  const familyId = crypto.randomUUID();
  const accessToken = generateAccessToken(payload);
  const refreshToken = generateRefreshToken(payload, jti);
  await persistRefreshToken({
    jti,
    userId: payload.userId,
    familyId,
    token: refreshToken,
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
  });
  return { accessToken, refreshToken };
}

export async function verifyOtp(phone: string, code: string) {
  const result = await verifyLoginOtp(phone, code);
  if (!result.verified) {
    throw new AppError(400, 'INVALID_OTP', 'errors.invalid_otp');
  }

  const phoneH = hashPhone(phone);

  // Find or create user.
  //
  // CUTGUARD v2 G1/U-6 — `include: CLIENT_USER_INCLUDE` is not cosmetic.
  // Login never loaded the driver profile, so the `user` the app stored
  // at login had no `driverProfile` at all; SettingsPage seeds its plate
  // and vehicle-description inputs from `user?.driverProfile?…`, got
  // `undefined` for both, and the next vehicle save PUT `""` over a
  // motari's real plate. The relation is now loaded here because
  // `toClientUser` demands it — a call site that forgets does not
  // compile.
  let user = await prisma.user.findUnique({
    where: { phoneHash: phoneH },
    include: CLIENT_USER_INCLUDE,
  });
  let isNewUser = false;

  if (!user) {
    isNewUser = true;

    // ACCOUNT-RIGHTS-CORE G3 (decision D19) — the returner.
    //
    // An account on this number was erased at some point. The tombstone
    // is all that survived it: a hash, a count, and whether the account
    // was suspended or frozen when it went. Only the last of those
    // changes anything here.
    //
    // A returner whose tombstone says `wasSuspended` is NOT refused. They
    // get an account, and that account is created flagged, which puts it
    // in front of a human at /admin/flagged. That is deliberate and it is
    // the policy this codebase already committed to in writing:
    // middleware/auth.ts says a flag is not a block and explains why
    // (flag -> automatic-block-without-review is the surveillance-creep
    // failure mode the project avoided), and PILOT-GUARD Item 1 exists
    // because a flag with no reason plus a hard refusal locked passengers
    // out silently and permanently. So: a reason, always, and never a
    // refusal.
    //
    // What this closes is the other direction - a suspended user deleting
    // their account to come back clean. Reactivation-by-deletion is what
    // the founder ruled out, and an admin looking at a flagged returner
    // is the answer to it. A returner who was never suspended gets
    // nothing: no flag, no reason, an ordinary new account.
    const tombstone = await prisma.accountTombstone.findUnique({
      where: { phoneHash: phoneH },
    });
    const returnedWhileSuspended = tombstone?.wasSuspended === true;

    user = await prisma.user.create({
      include: CLIENT_USER_INCLUDE,
      data: {
        phoneEncrypted: encrypt(phone),
        phoneHash: phoneH,
        nickname: `User${crypto.randomInt(0, 10000)}`,
        role: 'CUSTOMER',
        language: 'rw',
        ...(returnedWhileSuspended
          ? {
              isFlagged: true,
              flagReason: 'RETURNED_AFTER_DELETION_WHILE_SUSPENDED',
            }
          : {}),
      },
    });
  }

  const { accessToken, refreshToken } = await issueSession({
    userId: user.id,
    role: user.role,
  });

  // CUTGUARD v2 G1 (B-1, the blocker) — this used to `return { user, … }`
  // with `user` the RAW Prisma row.
  //
  // What that cost, in the field: the login user carried no `phone`, no
  // `emergencyContacts` and no `driverProfile` — the plaintext contract
  // `/me` has always answered with — while carrying every money-PIN
  // column, the unsalted `phoneHash`, and the fraud fields. Both editing
  // screens seed once from this object and save by whole-array replace,
  // so a rider who added a contact after login PUT `[theNewOne]` over
  // her real contacts and silenced her own SOS fan-out. v14's LoginPage
  // has the identical seed line, so shipping the APK would not have
  // fixed it; this is the fix, and it is on the server where both
  // generations of the app read it.
  return { user: toClientUser(user), isNewUser, accessToken, refreshToken };
}

export async function refreshTokens(token: string) {
  let payload: ReturnType<typeof verifyRefreshToken>;
  try {
    payload = verifyRefreshToken(token);
  } catch {
    throw new AppError(401, 'UNAUTHORIZED', 'errors.unauthorized');
  }

  // Tokens without a jti (issued before the session store existed) have
  // no row and cannot be rotated — re-login is the only path.
  const row = payload.jti ? await findByJti(payload.jti) : null;
  if (!row) {
    throw new AppError(401, 'UNAUTHORIZED', 'errors.unauthorized');
  }

  // Reuse = theft: a token that was already rotated or revoked is being
  // replayed. Kill the whole family so the thief's copy dies with it.
  if (row.revokedAt || row.replacedByJti) {
    await revokeFamily(row.familyId);
    throw new AppError(401, 'UNAUTHORIZED', 'errors.unauthorized');
  }
  if (row.expiresAt.getTime() <= Date.now()) {
    throw new AppError(401, 'UNAUTHORIZED', 'errors.unauthorized');
  }
  // Bind the row to the exact token string (jti alone could be forged
  // into a token signed by a leaked secret of a different deployment).
  if (row.hashedToken !== hashToken(token)) {
    await revokeFamily(row.familyId);
    throw new AppError(401, 'UNAUTHORIZED', 'errors.unauthorized');
  }

  const user = await prisma.user.findUnique({ where: { id: row.userId } });
  if (!user) {
    throw new AppError(401, 'UNAUTHORIZED', 'errors.unauthorized');
  }
  // Live freeze check — deliberately NOT the middleware's cached lookup:
  // freezing a user must cut session renewal immediately, not after a
  // cache TTL.
  if (user.frozenAt) {
    throw new AppError(403, 'ACCOUNT_FROZEN', 'errors.account_frozen');
  }

  const tokenPayload: TokenPayload = { userId: user.id, role: user.role };
  const newJti = crypto.randomUUID();
  const accessToken = generateAccessToken(tokenPayload);
  const refreshToken = generateRefreshToken(tokenPayload, newJti);
  await rotateRefreshToken(row.jti, {
    jti: newJti,
    userId: user.id,
    familyId: row.familyId,
    token: refreshToken,
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
  });

  return { accessToken, refreshToken };
}

/**
 * PREPROTO-AUTH G3 — server-side logout. Revokes the presented refresh
 * token's whole family (not just this device's cookie copy). Best-effort
 * by design: logout must always succeed client-side even when the token
 * is garbage or already gone.
 *
 * MONEY-PIN G2 — now RETURNS the user id it revoked for (or null), so the
 * logout route can also drop that user's money step-up session. A step-up
 * is a proof attached to a person at a moment; logging out ends the
 * moment, and an open money session outliving the session that opened it
 * would mean the next person to log in on that handset inherits it.
 */
export async function revokeSession(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  try {
    const payload = verifyRefreshToken(token);
    if (!payload.jti) return null;
    const row = await findByJti(payload.jti);
    if (row) await revokeFamily(row.familyId);
    return row?.userId ?? payload.userId ?? null;
  } catch {
    // Invalid/expired token — nothing to revoke.
    return null;
  }
}
