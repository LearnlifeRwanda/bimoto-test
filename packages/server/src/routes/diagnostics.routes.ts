// BLACKBOX G4 — where a user-sent error report lands.
//
//   POST /error-report   store one ledger bundle from one phone
//
// This is the ONLY inbound path for the client error ledger. It is
// reached two ways, and neither is a surprise to the person sending:
// a tap on Send report on the Diagnostics screen, and the consented
// background uploader FLIGHT-RECORDER G2 added
// (packages/client/src/services/diagnostics-upload.ts) — stated at
// signup, switchable off in Settings, and posting the same bytes the
// Diagnostics screen shows. Both use one serializer, so there is still
// exactly one payload shape arriving here.
//
// A batch IS a bundle: `entries` was always an array, so the uploader
// needed no new endpoint and no /batch sibling, and an old APK's
// single-report POST keeps working unchanged.
//
// The bundle arrives already redacted. The device strips bearer tokens,
// JWTs and key=value secrets, masks phone shapes and drops query strings
// BEFORE the entry is persisted locally (services/error-ledger.ts), so
// what is stored here is what a stolen phone would have shown anyway.
// This route does not attempt a second redaction pass — a server-side
// filter would suggest the device's promise needed backing up, and it
// does not.
//
// What this route DOES enforce is size and shape: the payload is capped,
// the entry count is capped, every entry is reduced to the known fields
// (an unknown key is dropped, not stored), and strings are re-truncated.
// A client is not trusted to be well-behaved just because ours is.
//
// Auth: authMiddleware on the router — a report belongs to a person, and
// the admin read-out shows who sent it. Rate-limited per user.

import { Router, Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { errorFingerprint } from '@bimoto/shared';
import { authMiddleware } from '../middleware/auth';
import { rateLimit } from '../middleware/rate-limit';
import { AppError } from '../middleware/error-handler';
import prisma from '../prisma';

const router = Router();
router.use(authMiddleware);

/** Hard ceiling on one bundle, in bytes of JSON. The device's own ring
 *  is capped at 64 KiB (MAX_TOTAL_BYTES), so this is that plus room for
 *  the envelope — generous for an honest client, useless to a hostile
 *  one. */
export const MAX_REPORT_BYTES = 96 * 1024;
/** Mirrors the device's MAX_ENTRIES. */
export const MAX_REPORT_ENTRIES = 50;
const MAX_MESSAGE_CHARS = 300;
const MAX_STACK_CHARS = 1000;
const MAX_SHORT_FIELD_CHARS = 200;
/** Ceiling on a client's collapsed-duplicate count. The device ring holds
 *  50 entries, so anything past that is a claim, not an observation. */
const MAX_DUP = 10_000;

// 5 reports per hour per user. A person who is genuinely hitting bugs
// sends one, maybe twice; five leaves room for a bad afternoon in Kigali
// and still caps a stuck client at 120 rows a day. Keyed on the user id
// rather than the IP so a shared NAT does not make one tester spend
// everyone's budget.
const reportRateLimit = rateLimit(5, 60 * 60_000, 'diagnostics-report', (req: Request) => req.user?.userId);

type RawEntry = Record<string, unknown>;

function str(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string' || value === '') return undefined;
  return value.length > max ? value.slice(0, max) : value;
}

function int(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : undefined;
}

/**
 * Rebuild an entry from the known fields only. Anything the client
 * invented — a body, a header, a user object — is not filtered out, it
 * simply never gets copied across.
 */
function sanitiseEntry(raw: RawEntry): Record<string, unknown> | null {
  const t = int(raw.t);
  const kind = str(raw.kind, 40);
  const message = str(raw.message, MAX_MESSAGE_CHARS);
  if (t === undefined || !kind || !message) return null;
  const entry: Record<string, unknown> = {
    t,
    kind,
    message,
    build: str(raw.build, 64) ?? 'unknown',
    route: str(raw.route, MAX_SHORT_FIELD_CHARS) ?? '',
  };
  const stack = str(raw.stack, MAX_STACK_CHARS);
  if (stack) entry.stack = stack;
  const status = int(raw.status);
  if (status !== undefined) entry.status = status;
  const method = str(raw.method, 8);
  if (method) entry.method = method;
  const path = str(raw.path, MAX_SHORT_FIELD_CHARS);
  if (path) entry.path = path;
  // FLIGHT-RECORDER G4 — the grouping key, computed HERE from the fields
  // that survived the rebuild above. A `fp` the client sent is one more
  // thing a client invented and is not copied across; a deployed APK
  // sends none at all, and recomputing is what puts old bundles and new
  // ones in the same grouping.
  entry.fp = errorFingerprint({ kind, message, stack: stack ?? undefined });
  // The client's own duplicate count is a claim about entries it already
  // collapsed, not a field it can use to lie about anything: kept as a
  // bounded integer so a row that stands for forty says forty.
  const dup = int(raw.dup);
  if (dup !== undefined && dup > 1) entry.dup = Math.min(dup, MAX_DUP);
  return entry;
}

/**
 * @openapi
 * /api/diagnostics/error-report:
 *   post:
 *     summary: Store an error-ledger bundle from one phone.
 *     description: >-
 *       Reached by an explicit tap on Send report and by the consented
 *       background uploader (default on for the pilot, switchable off in
 *       Settings). Entries arrive already redacted by the device; the
 *       server computes each entry's fingerprint itself rather than
 *       trusting one that was sent.
 *     tags: [Diagnostics]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [entries]
 *             properties:
 *               entries:
 *                 type: array
 *                 maxItems: 50
 *                 items:
 *                   type: object
 *                   properties:
 *                     t:       { type: integer, description: ms since epoch }
 *                     kind:    { type: string }
 *                     message: { type: string }
 *                     stack:   { type: string }
 *                     build:   { type: string }
 *                     route:   { type: string }
 *                     status:  { type: integer }
 *                     method:  { type: string }
 *                     path:    { type: string }
 *                     dup:     { type: integer, description: identical entries this row stands for }
 *     responses:
 *       201:
 *         description: Bundle stored.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:         { type: string, format: uuid }
 *                 entryCount: { type: integer }
 *       400: { description: entries missing, empty, or unusable }
 *       413: { description: payload or entry count over the cap }
 *       429: { description: rate limit (5 per hour per user) }
 */
router.post(
  '/error-report',
  reportRateLimit,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.userId;
      if (!userId) throw new AppError(401, 'UNAUTHORIZED', 'errors.unauthorized');

      const body = req.body as { entries?: unknown } | undefined;
      const rawEntries = body?.entries;
      if (!Array.isArray(rawEntries) || rawEntries.length === 0) {
        throw new AppError(400, 'NO_ENTRIES', 'errors.validation');
      }
      if (rawEntries.length > MAX_REPORT_ENTRIES) {
        throw new AppError(413, 'REPORT_TOO_LARGE', 'errors.validation');
      }
      if (Buffer.byteLength(JSON.stringify(rawEntries), 'utf8') > MAX_REPORT_BYTES) {
        throw new AppError(413, 'REPORT_TOO_LARGE', 'errors.validation');
      }

      const entries = rawEntries
        .filter((e): e is RawEntry => !!e && typeof e === 'object' && !Array.isArray(e))
        .map(sanitiseEntry)
        .filter((e): e is Record<string, unknown> => e !== null);
      if (entries.length === 0) throw new AppError(400, 'NO_ENTRIES', 'errors.validation');

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { role: true },
      });
      if (!user) throw new AppError(401, 'UNAUTHORIZED', 'errors.unauthorized');

      // The build the phone reported, taken from the entries themselves
      // rather than a separate field a client could disagree with.
      const appBuild = (entries[entries.length - 1].build as string) || 'unknown';

      // FLIGHT-RECORDER G4 — the bundle's own fingerprint is its FIRST
      // entry's. The client sends newest-first (readErrorLedger's order),
      // so that is the fault closest to whatever the user noticed, and it
      // is the one a grouped read-out should count the bundle under.
      const fingerprint = (entries[0].fp as string) ?? null;

      const report = await prisma.errorReport.create({
        data: {
          userId,
          reporterRole: user.role,
          appBuild,
          entryCount: entries.length,
          entries: entries as Prisma.InputJsonValue,
          fingerprint,
        },
        select: { id: true, entryCount: true },
      });

      res.status(201).json(report);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
