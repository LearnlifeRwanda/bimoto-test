// MIDDLEWARE/APP-VERSION.TS
//
// CUTGUARD v2 G6 — the app-version contract, and the lever the pilot did
// not have.
//
// THE PROBLEM, at abb6a26. Grep the whole repository for `X-App-Version`
// or `appVersion` and you get nothing. There was no version signal
// anywhere, in either direction. The server could not tell a v13 phone
// from a v14 one, so during a rollout it had exactly one answer for both
// — and the two generations wanted different answers:
//
//   B-2 — a v13 passenger CRASHES on the new bid-list savings preview.
//         Her BidListPage reads `totalCommissionAmount.toLocaleString()`,
//         and MONEY-VIEW's customer-safe shape does not carry that key.
//   B-3 — a v13 motari is 428-locked out of his earnings by the money-PIN
//         gate, with no enrollment screen in his build to answer it with.
//
// Neither is fixable by choosing a better payload. They are opposite
// requirements, and telling them apart is the only way to serve both.
//
// AND THE OTHER HALF: the pilot had no way to END a rollout. If a build
// turns out to be broken there was nothing to say "stop using it".
// MIN_SUPPORTED_APP_VERSION and the 426 shape below are that lever,
// DEFINED and deliberately NOT switched on — see the constant.
//
// SAFE DIRECTION, everywhere. Absent, unparseable, negative, or
// nonsense ⇒ 0 ⇒ LEGACY. A caller that says nothing is treated as the
// oldest client, which is the answer that cannot break anybody: it
// withholds new behaviour rather than assuming a phone can render it.
//
// WHAT THIS HEADER IS NOT. It is client-supplied, so it is a
// COMPATIBILITY signal and never a security one. Any caller can claim any
// version. Every gate that reads it is written so that claiming to be
// legacy can only ever get you LESS — never past a check. The money-PIN
// gate is the one where that distinction has teeth, and money-step-up.ts
// says at length exactly which arm is gated and why the other cannot be.

import { NextFunction, Request, Response } from 'express';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /**
       * The client's own build number, or 0 for "legacy / did not say".
       * Never undefined once `appVersionMiddleware` has run, so a gate
       * cannot accidentally read `undefined >= 14` as false for the wrong
       * reason.
       */
      appVersion: number;
    }
  }
}

/** The header the client sends. Same string as the client's APP_VERSION_HEADER. */
export const APP_VERSION_HEADER = 'x-app-version';

/**
 * The version this dispatch's new behaviour is scoped to.
 *
 * 14 is the cut being prepared — `android/app/build.gradle`'s
 * `bimotoDefaultVersionCode`, which is also what the client bakes into
 * the header. Named rather than written as a bare `14` at each gate so
 * the next cut moves one line.
 */
export const CURRENT_APP_VERSION = 14;

/**
 * THE FORCE-UPGRADE LEVER, defined and NOT enforced.
 *
 * When the pilot needs to end a rollout — a build that corrupts data, a
 * protocol change that cannot be made compatible — this is the number to
 * raise, and `upgradeRequiredResponse` is the answer clients get. Today
 * it is 0, which means no client is ever refused.
 *
 * ENFORCEMENT IS NOT SWITCHED ON, on purpose. Prematurely bricking
 * phones is the opposite failure to the one this dispatch is fixing: a
 * motari whose app refuses to open cannot work, and cannot necessarily
 * download a new APK either. The lever exists, is documented
 * (docs/rollout-window.md), and its flip is an operational decision like
 * COUNTER_BID_ENABLED — a person's call, made when there is a reason.
 */
export const MIN_SUPPORTED_APP_VERSION = 0;

/**
 * Parse a client-supplied version header.
 *
 * Exported for the test, and written to have exactly one failure mode:
 * anything that is not a non-negative integer is 0. No throwing, no
 * NaN leaking into a comparison, no partial parse of "14.1-beta" into
 * something a gate would believe.
 */
export function parseAppVersion(raw: unknown): number {
  if (typeof raw !== 'string') return 0;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return 0;
  const n = Number(trimmed);
  return Number.isSafeInteger(n) && n >= 0 ? n : 0;
}

/**
 * Attach `req.appVersion` to every request. Mounted once, before the
 * routers, so no route has to remember to ask.
 */
export function appVersionMiddleware(req: Request, _res: Response, next: NextFunction): void {
  req.appVersion = parseAppVersion(req.headers[APP_VERSION_HEADER]);
  next();
}

/** True when the caller is new enough for this dispatch's behaviour. */
export function isCurrentApp(req: Pick<Request, 'appVersion'>): boolean {
  return req.appVersion >= CURRENT_APP_VERSION;
}

/**
 * THE 426 SHAPE, defined so the client can be built against it before it
 * is ever sent.
 *
 * `minVersion` is in the body rather than only in the message because a
 * client that must decide "am I the one being refused?" should not have
 * to parse prose. `message` is a translation KEY, matching every other
 * error this API emits.
 */
export interface UpgradeRequiredBody {
  error: {
    code: 'UPGRADE_REQUIRED';
    message: string;
  };
  minVersion: number;
  yourVersion: number;
}

export function upgradeRequiredResponse(req: Pick<Request, 'appVersion'>): UpgradeRequiredBody {
  return {
    error: { code: 'UPGRADE_REQUIRED', message: 'errors.upgradeRequired' },
    minVersion: MIN_SUPPORTED_APP_VERSION,
    yourVersion: req.appVersion,
  };
}

/**
 * The enforcement, written and mounted NOWHERE.
 *
 * Kept in this file rather than left for a future dispatch to invent
 * under pressure: when the flip is needed it will be needed quickly, and
 * the difference between "raise a constant and mount one middleware" and
 * "design a force-upgrade path during an incident" is the whole reason
 * this exists. With MIN_SUPPORTED_APP_VERSION at 0 it is a no-op even if
 * somebody does mount it.
 */
export function requireSupportedApp(req: Request, res: Response, next: NextFunction): void {
  if (MIN_SUPPORTED_APP_VERSION > 0 && req.appVersion < MIN_SUPPORTED_APP_VERSION) {
    res.status(426).json(upgradeRequiredResponse(req));
    return;
  }
  next();
}
