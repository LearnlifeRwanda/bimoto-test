// DOC-GUARD G2 — deleting a document by its stored URL.
//
// Account deletion (DELETE /api/users/me) has always hard-deleted a
// driver's verification files, and docs/data-retention.md records that
// promise. It did it by removing the directory the old naming scheme
// implied: `uploads/verification/<userId>`.
//
// Documents no longer live in a per-user directory — they are opaque
// uuids in a flat one — so that `rmSync` would silently stop deleting
// anything, and a deleted account would leave its licence on the disk.
// Deletion now follows the URL columns instead, which is the same
// mapping the read path authorises against.
//
// The legacy directory removal is KEPT alongside it: a pilot machine
// still holds pre-dispatch files at the old paths, and those rows still
// hold the old URLs.

import fs from 'fs';
import path from 'path';
import { UPLOAD_ROOT, diskPathForStoredUrl } from '../utils/document-store';

/**
 * Delete the files behind these stored URLs. Unknown or already-missing
 * files are skipped silently — deletion is idempotent, and a URL whose
 * file has already gone is the desired end state.
 */
export function deleteDocumentsForUrls(urls: (string | null | undefined)[]): number {
  let deleted = 0;
  for (const url of urls) {
    if (!url) continue;
    const diskPath = diskPathForStoredUrl(url);
    if (!diskPath) continue;
    try {
      fs.rmSync(diskPath, { force: true });
      deleted += 1;
    } catch {
      // A file we cannot remove must not abort the rest of the erasure.
    }
  }
  return deleted;
}

/** The pre-dispatch per-user verification directory, if it still exists. */
export function deleteLegacyVerificationDir(userId: string): void {
  const dir = path.join(UPLOAD_ROOT, 'verification', userId);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
