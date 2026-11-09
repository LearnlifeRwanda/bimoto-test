// DOC-GUARD G2 — the authenticated read path for uploaded documents.
//
// This router, with its sibling legacy-document.routes.ts, replaces
// `app.use('/uploads', express.static('uploads'))` (index.ts:163 on
// e67eb37), which served every driving licence, RURA authorisation,
// insurance certificate and parcel photograph to anyone who could name
// the URL.
//
// Both routers delegate to services/document-serve.service.ts, so the
// authorisation is written once. This one declares the shape new
// uploads are minted in; the legacy router declares the shape existing
// DB rows already hold.

import { Router } from 'express';
import { serveStoredDocument } from '../services/document-serve.service';

const router = Router();

/**
 * @openapi
 * /api/documents/{key}:
 *   get:
 *     summary: Read an uploaded document. Owner, journey participants and admins only; every other caller gets 404.
 *     description: >
 *       Serves driver-verification documents and journey pickup/delivery
 *       photos. Files are encrypted at rest and decrypted only here.
 *       Refusals are indistinguishable from a missing document by
 *       design — the existence of an identity document is itself
 *       information, so an anonymous caller, a stranger and a
 *       non-existent key all receive the same empty 404.
 *     tags: [Uploads]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         description: The server-assigned document id (a UUID).
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: The decrypted document.
 *         content:
 *           application/octet-stream:
 *             schema: { type: string, format: binary }
 *       404:
 *         description: No such document, or the caller is not entitled to it.
 */
router.get('/:key', (req, res, next) => {
  serveStoredDocument(req, res).catch(next);
});

export default router;
