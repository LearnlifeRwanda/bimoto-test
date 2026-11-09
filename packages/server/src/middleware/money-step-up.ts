// MIDDLEWARE/MONEY-STEP-UP.TS
//
// MONEY-PIN G2 — the short-lived proof that the person at the money
// surface is the person who owns it, and the gate that demands it.
//
// SHAPE BORROWED, NOT INVENTED. This is auth-status-cache.ts's pattern:
// a Map of per-user entries with an absolute expiry, an explicit
// invalidate, and a test reset. Same reasons apply — the check sits on a
// request path, and a DB round-trip per money request to read a fact that
// changes only on an explicit verify would be cost for nothing.
//
// SERVER-SIDE, AND THAT IS THE POINT. The session lives HERE, not in a
// token and not on the device. A client-held "I verified" flag is a flag
// the holder of the phone can set; the only thing that can be trusted to
// say a PIN was entered is the process that checked it. The client caches
// nothing but the knowledge that its last verify succeeded, so it can
// avoid prompting twice — it cannot manufacture the session.
//
// TTL IS FIVE MINUTES (MONEY_STEP_UP_TTL_MINUTES). Long enough that
// changing a payout preference is not two PIN prompts in a row; short
// enough that a phone handed over after a driver checked his balance is
// not carrying an open money session for the rest of the afternoon.
//
// THE ENTRY IS DROPPED, NOT MERELY EXPIRED, on logout and on any PIN
// change — a session proven by a PIN that no longer exists is not a
// session.

import { Request, Response, NextFunction } from 'express';
import { MONEY_STEP_UP_TTL_MINUTES } from '@bimoto/shared';
import { getMoneyPinStatus } from '../services/money-pin.service';
import { isCurrentApp } from './app-version';

const TTL_MS = MONEY_STEP_UP_TTL_MINUTES * 60 * 1000;

/**
 * Bounded so a long-lived process cannot grow this without limit. Money
 * step-ups are rare compared to auth checks, so the ceiling is far lower
 * than the auth cache's and will not be reached in the pilot.
 */
const MAX_ENTRIES = 1000;

interface StepUpEntry {
  /** When the proof was given — recorded so the audit row can say so. */
  verifiedAt: Date;
  expiresAt: number;
}

const sessions = new Map<string, StepUpEntry>();

function evictIfFull(): void {
  if (sessions.size < MAX_ENTRIES) return;
  const oldest = sessions.keys().next().value;
  if (oldest !== undefined) sessions.delete(oldest);
}

/** Opens a money step-up session. Called only after a PIN actually verified. */
export function openMoneyStepUp(userId: string): Date {
  evictIfFull();
  const verifiedAt = new Date();
  sessions.set(userId, { verifiedAt, expiresAt: Date.now() + TTL_MS });
  return verifiedAt;
}

/**
 * The live session for a user, or null. Expiry is checked on READ rather
 * than by a timer, so a session is never live merely because nothing has
 * swept it — the same reason auth-status-cache reads its own TTL.
 */
export function getMoneyStepUp(userId: string): StepUpEntry | null {
  const hit = sessions.get(userId);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    sessions.delete(userId);
    return null;
  }
  return hit;
}

/** Drops the session. Logout, PIN change, PIN reset activation. */
export function closeMoneyStepUp(userId: string): void {
  sessions.delete(userId);
}

export function _resetMoneyStepUpForTests(): void {
  sessions.clear();
}

/**
 * The gate on the money surfaces.
 *
 * Three outcomes, three distinct codes, because the client has three
 * genuinely different things to do about them:
 *
 *   MONEY_PIN_ENROLLMENT_REQUIRED (428) — this driver has no PIN. The
 *     client shows the enrollment screen and blocks the surface behind
 *     it. This IS the lazy enrollment D25 ruled for: nobody is asked to
 *     set a PIN at signup, at onboarding, or on any screen that is not
 *     about money. The first money surface he opens is where he is asked,
 *     once.
 *
 *   MONEY_STEP_UP_REQUIRED (401) — a PIN exists and no session is open.
 *     The client shows the PIN prompt and retries.
 *
 *   MONEY_PIN_LOCKED (423) — the attempt budget is spent. There is
 *     nothing to type; the client says when it lifts and offers the reset.
 *
 * A 403 is deliberately NOT used for any of them: 403 is what this
 * codebase returns for "you are the wrong kind of user", and none of
 * these are that. Every one of them is answerable by the right person.
 */
export async function requireMoneyStepUp(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'errors.unauthorized' } });
      return;
    }

    const status = await getMoneyPinStatus(userId);

    if (status.lockedUntil) {
      res.status(423).json({
        error: { code: 'MONEY_PIN_LOCKED', message: 'errors.moneyPinLocked' },
        lockedUntil: status.lockedUntil.toISOString(),
      });
      return;
    }

    if (status.state === 'NOT_SET') {
      // CUTGUARD v2 G6 (B-3) — THE ONLY ARM THAT IS VERSION-GATED, and
      // the reasoning matters more than the line.
      //
      // THE DEFECT. A v13 motari has no enrollment screen in his build.
      // 428 tells his client "set a PIN first" and his client has no way
      // to do that, so the whole earnings surface is a dead end for the
      // length of the rollout. He cannot see his money.
      //
      // WHY GATING THIS ARM IS SAFE, and gating the others would NOT be.
      // `X-App-Version` is client-supplied: anybody can claim to be v13.
      // A gate on the STEP-UP check (401) or the LOCKOUT (423) would
      // therefore be a bypass — a borrowed phone could skip a PIN its
      // owner actually set, which is the exact attack D25 exists to stop.
      // This arm cannot be abused that way, because it is only reachable
      // when `state === 'NOT_SET'`: claiming to be legacy can only ever
      // let you skip a PIN that does not exist. A driver who HAS a PIN is
      // gated at every version, header or no header.
      //
      // So no v14 money surface is opened. What changes is that a client
      // which cannot answer the enrollment prompt is not asked it — the
      // feature is scoped to the clients that can render it, which is the
      // opposite of a downgrade.
      if (isCurrentApp(req)) {
        res.status(428).json({
          error: {
            code: 'MONEY_PIN_ENROLLMENT_REQUIRED',
            message: 'errors.moneyPinEnrollmentRequired',
          },
        });
        return;
      }
      // Legacy: exactly the da9eca0 behaviour on this surface — through,
      // with no money session, because before MONEY-PIN there was no
      // session to have.
      next();
      return;
    }

    if (!getMoneyStepUp(userId)) {
      res.status(401).json({
        error: { code: 'MONEY_STEP_UP_REQUIRED', message: 'errors.moneyStepUpRequired' },
      });
      return;
    }

    next();
  } catch (err) {
    next(err);
  }
}
