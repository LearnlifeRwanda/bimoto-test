// ROUTES/MAP.ROUTES.TS
//
// MAP-CACHE G1 — serves the offline Kigali map extract (a single-file
// PMTiles archive) from OUR server. Bulk-downloading raster tiles from
// openstreetmap.org would violate the OSM tile usage policy; the
// compliant design is this self-hosted vector extract, downloaded once
// by the client (opt-in, ~30–50 MB) and rendered locally.
//
// MAP-TRUTH G3 — the file is found by resolveMapExtract(), which checks
// MAP_PMTILES_PATH first and then the known location data/kigali.pmtiles.
// Before that default rung existed this route answered 404 on every
// server in the world, because the env was empty everywhere and the
// updater is forbidden from writing it. When neither rung answers, the
// route still returns a clean 404 MAP_NOT_AVAILABLE — the client treats
// that as "feature dormant" and stays on online tiles, so a server
// without the bundle remains fully correct.
//
// Range requests are supported because pmtiles clients read archives by
// byte range; the app's own download manager streams the whole file.
//
// MAP-TRUTH G4 — and RESUMES it. A 30 MB download over Kigali mobile
// data does not always finish first go, so the route serves a strong
// validator (ETag from size + mtime) and honours If-Range: the client
// asks for `bytes=<already-have>-` with the ETag it started from, and
// gets 206 to append when the archive is unchanged, or a plain 200 with
// the whole file when it is not. Without If-Range a resume against a
// swapped bundle would silently splice two different archives together
// and produce a corrupt file that still looks the right size.

// MAP-RWANDA G2 — and it stops being about Kigali.
//
// The route no longer knows any region by name. It takes a region key,
// checks it against a strict pattern AND against the list of archives
// this server actually has, and streams whatever it finds with exactly
// the semantics above: auth, honest 404, etag, Range, If-Range resume.
// GET /api/map/regions says which keys exist and how big they are, read
// from the filesystem, so a new province appears to every user the
// moment one file lands in data/ — no redeploy, no configuration.
//
// /kigali.pmtiles is registered explicitly and UNCHANGED. It resolves
// through the same resolveMapExtract() it always did, so an APK in the
// field keeps working byte for byte; the generic route simply cannot
// reach it first.

import { Router } from 'express';
import type { Request, Response } from 'express';
import { createReadStream } from 'fs';
import { authMiddleware } from '../middleware/auth';
import {
  listMapRegions,
  resolveMapRegion,
  type ResolvedMapExtract,
} from '../services/map-extract';

const router = Router();

/** Parse a single-range `Range: bytes=a-b` header against a file size.
 * Returns null for anything unusable (multi-range, malformed, or a
 * start beyond EOF — the caller answers 416). */
export function parseByteRange(
  header: string,
  size: number,
): { start: number; end: number } | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const [, startStr, endStr] = m;
  if (startStr === '' && endStr === '') return null;
  if (startStr === '') {
    // Suffix form `bytes=-n`: the last n bytes.
    const suffix = Number(endStr);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(startStr);
  const end = endStr === '' ? size - 1 : Math.min(Number(endStr), size - 1);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start >= size || start > end) return null;
  return { start, end };
}

/**
 * Stream one resolved archive with the full Range/If-Range contract.
 *
 * Extracted verbatim from the Kigali handler so that every region gets
 * the SAME semantics rather than a second implementation that drifts:
 * one place decides what a 206 looks like, one place decides when a
 * paused download may be appended to.
 */
function streamExtract(
  req: Request,
  res: Response,
  extract: ResolvedMapExtract,
): void {
  const { path, size, etag, lastModified } = extract;

  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', 'application/octet-stream');
  // The archive only changes with an update bundle; a day of client-side
  // HTTP caching keeps repeat header reads cheap without pinning stale
  // extracts for long.
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.setHeader('ETag', etag);
  res.setHeader('Last-Modified', lastModified);

  // If-Range: honour the Range only when the client's validator still
  // matches. A mismatch means the archive changed under a paused
  // download, so we ignore the Range and send the whole new file — the
  // client throws its partial away rather than splicing two archives.
  const ifRange = req.headers['if-range'];
  const validatorStale = typeof ifRange === 'string' && ifRange.trim() !== etag;

  const rangeHeader = validatorStale ? undefined : req.headers.range;
  let start = 0;
  let end = size - 1;
  if (typeof rangeHeader === 'string' && rangeHeader.length > 0) {
    const range = parseByteRange(rangeHeader, size);
    if (!range) {
      res.status(416).setHeader('Content-Range', `bytes */${size}`);
      res.end();
      return;
    }
    ({ start, end } = range);
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
  }
  res.setHeader('Content-Length', String(end - start + 1));

  const stream = createReadStream(path, { start, end });
  stream.on('error', () => {
    // File vanished mid-stream (bundle swap) — end the response; the
    // client's download manager treats a short read as a failed download
    // and simply offers restart.
    res.destroy();
  });
  stream.pipe(res);
}

function notAvailable(res: Response): void {
  res.status(404).json({
    error: { code: 'MAP_NOT_AVAILABLE', message: 'errors.mapNotAvailable' },
  });
}

/**
 * @openapi
 * /api/map/regions:
 *   get:
 *     summary: The offline map regions this server has provisioned.
 *     description: >
 *       Derived from the filesystem, never from a hardcoded list: every
 *       .pmtiles archive in the resolved data directory is a region, and
 *       its size is read from the file. Dropping an archive on the server
 *       makes it available to every client with no redeploy.
 *     tags: [Map]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: The provisioned regions (possibly none).
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 regions:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       key: { type: string, example: north }
 *                       nameKey: { type: string, example: map.regions.north }
 *                       sizeBytes: { type: integer, example: 12582912 }
 *                       lastModified: { type: string }
 *                       etag: { type: string }
 */
router.get('/regions', authMiddleware, async (_req, res) => {
  // An empty list is a correct answer, not an error: a server without
  // the ops bundle simply has no regions, and the client shows its rows
  // as "not available yet" rather than an error screen.
  res.json({ regions: await listMapRegions() });
});

/**
 * @openapi
 * /api/map/kigali.pmtiles:
 *   get:
 *     summary: Offline Kigali map extract (PMTiles archive, range-capable).
 *     description: >
 *       Kept as its own registration, resolving exactly as it always did,
 *       because installed apps in the field ask for this path by name.
 *     tags: [Map]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: The full archive (no Range header sent).
 *         content:
 *           application/octet-stream: {}
 *       206:
 *         description: The requested byte range of the archive.
 *         content:
 *           application/octet-stream: {}
 *       404:
 *         description: No extract provisioned on this server (neither MAP_PMTILES_PATH nor data/kigali.pmtiles resolves to a file).
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       416:
 *         description: Range not satisfiable.
 */
router.get('/kigali.pmtiles', authMiddleware, async (req, res) => {
  const extract = await resolveMapRegion('kigali');
  if (!extract) {
    notAvailable(res);
    return;
  }
  streamExtract(req, res, extract);
});

/**
 * @openapi
 * /api/map/{region}.pmtiles:
 *   get:
 *     summary: Offline map extract for one region (PMTiles archive, range-capable).
 *     description: >
 *       Same semantics as the Kigali route for every provisioned region.
 *       The region must match ^[a-z]+(-[a-z]+)*$ and must appear in
 *       GET /api/map/regions; anything else is a 404, so no request can
 *       name a path this server did not itself enumerate.
 *     tags: [Map]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: region
 *         required: true
 *         schema: { type: string, pattern: '^[a-z]+(-[a-z]+)*$' }
 *         example: north
 *     responses:
 *       200:
 *         description: The full archive (no Range header sent).
 *         content:
 *           application/octet-stream: {}
 *       206:
 *         description: The requested byte range of the archive.
 *         content:
 *           application/octet-stream: {}
 *       404:
 *         description: No such region provisioned on this server.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       416:
 *         description: Range not satisfiable.
 */
router.get('/:region.pmtiles', authMiddleware, async (req, res) => {
  // req.params.region arrives URL-DECODED: a request for
  // /api/map/..%2f..%2fetc%2fpasswd.pmtiles lands here as
  // '../../etc/passwd'. resolveMapRegion refuses it on the pattern, long
  // before any path is built — and would refuse it again on the listing.
  const extract = await resolveMapRegion(String(req.params.region ?? ''));
  if (!extract) {
    notAvailable(res);
    return;
  }
  streamExtract(req, res, extract);
});

export default router;
