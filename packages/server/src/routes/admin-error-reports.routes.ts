// BLACKBOX G4 / FLIGHT-RECORDER G4 — the team's read-out for error reports.
//
//   GET /                    the list: who sent it, when, which build,
//                            how many entries.
//   GET /groups              the same reports counted by fingerprint,
//                            split by build and role, newest first.
//   GET /:id/export.json     one bundle, whole, as JSON.
//   GET /export.jsonl        every bundle, one JSON object per line.
//
// BLACKBOX shipped the first and third of those and said so in writing:
// "no alerting, no aggregation and no dashboard here on purpose… a
// grouping heuristic would decide for them which crashes matter, and it
// is far too early for the pilot to have that opinion."
//
// That was right while reports arrived one tap at a time. It stops being
// right the moment they arrive by themselves (FLIGHT-RECORDER G2): forty
// phones hitting the same fault now produce forty rows, and a list of
// forty identical-looking rows hides the one thing worth knowing, which
// is that they are identical. So the grouping is added — and it is NOT a
// heuristic. It counts an exact key computed from the entries
// themselves, and reports too old to have one are shown as
// "unfingerprinted" rather than guessed at.
//
// The JSONL firehose is the other half: humans read the groups, machines
// read the stream. One object per line, so a laptop with grep and jq is
// a sufficient analysis stack and nobody has to wait for a dashboard.
//
// Auth: authMiddleware → adminOnly on every route.

import { Router, Request, Response, NextFunction } from 'express';
import { UserRole } from '@prisma/client';
import { authMiddleware, adminOnly } from '../middleware/auth';
import { AppError } from '../middleware/error-handler';
import prisma from '../prisma';

const router = Router();
router.use(authMiddleware);
router.use(adminOnly);

/** One page of the list. Bundles are small but numerous in a bad week. */
const LIST_LIMIT = 50;

/** How many groups the grouped read-out returns. A screen that shows
 *  more than this is a screen nobody reads to the bottom of. */
const GROUP_LIMIT = 50;

/** Hard ceiling on one export stream. Generous — the whole pilot's
 *  reports fit far inside it — and it exists so a forgotten `since`
 *  cannot turn one request into an unbounded table scan. */
export const EXPORT_MAX_ROWS = 5_000;

/** Rows fetched per round trip while streaming. Small enough that the
 *  server never holds the whole export in memory, large enough that a
 *  few thousand rows is a handful of queries. */
const EXPORT_PAGE_SIZE = 200;

/** The label a report stored before the fingerprint column gets. Not a
 *  guess and not an error — an honest name for "we cannot say". */
export const UNFINGERPRINTED = 'unfingerprinted';

/** Shared filter parsing for the grouped view and the export stream, so
 *  the numbers on the screen and the lines in the file can never be
 *  answering two different questions. */
export interface ReportFilters {
  since?: Date;
  build?: string;
  role?: UserRole;
  fingerprint?: string;
}

export function parseFilters(query: Record<string, unknown>): ReportFilters {
  const filters: ReportFilters = {};

  const since = typeof query.since === 'string' ? new Date(query.since) : null;
  if (since && !Number.isNaN(since.getTime())) filters.since = since;

  if (typeof query.build === 'string' && query.build) filters.build = query.build.slice(0, 64);

  if (typeof query.role === 'string' && query.role in UserRole) {
    filters.role = query.role as UserRole;
  }

  if (typeof query.fingerprint === 'string' && query.fingerprint) {
    // The 'unfingerprinted' bucket is a real filter: it selects exactly
    // the reports stored before the column existed.
    filters.fingerprint = query.fingerprint.slice(0, 64);
  }

  return filters;
}

function whereFrom(filters: ReportFilters) {
  return {
    ...(filters.since ? { createdAt: { gte: filters.since } } : {}),
    ...(filters.build ? { appBuild: filters.build } : {}),
    ...(filters.role ? { reporterRole: filters.role } : {}),
    ...(filters.fingerprint
      ? { fingerprint: filters.fingerprint === UNFINGERPRINTED ? null : filters.fingerprint }
      : {}),
  };
}

/**
 * @openapi
 * /api/admin/error-reports:
 *   get:
 *     summary: User-sent error-report bundles, newest first (who, when, build, entry count).
 *     tags: [Admin]
 *     security:
 *       - requireAdmin: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 50 }
 *         description: Rows to return. Defaults to 50.
 *     responses:
 *       200:
 *         description: The list. Entry payloads are NOT included — use the export route.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 reports:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:           { type: string, format: uuid }
 *                       createdAt:    { type: string, format: date-time }
 *                       appBuild:     { type: string }
 *                       reporterRole: { type: string }
 *                       entryCount:   { type: integer }
 *                       fingerprint:  { type: string, nullable: true }
 *                       reporter:
 *                         type: object
 *                         properties:
 *                           id:       { type: string, format: uuid }
 *                           nickname: { type: string }
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const requested = Number(req.query.limit);
    const limit =
      Number.isFinite(requested) && requested > 0 ? Math.min(Math.trunc(requested), LIST_LIMIT) : LIST_LIMIT;
    const rows = await prisma.errorReport.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        createdAt: true,
        appBuild: true,
        reporterRole: true,
        entryCount: true,
        fingerprint: true,
        // Nickname, not phone: the list is for choosing which bundle to
        // open, and a phone number is not needed to do that.
        user: { select: { id: true, nickname: true } },
      },
    });
    res.json({
      reports: rows.map(({ user, ...row }) => ({ ...row, reporter: user })),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/admin/error-reports/groups:
 *   get:
 *     summary: Error reports counted by fingerprint, split by build and role.
 *     description: >-
 *       An exact count of a key computed from the entries themselves, not
 *       a similarity heuristic. Reports stored before the fingerprint
 *       column are counted together under 'unfingerprinted'.
 *     tags: [Admin]
 *     security:
 *       - requireAdmin: []
 *     parameters:
 *       - in: query
 *         name: since
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: build
 *         schema: { type: string }
 *       - in: query
 *         name: role
 *         schema: { type: string }
 *       - in: query
 *         name: fingerprint
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Groups, largest first.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 groups:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       fingerprint: { type: string }
 *                       reports:     { type: integer }
 *                       entries:     { type: integer }
 *                       lastSeen:    { type: string, format: date-time }
 *                       sample:      { type: string, description: the newest entry's message }
 *                       builds:
 *                         type: array
 *                         items:
 *                           type: object
 *                           properties:
 *                             build: { type: string }
 *                             count: { type: integer }
 *                       roles:
 *                         type: array
 *                         items:
 *                           type: object
 *                           properties:
 *                             role:  { type: string }
 *                             count: { type: integer }
 */
router.get('/groups', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const filters = parseFilters(req.query as Record<string, unknown>);
    const where = whereFrom(filters);

    // Grouped in the database on the indexed column, then split by build
    // and role in one more pass. Two queries, not one per group.
    const [byFingerprint, byBuildAndRole] = await Promise.all([
      prisma.errorReport.groupBy({
        by: ['fingerprint'],
        where,
        _count: { _all: true },
        _sum: { entryCount: true },
        _max: { createdAt: true },
        orderBy: { _count: { fingerprint: 'desc' } },
        take: GROUP_LIMIT,
      }),
      prisma.errorReport.groupBy({
        by: ['fingerprint', 'appBuild', 'reporterRole'],
        where,
        _count: { _all: true },
      }),
    ]);

    const key = (fp: string | null) => fp ?? UNFINGERPRINTED;

    // One sample message per group, from the newest report in it: the
    // fingerprint is what the team filters on, but it is the message a
    // person actually recognises.
    const newest = await prisma.errorReport.findMany({
      where: {
        ...where,
        fingerprint: { in: byFingerprint.map((g) => g.fingerprint).filter((f): f is string => !!f) },
      },
      orderBy: { createdAt: 'desc' },
      select: { fingerprint: true, entries: true },
      take: GROUP_LIMIT * 4,
    });
    const samples = new Map<string, string>();
    for (const row of newest) {
      const k = key(row.fingerprint);
      if (samples.has(k)) continue;
      const first = Array.isArray(row.entries) ? (row.entries[0] as Record<string, unknown>) : null;
      if (first && typeof first.message === 'string') samples.set(k, first.message);
    }

    const groups = byFingerprint.map((group) => {
      const k = key(group.fingerprint);
      const slices = byBuildAndRole.filter((s) => key(s.fingerprint) === k);
      const tally = <T extends string>(
        pick: (s: (typeof slices)[number]) => T,
      ): Array<{ value: T; count: number }> => {
        const counts = new Map<T, number>();
        for (const s of slices) counts.set(pick(s), (counts.get(pick(s)) ?? 0) + s._count._all);
        return [...counts.entries()]
          .map(([value, count]) => ({ value, count }))
          .sort((a, b) => b.count - a.count);
      };
      return {
        fingerprint: k,
        reports: group._count._all,
        entries: group._sum.entryCount ?? 0,
        lastSeen: group._max.createdAt,
        sample: samples.get(k) ?? null,
        builds: tally((s) => s.appBuild).map(({ value, count }) => ({ build: value, count })),
        roles: tally((s) => String(s.reporterRole)).map(({ value, count }) => ({
          role: value,
          count,
        })),
      };
    });

    res.json({ groups });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/admin/error-reports/export.jsonl:
 *   get:
 *     summary: Every error report, one JSON object per line.
 *     description: >-
 *       The machine-readable half of this surface. Streamed rather than
 *       assembled, so the server never holds the whole export in memory
 *       and a laptop with grep and jq is a sufficient analysis stack.
 *     tags: [Admin]
 *     security:
 *       - requireAdmin: []
 *     parameters:
 *       - in: query
 *         name: since
 *         schema: { type: string, format: date-time }
 *         description: Only reports created at or after this instant.
 *       - in: query
 *         name: build
 *         schema: { type: string }
 *       - in: query
 *         name: role
 *         schema: { type: string }
 *       - in: query
 *         name: fingerprint
 *         schema: { type: string }
 *         description: A fingerprint, or 'unfingerprinted' for reports that predate the column.
 *     responses:
 *       200:
 *         description: application/x-ndjson — one report per line, newest first.
 */
router.get('/export.jsonl', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const filters = parseFilters(req.query as Record<string, unknown>);
    const where = whereFrom(filters);

    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="error-reports.jsonl"');

    let written = 0;
    let cursor: string | undefined;
    // Keyset pagination on (createdAt desc, id) via Prisma's cursor, so
    // a long export cannot be knocked sideways by a report arriving
    // mid-stream the way an OFFSET walk would be.
    for (;;) {
      const page = await prisma.errorReport.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: Math.min(EXPORT_PAGE_SIZE, EXPORT_MAX_ROWS - written),
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          createdAt: true,
          appBuild: true,
          reporterRole: true,
          entryCount: true,
          fingerprint: true,
          entries: true,
          user: { select: { id: true, nickname: true } },
        },
      });
      if (page.length === 0) break;

      for (const { user, ...row } of page) {
        // One object, one line. A newline inside a message is escaped by
        // JSON.stringify, so a line break in the file is always a record
        // break — which is the only promise JSONL makes.
        res.write(`${JSON.stringify({ ...row, fingerprint: row.fingerprint ?? UNFINGERPRINTED, reporter: user })}\n`);
      }
      written += page.length;
      cursor = page[page.length - 1].id;
      if (page.length < EXPORT_PAGE_SIZE || written >= EXPORT_MAX_ROWS) break;
    }

    // A truncated export that does not say so reads as a complete one.
    if (written >= EXPORT_MAX_ROWS) {
      res.write(`${JSON.stringify({ truncated: true, rows: written, limit: EXPORT_MAX_ROWS })}\n`);
    }
    res.end();
  } catch (err) {
    // Headers may already be out; express's handler falls back to
    // destroying the response, which is the honest end for a stream.
    next(err);
  }
});

/**
 * @openapi
 * /api/admin/error-reports/{id}/export.json:
 *   get:
 *     summary: One bundle, whole, as JSON — the thing the team forwards.
 *     tags: [Admin]
 *     security:
 *       - requireAdmin: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: The bundle, with its entries.
 *       404: { description: no such report }
 */
router.get('/:id/export.json', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const report = await prisma.errorReport.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        createdAt: true,
        appBuild: true,
        reporterRole: true,
        entryCount: true,
        fingerprint: true,
        entries: true,
        user: { select: { id: true, nickname: true } },
      },
    });
    if (!report) throw new AppError(404, 'NOT_FOUND', 'errors.notFound');
    const { user, ...rest } = report;
    // Content-Disposition so a tap in the admin page produces a file the
    // team can attach to a message, which is the whole workflow.
    res.setHeader('Content-Disposition', `attachment; filename="error-report-${report.id}.json"`);
    res.json({ ...rest, reporter: user });
  } catch (err) {
    // A malformed uuid reaches Prisma as a query error; the honest
    // answer to "show me report <nonsense>" is 404, not 500.
    if ((err as { code?: string })?.code === 'P2023') {
      next(new AppError(404, 'NOT_FOUND', 'errors.notFound'));
      return;
    }
    next(err);
  }
});

export default router;
