// ROUTES/INTEL.ROUTES.TS
//
// INTEL-DECK G5 — the way out of the reading room.
//
// One endpoint: a streaming export of exactly what the screen is
// showing, in CSV for the spreadsheet the City will actually open and
// JSONL for whoever would rather have grep. It takes the dashboard's own
// filter parameters, so "Export this view" means this view and not
// something adjacent to it.
//
// IMPORT-GRAPH DISCIPLINE — this is the part that matters.
//
// This module imports the mobility store's types, the tier config, the
// suppression gate and prisma, and NOTHING ELSE from the data layer. It
// touches one table, MobilityAggregate, which has no foreign key back to
// any operational row (see services/mobility/store.ts's header). There
// is no path from here to User, Journey, Bid, Payment or Document — not
// through a service, not through a helper, not through a join. A test
// (__tests__/intel-export-import-graph.test.ts) walks this file's import
// closure and fails if that ever stops being true, because "the analyst
// cannot reach a person" has to be a property of the code rather than a
// promise in a comment.
//
// Streaming: rows are paged out of the database and written to the
// response as they arrive, so a month of Kigali does not have to fit in
// one array before the first byte moves.

import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware, intelRead } from '../middleware/auth';
import { AppError } from '../middleware/error-handler';
import prisma from '../prisma';
import { MOBILITY_RUN_NOW_MAX_RANGE_DAYS } from '../services/mobility/config';
import { sanitizeAttributes } from '../services/mobility/attribute-suppression';
import type { Tier, AggregateTypeName, AttributeSet } from '../services/mobility/types';
import { MS_PER_DAY } from '@bimoto/shared';

const router = Router();
router.use(authMiddleware);
router.use(intelRead);

const ALL_TIERS: Tier[] = ['DENSE', 'MEDIUM', 'LOW', 'SPARSE'];
const ALL_AGGREGATE_TYPES: AggregateTypeName[] = ['POINT_DENSITY', 'OD_MATRIX'];
const PAGE_SIZE = 500;

type Format = 'csv' | 'jsonl';

interface ExportRow {
  tier: string;
  aggregateType: string;
  cellId: string;
  cellCenterLat: number;
  cellCenterLng: number;
  bucketStart: Date;
  bucketEnd: Date;
  count: number;
  attributesJson: unknown;
}

function parseFormat(raw: unknown): Format {
  if (raw === undefined || raw === null || raw === '') return 'csv';
  if (raw !== 'csv' && raw !== 'jsonl') {
    throw new AppError(400, 'INVALID_FORMAT', 'errors.invalidFormat');
  }
  return raw;
}

function parseTier(raw: unknown): Tier {
  if (typeof raw !== 'string' || !ALL_TIERS.includes(raw as Tier)) {
    throw new AppError(400, 'INVALID_TIER', 'errors.invalidTier');
  }
  return raw as Tier;
}

function parseAggregateType(raw: unknown): AggregateTypeName {
  if (raw === undefined || raw === null || raw === '') return 'POINT_DENSITY';
  if (typeof raw !== 'string' || !ALL_AGGREGATE_TYPES.includes(raw as AggregateTypeName)) {
    throw new AppError(400, 'INVALID_AGGREGATE_TYPE', 'errors.invalidAggregateType');
  }
  return raw as AggregateTypeName;
}

function parseDate(raw: unknown, field: string): Date {
  if (typeof raw !== 'string') {
    throw new AppError(400, 'INVALID_DATE', `errors.invalidDate.${field}`);
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    throw new AppError(400, 'INVALID_DATE', `errors.invalidDate.${field}`);
  }
  return d;
}

function parseRange(req: Request): { from: Date; to: Date } {
  const from = parseDate(req.query.dateFrom, 'dateFrom');
  const to = parseDate(req.query.dateTo, 'dateTo');
  if (to <= from) throw new AppError(400, 'INVALID_RANGE', 'errors.invalidRange');
  if ((to.getTime() - from.getTime()) / MS_PER_DAY > MOBILITY_RUN_NOW_MAX_RANGE_DAYS) {
    throw new AppError(400, 'RANGE_TOO_LARGE', 'errors.rangeTooLarge');
  }
  return { from, to };
}

/**
 * RFC 4180 quoting: a value containing a comma, quote or newline is
 * quoted, and an interior quote is doubled.
 *
 * Written with includes/split rather than the obvious
 * `/[",\n\r]/.test(s)` + template literal. That started as a
 * workaround: the wiring audit's tokenizer (scripts/wiring-audit/
 * extract.ts) mis-tokenised a regex literal containing a double quote
 * when it sat inside a template literal's ${...} expression, lost its
 * place and blanked the REST OF THE FILE — so every endpoint below it
 * vanished from the map, silently, which is the one thing that audit
 * exists to prevent.
 *
 * LOOSE-ENDS G2 — that hole is CLOSED. `skipTemplateExpr` now shares
 * the main scan's single regex heuristic, and the shape is pinned by a
 * permanent fixture plus tokenize() cases in
 * scripts/wiring-audit/tests/extract.test.ts. Nothing in this file has
 * to avoid the shape any more.
 *
 * The includes/split form stays because it is perfectly good code and
 * rewriting it would buy nothing — not because the extractor still
 * cannot read it.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = value instanceof Date ? value.toISOString() : String(value);
  const needsQuotes =
    s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r');
  if (!needsQuotes) return s;
  return '"' + s.split('"').join('""') + '"';
}

export const CSV_HEADER = [
  'tier',
  'aggregateType',
  'cellId',
  'cellCenterLat',
  'cellCenterLng',
  'bucketStart',
  'bucketEnd',
  'count',
  'attributes',
].join(',');

/**
 * One row, already sanitized, as a CSV line. The attributes column holds
 * the sanitized JSON verbatim — a spreadsheet can ignore it, and a
 * script can parse it, and neither has to guess at a flattening scheme.
 */
export function csvLine(row: ExportRow, attributes: AttributeSet | undefined): string {
  return [
    csvCell(row.tier),
    csvCell(row.aggregateType),
    csvCell(row.cellId),
    csvCell(row.cellCenterLat),
    csvCell(row.cellCenterLng),
    csvCell(row.bucketStart),
    csvCell(row.bucketEnd),
    csvCell(row.count),
    csvCell(attributes === undefined ? '' : JSON.stringify(attributes)),
  ].join(',');
}

/**
 * @openapi
 * /api/intel/aggregates/export:
 *   get:
 *     summary: Stream k-anonymised mobility aggregates as CSV or JSONL.
 *     tags: [Intel - Mobility Intelligence]
 */
router.get(
  '/aggregates/export',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tier = parseTier(req.query.tier);
      const aggregateType = parseAggregateType(req.query.aggregateType);
      const { from, to } = parseRange(req);
      const format = parseFormat(req.query.format);

      const filename = `bimoto-mobility-${aggregateType.toLowerCase()}-${tier.toLowerCase()}.${format}`;
      res.setHeader(
        'Content-Type',
        format === 'csv' ? 'text/csv; charset=utf-8' : 'application/x-ndjson; charset=utf-8',
      );
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      if (format === 'csv') res.write(`${CSV_HEADER}\n`);

      let cursor: string | undefined;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const page: Array<ExportRow & { id: string }> = await (
          prisma
        ).mobilityAggregate.findMany({
          where: { tier, aggregateType, bucketStart: { gte: from, lt: to } },
          orderBy: { id: 'asc' },
          take: PAGE_SIZE,
          ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        });
        if (page.length === 0) break;

        for (const row of page) {
          // The same shared gate the aggregates GET runs. Rows written
          // before the grain gate existed are sanitized here, on the way
          // out, exactly as they are there.
          const attributes = sanitizeAttributes(row.attributesJson as AttributeSet | null);
          if (format === 'csv') {
            res.write(`${csvLine(row, attributes)}\n`);
          } else {
            res.write(
              `${JSON.stringify({
                tier: row.tier,
                aggregateType: row.aggregateType,
                cellId: row.cellId,
                cellCenterLat: row.cellCenterLat,
                cellCenterLng: row.cellCenterLng,
                bucketStart: row.bucketStart,
                bucketEnd: row.bucketEnd,
                count: row.count,
                attributes: attributes ?? null,
              })}\n`,
            );
          }
        }

        cursor = page[page.length - 1].id;
        if (page.length < PAGE_SIZE) break;
      }

      res.end();
    } catch (err) {
      // Only useful before the first byte; once streaming has begun the
      // error handler cannot change the status, and express says so.
      if (res.headersSent) {
        res.end();
        return;
      }
      next(err);
    }
  },
);

export default router;
