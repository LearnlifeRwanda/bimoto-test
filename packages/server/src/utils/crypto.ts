import crypto from 'crypto';
import { config } from '../config';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

/**
 * The AES key, derived from ENCRYPTION_KEY exactly as it always has
 * been. Exported for utils/document-crypto.ts so that files and phone
 * numbers cannot drift onto different key material — there is one key
 * source in this server, and this is it.
 */
export function getEncryptionKey(): Buffer {
  return Buffer.from(config.ENCRYPTION_KEY, 'hex');
}

function getKey(): Buffer {
  return getEncryptionKey();
}

export function encrypt(text: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();
  return iv.toString('hex') + ':' + encrypted + ':' + tag.toString('hex');
}

export function decrypt(data: string): string {
  const [ivHex, encrypted, tagHex] = data.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

export function hashPhone(phone: string): string {
  return crypto.createHash('sha256').update(phone).digest('hex');
}

/**
 * PREPROTO-AUTH G1 — OTP-at-rest hash. HMAC (keyed) rather than a bare
 * SHA-256 because a 6-digit code has only 10^6 states: an unkeyed hash
 * of a leaked OtpCode table is reversible by enumeration in milliseconds.
 * Keyed by OTP_HMAC_KEY when set, else ENCRYPTION_KEY (both are required
 * to be strong at startup, so this never silently downgrades).
 */
export function hmacOtp(code: string): string {
  const key = config.OTP_HMAC_KEY || config.ENCRYPTION_KEY;
  return crypto.createHmac('sha256', key).update(code).digest('hex');
}
