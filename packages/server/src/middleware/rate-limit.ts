import { Request, Response, NextFunction } from 'express';

const requestCounts = new Map<string, { count: number; resetAt: number }>();

export function _resetRateLimitForTests(): void {
  requestCounts.clear();
}

// `scope` separates buckets between unrelated routes: the counts map is
// module-global and keyed per IP, so without a scope a chatty endpoint
// (e.g. geocode autocomplete at 20/min) would consume the same budget the
// 3/min OTP limiters check against. Existing callers omit it and keep
// sharing the default bucket, exactly as before.
//
// PREPROTO-AUTH G2/G5 — `keyExtractor` keys the bucket on an identity
// (e.g. the phone number in the request body) instead of the source IP,
// so an attacker cannot spread OTP guesses for one victim across many
// IPs, and NAT'd legitimate users don't share a budget. Falls back to
// the IP when the extractor returns nothing (malformed body etc.) —
// fail closed, never unlimited.
export function rateLimit(
  maxRequests: number,
  windowMs: number,
  scope = '',
  keyExtractor?: (req: Request) => string | undefined,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Bypass rate-limit in test env — Playwright fixtures reuse TestCustomer/
    // TestDriver across 5+ specs and exhaust the per-user OTP budget within a
    // single CI run. Production behaviour unchanged.
    if (process.env.NODE_ENV === 'test') {
      next();
      return;
    }
    const identity = keyExtractor?.(req);
    const key = `${scope}:${identity || req.ip || 'unknown'}`;
    const now = Date.now();
    const entry = requestCounts.get(key);
    if (!entry || now > entry.resetAt) {
      requestCounts.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }
    if (entry.count >= maxRequests) {
      res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'errors.rate_limited' } });
      return;
    }
    entry.count++;
    next();
  };
}
