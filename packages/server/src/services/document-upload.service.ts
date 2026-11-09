// DOC-GUARD G3 — the one path an uploaded file takes to disk.
//
// Both upload routes (driver verification, journey pickup/delivery
// photos) go through here, so the order of operations is stated once:
//
//   1. sniff the bytes            — what the file IS, not what it claims
//   2. reject anything unlisted   — before a single byte is written
//   3. encrypt                    — plaintext never touches the disk
//   4. write under a fresh uuid   — the name says nothing about the file
//
// Step 3 is why multer buffers in memory: with diskStorage the file
// would be on the filesystem in the clear before any of this ran.

import { AppError } from '../middleware/error-handler';
import { sniffFileType, SniffedType } from '../utils/file-type';
import { encryptDocument } from '../utils/document-crypto';
import { newDocumentKey, documentUrl, writeDocument } from '../utils/document-store';

/**
 * The file's real type, or a 400 if it is not one this caller accepts.
 * A payload whose bytes match nothing we recognise is refused for the
 * same reason as one whose bytes match the wrong thing.
 */
export function assertSniffedType(
  buf: Buffer,
  allowed: SniffedType[],
): SniffedType {
  const actual = sniffFileType(buf);
  if (!actual || !allowed.includes(actual)) {
    throw new AppError(
      400,
      'UNSUPPORTED_FILE_TYPE',
      'errors.unsupportedFileType',
      { allowed },
    );
  }
  return actual;
}

/**
 * Encrypt and store, returning the URL to record in the DB column.
 * The returned URL is the document's only address.
 */
export function storeUploadedDocument(buf: Buffer): string {
  const key = newDocumentKey();
  writeDocument(key, encryptDocument(buf));
  return documentUrl(key);
}
