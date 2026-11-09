import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, TokenPayload } from '../utils/jwt';
import prisma from '../prisma';
import {
  getAuthStatusCache,
  setAuthStatusCache,
} from './auth-status-cache';

export {
  invalidateAuthStatusCache,
  _resetAuthStatusCacheForTests,
} from './auth-status-cache';

declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload & { cooperativeId?: string | null };
    }
  }
}

/**
 * R3-AUTH-CROSS-ORIGIN-FIX — extract a Bearer token from the Authorization
 * header as a fallback for the accessToken cookie. Cross-origin browser
 * requests don't carry cookies unless the client opts in with
 * `credentials: 'include'`; the client already sends `Authorization: Bearer
 * <token>` on every authenticated fetch, so honouring it here closes the
 * cross-origin auth gap (belt-and-suspenders alongside the client-side
 * credentials fix). Same-origin cookie auth is unchanged — the cookie is
 * still preferred when present.
 */
export function extractBearerToken(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const [scheme, value] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !value) return undefined;
  return value.trim() || undefined;
}

/**
 * ACCOUNT-RIGHTS-CORE G3 — the caller's blocking status, in ONE query.
 *
 * This was `isUserFrozen`, and it selected `frozenAt` alone. That is how a
 * deleted account kept working: `isDeleted` was written by the erasure and
 * read NOWHERE in the repo, so an anonymised "Deleted User" with a live
 * access token carried on using the app. The erasure now revokes every
 * refresh token (account-deletion.service step 7), which stops session
 * RENEWAL; this read is the belt beneath those braces, and it closes the
 * remaining gap — an access token minted minutes before the erasure and
 * still inside its own TTL.
 *
 * Both facts come off the same row, so the second one is free. Renaming
 * rather than adding a sibling lookup is the point: two lookups on the
 * hottest path in the server is how a per-request DB cost doubles.
 */
async function resolveUserAuthStatus(
  userId: string,
): Promise<{ frozenAt: Date | null; isDeleted: boolean }> {
  const cached = getAuthStatusCache(userId);
  if (cached) return { frozenAt: cached.frozenAt, isDeleted: cached.isDeleted };
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { frozenAt: true, isDeleted: true },
  });
  const frozenAt: Date | null = row?.frozenAt ?? null;
  const isDeleted: boolean = row?.isDeleted ?? false;
  setAuthStatusCache(userId, frozenAt, isDeleted);
  return { frozenAt, isDeleted };
}

/**
 * DOC-GUARD G2 — the outcome of authenticating a request, before it is
 * turned into an HTTP response.
 *
 * authMiddleware translates this to 401/403 as it always has. The
 * document route (routes/document.routes.ts) needs the same decision
 * but must render EVERY failure as 404, so that an anonymous prober and
 * a logged-in stranger get answers that are byte-identical. Factoring
 * the decision out is the only way to have one auth rule and two
 * renderings; the rule itself is unchanged.
 */
export type AuthFailureCode = 'UNAUTHORIZED' | 'TOKEN_EXPIRED' | 'ACCOUNT_FROZEN';

export type AuthOutcome =
  | { ok: true; payload: TokenPayload }
  | { ok: false; code: AuthFailureCode; frozenAt?: Date };

export async function resolveAuth(req: Request): Promise<AuthOutcome> {
  const token =
    req.cookies?.accessToken ?? extractBearerToken(req.headers.authorization);
  if (!token) {
    return { ok: false, code: 'UNAUTHORIZED' };
  }
  let payload: TokenPayload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    return { ok: false, code: 'TOKEN_EXPIRED' };
  }
  try {
    // Note: User.isFlagged (from Dispatch C's AML detection) is NOT a
    // blocking condition at this layer. Flagged users continue to use
    // the app while admin reviews their case (silence-equals-consent +
    // admin-in-loop design). Only User.frozenAt (set by an explicit
    // admin freeze action via Dispatch H) blocks at auth.
    //
    // If you ever need to block flagged users at auth (e.g. regulator
    // requirement), add the check below this comment — but expect
    // business pushback because flag→automatic-block-without-review is
    // the surveillance-creep failure mode the project explicitly
    // avoided. ACCOUNT-RIGHTS-CORE's D19 returner flag is written in
    // exactly that spirit: it marks the account for admin review and
    // blocks nothing.
    const status = await resolveUserAuthStatus(payload.userId);
    if (status.frozenAt) {
      return { ok: false, code: 'ACCOUNT_FROZEN', frozenAt: status.frozenAt };
    }
    // ACCOUNT-RIGHTS-CORE G3 — an executed erasure ends the session, and
    // it ends it as UNAUTHORIZED rather than as its own code. A frozen
    // account gets a distinct 403 because there is an account, a reason
    // and an appeal; an erased one gets the same answer a stranger's
    // token gets, because there is nothing left to say and saying more
    // would tell a caller holding a stale token that this number once
    // had an account.
    if (status.isDeleted) {
      return { ok: false, code: 'UNAUTHORIZED' };
    }
  } catch (err) {
    // Defensive: if the status lookup fails, fall through with the token.
    // The auth grant itself remains valid; the next request can re-check.
    console.warn('[AUTH] status-check-fail', err);
  }
  return { ok: true, payload };
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const outcome = await resolveAuth(req);
  if (!outcome.ok) {
    if (outcome.code === 'ACCOUNT_FROZEN') {
      res.status(403).json({
        error: {
          code: 'ACCOUNT_FROZEN',
          message: 'errors.account_frozen',
          frozenSince: outcome.frozenAt,
        },
      });
      return;
    }
    res.status(401).json({
      error: {
        code: outcome.code,
        message:
          outcome.code === 'UNAUTHORIZED'
            ? 'errors.unauthorized'
            : 'errors.token_expired',
      },
    });
    return;
  }
  req.user = outcome.payload;
  next();
}

export function driverOnly(req: Request, res: Response, next: NextFunction): void {
  if (!req.user || (req.user.role !== 'DRIVER' && req.user.role !== 'BOTH')) {
    res.status(403).json({ error: { code: 'FORBIDDEN', message: 'errors.driver_only' } });
    return;
  }
  next();
}

export function adminOnly(req: Request, res: Response, next: NextFunction): void {
  if (!req.user || req.user.role !== 'ADMIN') {
    res.status(403).json({ error: { code: 'FORBIDDEN', message: 'errors.admin_only' } });
    return;
  }
  next();
}

export function customerOnly(req: Request, res: Response, next: NextFunction): void {
  if (!req.user || (req.user.role !== 'CUSTOMER' && req.user.role !== 'BOTH')) {
    res.status(403).json({ error: { code: 'FORBIDDEN', message: 'errors.customer_only' } });
    return;
  }
  next();
}

/**
 * INTEL-DECK G4 — the mobility intelligence READ surface: k-anonymised,
 * marginal-suppressed aggregates and the tier configuration that explains
 * them. ADMIN keeps everything it had; ANALYST gets this and, by every
 * other guard in this file refusing a role it does not name, nothing else.
 *
 * Deliberately read-only. The mutations on the same router — run-now and
 * tier-config/reload — stay behind adminOnly: an analyst may read what the
 * pipeline produced, never re-run it or move the thresholds that govern it.
 */
export function intelRead(req: Request, res: Response, next: NextFunction): void {
  if (!req.user || (req.user.role !== 'ANALYST' && req.user.role !== 'ADMIN')) {
    res.status(403).json({ error: { code: 'FORBIDDEN', message: 'errors.intel_read_only' } });
    return;
  }
  next();
}

/**
 * Dispatch M — gate cooperative-leader routes. Must run AFTER
 * authMiddleware. Looks up the user's cooperativeId from the database
 * and attaches it to req.user.cooperativeId for downstream handlers.
 *
 * Authorisation matrix:
 *   - ADMIN: allowed; cooperativeId taken from query.cooperativeId
 *     when reading another cooperative's data, otherwise null. Admins
 *     can read any cooperative; dispatch / management still requires
 *     a leader's intent (see dispatch.service.ts).
 *   - COOPERATIVE_LEADER: must have a non-null cooperativeId on their
 *     User row, otherwise 403 (no-cooperative-assigned).
 *   - All other roles: 403 (cooperative-leader-role-required).
 */
export async function requireCooperativeLeader(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.user) {
    res
      .status(401)
      .json({ error: { code: 'UNAUTHORIZED', message: 'errors.unauthorized' } });
    return;
  }
  const role = req.user.role;
  if (role !== 'COOPERATIVE_LEADER' && role !== 'ADMIN') {
    res.status(403).json({
      error: {
        code: 'COOPERATIVE_LEADER_ROLE_REQUIRED',
        message: 'errors.cooperative_leader_role_required',
      },
    });
    return;
  }
  try {
    const userRow = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { cooperativeId: true },
    });
    const dbCoopId: string | null = userRow?.cooperativeId ?? null;
    if (role === 'COOPERATIVE_LEADER' && !dbCoopId) {
      res.status(403).json({
        error: {
          code: 'NO_COOPERATIVE_ASSIGNED',
          message: 'errors.no_cooperative_assigned',
        },
      });
      return;
    }
    if (role === 'ADMIN') {
      const queryCoopId =
        typeof req.query.cooperativeId === 'string' && req.query.cooperativeId
          ? req.query.cooperativeId
          : (req.body && typeof req.body.cooperativeId === 'string'
              ? req.body.cooperativeId
              : null);
      req.user.cooperativeId = queryCoopId ?? dbCoopId ?? null;
    } else {
      req.user.cooperativeId = dbCoopId;
    }
    next();
  } catch (err) {
    console.warn('[AUTH] cooperative-leader-check-fail', err);
    res
      .status(500)
      .json({ error: { code: 'INTERNAL_ERROR', message: 'errors.generic' } });
  }
}
