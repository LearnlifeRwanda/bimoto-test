// DOC-GUARD G2 — the read path.
//
// One endpoint, `GET /api/documents/:key`, serving both a document
// stored by this dispatch (key = uuid) and one stored before it
// (key = legacy.<encoded storage path>). See storedUrlForKey.
//
// EVERY refusal is 404 with an empty body: an anonymous prober, a
// logged-in stranger, a driver asking for another driver's licence, a
// key nobody owns and a row whose file has gone all get the same
// answer. A 403 would confirm that the document exists, and for
// identity documents that is itself the leak — "there is a driving
// licence at this URL, you just may not have it" tells an attacker
// which userIds are drivers.

import { Request, Response } from 'express';
import { resolveAuth } from '../middleware/auth';
import { resolveDocumentGrant, isEntitled } from './document-access.service';
import {
  diskPathForStoredUrl,
  readDocumentFile,
  storedUrlForKey,
} from '../utils/document-store';
import { decryptDocument } from '../utils/document-crypto';
import { sniffFileType } from '../utils/file-type';

export async function serveStoredDocument(
  req: Request,
  res: Response,
): Promise<void> {
  // The exact string held in the DB column. Decoded from the key, never
  // trusted: the grant lookup below is an equality match against the
  // columns, so a path no row claims resolves to nothing.
  const storedUrl = storedUrlForKey(req.params.key ?? '');
  if (!storedUrl) {
    res.status(404).end();
    return;
  }

  const auth = await resolveAuth(req);
  if (!auth.ok) {
    res.status(404).end();
    return;
  }

  const grant = await resolveDocumentGrant(storedUrl);
  if (!grant || !isEntitled(grant, auth.payload)) {
    res.status(404).end();
    return;
  }

  const diskPath = diskPathForStoredUrl(storedUrl);
  if (!diskPath) {
    res.status(404).end();
    return;
  }

  const raw = readDocumentFile(diskPath);
  if (!raw) {
    // The row survived its file (an old account-deletion sweep, a
    // restore that missed the directory). Nothing to serve.
    res.status(404).end();
    return;
  }

  // Handles both an encrypted envelope and a plaintext-era file, so the
  // route is correct before, during and after the G3 disk sweep.
  const bytes = decryptDocument(raw);
  if (!bytes) {
    // An envelope that does not authenticate — corrupted or tampered.
    // Better to serve nothing than bytes we cannot vouch for.
    res.status(404).end();
    return;
  }

  // New keys carry no extension, so the type comes from the bytes — the
  // same sniffing the upload validated with, not a stored claim.
  const contentType = sniffFileType(bytes) ?? 'application/octet-stream';

  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', String(bytes.length));
  // Never cached by a proxy, never written to a shared disk cache.
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // inline so the admin review surface can display it; the filename is
  // the opaque key, which carries no personal data.
  res.setHeader('Content-Disposition', 'inline');
  res.status(200).end(bytes);
}
