// PREPROTO-AUTH G5 — explicit CORS allow-list. The single-origin
// `cors({ origin: CLIENT_URL })` config could not express "web client +
// Capacitor WebView origin", and the tempting shortcut (reflecting
// req.headers.origin) would turn credentialed CORS off entirely. This
// module owns the allow-list; an unlisted origin is answered with a hard
// 403, never a silent downgrade.

import { AppError } from './error-handler';
import { config } from '../config';

export function allowedOrigins(): string[] {
  const raw = (config.CORS_ORIGINS ?? '').trim();
  if (!raw) return [config.CLIENT_URL];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function corsOriginCheck(
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void,
): void {
  // No Origin header = non-browser client (curl, native HTTP, server-to-
  // server). CORS is a browser mechanism; these requests still pass auth.
  if (!origin) {
    callback(null, true);
    return;
  }
  if (allowedOrigins().includes(origin)) {
    callback(null, true);
    return;
  }
  callback(new AppError(403, 'CORS_ORIGIN_FORBIDDEN', 'errors.forbidden'));
}

/**
 * PREPROTO-AUTH G5 — express `trust proxy` value from the TRUST_PROXY
 * env string. Behind Cloudflare Tunnel every req.ip is the tunnel's
 * address unless the proxy hop is trusted, which would collapse all rate
 * limiting onto one bucket. 'true' means exactly one trusted hop (the
 * tunnel), NOT express's trust-everything `true` — a spoofed
 * X-Forwarded-For from a direct connection must not let an attacker
 * choose their own rate-limit bucket.
 */
export function parseTrustProxy(value: string): false | number | string {
  const v = value.trim();
  if (!v || v === 'false') return false;
  if (v === 'true') return 1;
  const n = Number(v);
  if (Number.isInteger(n) && n >= 0) return n;
  return v; // named presets/subnets, e.g. 'loopback', '10.0.0.0/8'
}
