// DOC-GUARD G2 — where uploaded documents live, and how a stored URL is
// turned into a path on disk.
//
// Two shapes exist and both must keep resolving:
//
//   NEW      /api/documents/<uuid>          -> uploads/documents/<uuid>
//   LEGACY   /uploads/verification/<id>/<f> -> uploads/verification/<id>/<f>
//            /uploads/journeys/<id>/<f>     -> uploads/journeys/<id>/<f>
//
// New uploads are given a server-assigned `crypto.randomUUID()` and
// nothing else: the filename carries no document type, no owner, and no
// extension, so a URL that leaks tells the finder nothing about what it
// points at. The old names did the opposite — a verification document
// was literally `<userId>/driving-license.jpg`.
//
// Legacy URLs are served through a COMPATIBILITY READ rather than being
// rewritten in the database. The reason is failure atomicity: a rewrite
// has to move a file and update a row, and a crash between the two
// leaves a row pointing at a file that is no longer there — for
// identity documents that is unrecoverable without a backup. A
// compatibility read has no such window; it is correct at every instant,
// including halfway through the G3 disk sweep. The URL a row holds is
// therefore never edited by this dispatch.
//
// This module is deliberately the ONLY place that maps a URL to a path.
// A storage backend can be swapped underneath it (S3, a volume) without
// the URL contract changing — which is what keeps the pilot's
// serve-from-the-Mac arrangement from becoming permanent.

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

/** Root of every uploaded file, relative to the server's cwd. */
export const UPLOAD_ROOT = 'uploads';

/** Where new, server-named documents are written. */
export const DOCUMENT_DIR = path.join(UPLOAD_ROOT, 'documents');

/** The mount the authenticated route answers new-style URLs on. */
export const DOCUMENT_URL_PREFIX = '/api/documents';

/** The mount legacy URLs were minted under, kept alive for compatibility. */
export const LEGACY_URL_PREFIX = '/uploads';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Legacy path segments were written by the server from a userId /
// journeyId and a multer filename. Anything outside this alphabet did
// not come from us, so it is refused before it can reach the filesystem.
const SAFE_SEGMENT_RE = /^[A-Za-z0-9._-]+$/;

/**
 * Prefix marking a route key that carries a pre-dispatch storage path
 * rather than a uuid. See storedUrlForKey.
 */
const LEGACY_KEY_PREFIX = 'legacy.';

/** A fresh, meaningless document id. */
export function newDocumentKey(): string {
  return crypto.randomUUID();
}

/**
 * The stored URL a route key refers to, or null when the key is not a
 * shape this server accepts.
 *
 * There is ONE document endpoint, `GET /api/documents/:key`, and two
 * kinds of key:
 *
 *   <uuid>          a document stored by this dispatch onwards
 *   legacy.<b64url> a pre-dispatch storage path, encoded
 *
 * The legacy form exists so the compatibility read does not need a
 * second endpoint with a second path shape. That matters beyond tidiness:
 * the client fetches documents with a single template literal
 * (`/api/documents/${ref}`), which is what lets the wiring audit see the
 * route as wired rather than orphaned — a second, differently-shaped
 * route could only ever have been called dynamically and would have had
 * to be silenced with an allowlist entry instead.
 *
 * Encoding, not trust: whatever the key decodes to is matched against
 * the URL columns before anything is read, so a caller cannot name a
 * path no row claims.
 */
export function storedUrlForKey(key: string): string | null {
  if (UUID_RE.test(key)) {
    return `${DOCUMENT_URL_PREFIX}/${key}`;
  }

  if (key.startsWith(LEGACY_KEY_PREFIX)) {
    const encoded = key.slice(LEGACY_KEY_PREFIX.length);
    // Reject anything that is not base64url before decoding, so a
    // malformed key cannot become a surprising string.
    if (!/^[A-Za-z0-9_-]+$/.test(encoded)) return null;
    let decoded: string;
    try {
      decoded = Buffer.from(encoded, 'base64url').toString('utf8');
    } catch {
      return null;
    }
    // Only ever a legacy upload path, and only one this server minted.
    if (!decoded.startsWith(`${LEGACY_URL_PREFIX}/`)) return null;
    return diskPathForStoredUrl(decoded) ? decoded : null;
  }

  return null;
}

/** The URL stored in the DB column for a newly saved document. */
export function documentUrl(key: string): string {
  return `${DOCUMENT_URL_PREFIX}/${key}`;
}

/**
 * Write a document under its server-assigned key. The bytes handed in
 * are written verbatim — G3 encrypts them before they get here, so this
 * function never sees plaintext in the shipped configuration.
 */
export function writeDocument(key: string, data: Buffer): void {
  if (!UUID_RE.test(key)) {
    throw new Error(`writeDocument: refusing a non-uuid key: ${key}`);
  }
  fs.mkdirSync(DOCUMENT_DIR, { recursive: true });
  fs.writeFileSync(path.join(DOCUMENT_DIR, key), data);
}

/**
 * Map a stored URL to the file it names, or null when the URL is not a
 * shape this server ever minted.
 *
 * Path traversal cannot survive this function: every segment is matched
 * against SAFE_SEGMENT_RE, which excludes '/' and cannot spell '..'.
 * (The caller's DB lookup is a second, independent gate — a path only
 * gets here if some row already holds this exact URL.)
 */
export function diskPathForStoredUrl(storedUrl: string): string | null {
  if (storedUrl.startsWith(`${DOCUMENT_URL_PREFIX}/`)) {
    const key = storedUrl.slice(DOCUMENT_URL_PREFIX.length + 1);
    if (!UUID_RE.test(key)) return null;
    return path.join(DOCUMENT_DIR, key);
  }

  if (storedUrl.startsWith(`${LEGACY_URL_PREFIX}/`)) {
    const rest = storedUrl.slice(LEGACY_URL_PREFIX.length + 1);
    const segments = rest.split('/');
    // verification/<userId>/<file> or journeys/<journeyId>/<file>
    if (segments.length !== 3) return null;
    const [kind, owner, filename] = segments;
    if (kind !== 'verification' && kind !== 'journeys') return null;
    if (!SAFE_SEGMENT_RE.test(owner) || !SAFE_SEGMENT_RE.test(filename)) return null;
    return path.join(UPLOAD_ROOT, kind, owner, filename);
  }

  return null;
}

/** Read a document's bytes, or null when the file is gone. */
export function readDocumentFile(absPath: string): Buffer | null {
  try {
    return fs.readFileSync(absPath);
  } catch {
    return null;
  }
}
