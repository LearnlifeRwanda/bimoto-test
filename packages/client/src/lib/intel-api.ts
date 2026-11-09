// LIB/INTEL-API.TS
//
// INTEL-DECK G5 — the reading room's data layer: the row shapes the
// server sends and the four calls the screen makes. Kept out of the
// components so the screen files stay about what a person sees.
//
// Everything here reads. The two mutations the ops panel offers
// (run-now, reload) are ADMIN-only on the server and are the only
// non-GET calls in this file, deliberately grouped at the bottom where
// they are easy to find.

import { apiFetch } from './api';

export type Tier = 'DENSE' | 'MEDIUM' | 'LOW' | 'SPARSE';
export type AggregateTypeName = 'POINT_DENSITY' | 'OD_MATRIX';

export const ALL_TIERS: Tier[] = ['DENSE', 'MEDIUM', 'LOW', 'SPARSE'];

/**
 * A row exactly as the server serves it — already k-gated on the cell
 * total and already run through the marginal-suppression gate, on both
 * the write and the read side. The client never re-derives privacy; it
 * renders what survived.
 */
export interface AggregateRow {
  id: string;
  tier: Tier;
  aggregateType: AggregateTypeName;
  cellId: string;
  cellCenterLat: number;
  cellCenterLng: number;
  bucketStart: string;
  bucketEnd: string;
  count: number;
  attributesJson: Record<string, unknown> | null;
}

export interface TierConfig {
  tier: Tier;
  cellSizeMeters: number;
  bucketMinutes: number;
  kThreshold: number;
  attributes: string[];
}

export interface TierStats {
  cells: number;
  totalPoints: number;
}

/** The destination half of an OD row, pulled out of attributesJson. */
export interface FlowEndpoints {
  originCellId: string;
  destCellId: string;
  originCenterLat: number;
  originCenterLng: number;
  destCenterLat: number;
  destCenterLng: number;
  destTier?: Tier;
}

export interface Flow extends FlowEndpoints {
  rowId: string;
  count: number;
  share: number;
  bucketStart: string;
  tier: Tier;
  attributes: Record<string, unknown>;
}

function query(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') search.set(k, v);
  }
  return search.toString();
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as T;
}

export interface AggregateQuery {
  tier: Tier;
  aggregateType: AggregateTypeName;
  dateFrom: string;
  dateTo: string;
  limit?: number;
}

export async function fetchAggregates(q: AggregateQuery): Promise<AggregateRow[]> {
  const res = await apiFetch(
    `/api/admin/mobility/aggregates?${query({
      tier: q.tier,
      aggregateType: q.aggregateType,
      dateFrom: q.dateFrom,
      dateTo: q.dateTo,
      limit: q.limit === undefined ? undefined : String(q.limit),
    })}`,
    { credentials: 'include' },
  );
  const body = await json<{ rows: AggregateRow[] }>(res);
  return body.rows ?? [];
}

export async function fetchTierConfig(): Promise<{
  config: Record<Tier, TierConfig>;
  classificationVersion: string;
  /** LOOSE-ENDS G6 — the server's own run-now range cap, in days.
   *  Optional: a server that predates this field leaves the picker's
   *  cap check to the server's 422. */
  maxRunNowRangeDays?: number;
}> {
  const res = await apiFetch(`/api/admin/mobility/tier-config`, { credentials: 'include' });
  return json(res);
}

export async function fetchStats(
  dateFrom: string,
  dateTo: string,
): Promise<Record<Tier, TierStats>> {
  const res = await apiFetch(
    `/api/admin/mobility/aggregates/stats?${query({ dateFrom, dateTo })}`,
    { credentials: 'include' },
  );
  const body = await json<{ stats: Record<Tier, TierStats> }>(res);
  return body.stats;
}

/**
 * Fetch the export as text. Shown in the page rather than downloaded,
 * for the same reason AdminErrorReports shows its JSONL: the WebView's
 * download story is not worth depending on, and select-all-and-copy
 * works on every device the pilot has.
 *
 * The path is written inline rather than built by a helper on purpose —
 * the wiring audit resolves an apiFetch whose first argument is a
 * literal or template and files anything else under UNRESOLVED, and an
 * endpoint whose only call site is unresolved is one nobody can prove is
 * wired.
 */
export async function fetchExport(
  q: AggregateQuery,
  format: 'csv' | 'jsonl',
): Promise<string> {
  const res = await apiFetch(
    `/api/intel/aggregates/export?${query({
      tier: q.tier,
      aggregateType: q.aggregateType,
      dateFrom: q.dateFrom,
      dateTo: q.dateTo,
      format,
    })}`,
    { credentials: 'include' },
  );
  if (!res.ok) throw new Error(String(res.status));
  return res.text();
}

/**
 * Turn OD rows into ranked flows. The endpoints live in attributesJson
 * (see services/mobility/aggregator/od-matrix.ts's header on why the
 * pair, not the origin, is the row's identity); a row missing them is
 * dropped rather than rendered as a half-flow.
 */
export function toFlows(rows: AggregateRow[]): Flow[] {
  const usable = rows.filter((r) => {
    const a = r.attributesJson;
    return (
      a !== null &&
      typeof a.originCellId === 'string' &&
      typeof a.destCellId === 'string' &&
      typeof a.destCenterLat === 'number' &&
      typeof a.destCenterLng === 'number'
    );
  });
  const total = usable.reduce((sum, r) => sum + r.count, 0);
  return usable
    .map((r) => {
      const a = r.attributesJson as Record<string, unknown>;
      return {
        rowId: r.id,
        count: r.count,
        share: total > 0 ? r.count / total : 0,
        bucketStart: r.bucketStart,
        tier: r.tier,
        attributes: a,
        originCellId: a.originCellId as string,
        destCellId: a.destCellId as string,
        originCenterLat: (a.originCenterLat as number) ?? r.cellCenterLat,
        originCenterLng: (a.originCenterLng as number) ?? r.cellCenterLng,
        destCenterLat: a.destCenterLat as number,
        destCenterLng: a.destCenterLng as number,
        destTier: a.destTier as Tier | undefined,
      };
    })
    .sort((a, b) => b.count - a.count || a.rowId.localeCompare(b.rowId));
}

/**
 * The marginal maps inside a row's attributes, in a shape a bar list can
 * render: [key, count] sorted biggest-first, with `other` — the
 * suppression gate's fold — always last so it reads as a remainder
 * rather than as a category.
 */
export function marginalBars(
  attributes: Record<string, unknown> | null,
  key: string,
): Array<[string, number]> {
  if (!attributes) return [];
  const map = attributes[key];
  if (map === null || typeof map !== 'object' || Array.isArray(map)) return [];
  const entries = Object.entries(map as Record<string, unknown>).filter(
    (e): e is [string, number] => typeof e[1] === 'number',
  );
  return entries.sort((a, b) => {
    if (a[0] === 'other') return 1;
    if (b[0] === 'other') return -1;
    return b[1] - a[1] || a[0].localeCompare(b[0]);
  });
}

// --------------------------------------------------------------- ADMIN

/**
 * LOOSE-ENDS G6 — run-now, optionally over an explicit range.
 *
 * No range → the request body is omitted entirely and the server runs
 * its own lookback window, exactly as before and exactly as the nightly
 * cron does. A range → both bounds, which the server re-validates; the
 * picker mirrors the same rules so the common mistakes are caught
 * before the round trip.
 */
export async function runAggregationNow(range?: {
  dateFrom: string;
  dateTo: string;
}): Promise<void> {
  const res = await apiFetch(`/api/admin/mobility/aggregates/run-now`, {
    method: 'POST',
    credentials: 'include',
    ...(range
      ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(range) }
      : {}),
  });
  if (!res.ok) throw new Error(String(res.status));
}

export async function reloadTierConfig(): Promise<string> {
  const res = await apiFetch(`/api/admin/mobility/tier-config/reload`, {
    method: 'POST',
    credentials: 'include',
  });
  const body = await json<{ version: string }>(res);
  return body.version;
}
