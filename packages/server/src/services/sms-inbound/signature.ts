// Africa's Talking inbound webhook HMAC verification.
//
// AT signs the raw request body with HMAC-SHA256 using a shared secret
// (configured per shortcode in the AT dashboard). We compare the signature
// in constant time so a missing or malformed header can never leak timing.
//
// Dev-mode fallback: if AT_INBOUND_HMAC_SECRET is empty (fresh dev env, CI
// without secrets), we log a warning and accept the request. Production
// MUST set the secret — the env-default in config.ts is intentionally ''.

import { createHmac, timingSafeEqual } from 'crypto';

export function verifyAtSignature(
  rawBody: string,
  headerSignature: string,
  secret: string,
): boolean {
  if (!secret) {
    console.warn('[at-signature-verify-skipped] AT_INBOUND_HMAC_SECRET unset — dev mode');
    return true;
  }
  if (!headerSignature || typeof headerSignature !== 'string') return false;
  if (typeof rawBody !== 'string') return false;

  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  const provided = headerSignature.trim().toLowerCase();

  // timingSafeEqual requires equal-length buffers. Length mismatch is itself
  // a verification failure, but we still build same-length buffers to keep
  // the compare constant-time-safe.
  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from(provided, 'utf8');
  if (expectedBuf.length !== providedBuf.length) return false;
  try {
    return timingSafeEqual(expectedBuf, providedBuf);
  } catch {
    return false;
  }
}
