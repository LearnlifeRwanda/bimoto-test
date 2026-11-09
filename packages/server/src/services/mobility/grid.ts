// SERVICES/MOBILITY/GRID.TS
//
// Pure helpers for snapping a (lat, lng, timestamp) into a hex cell and
// time bucket for a given mobility tier. The cellId is an opaque sha256
// hash of (tier, cellSize, axialQ, axialR) so the raw coordinates are
// not recoverable from the hash alone — defence-in-depth on top of the
// per-tier kThreshold suppression.

import { createHash } from 'crypto';
import { TIER_CONFIGS, MOBILITY_AGGREGATION_TIMEZONE } from './config';
import type { Tier } from './types';

// Local equirectangular projection: 1° latitude ≈ 111_320 m everywhere;
// 1° longitude ≈ 111_320 * cos(lat) m. Cell sizes here are <= ~5 km, so
// the projection error within a single cell is negligible.
const METERS_PER_DEGREE_LAT = 111_320;

function metersPerDegreeLng(lat: number): number {
  return METERS_PER_DEGREE_LAT * Math.cos((lat * Math.PI) / 180);
}

interface AxialHex {
  q: number;
  r: number;
}

// Pointy-top hex axial coordinates. `size` is the hex side length
// (also the circumradius). See https://www.redblobgames.com/grids/hexagons/.
function pointToAxial(x: number, y: number, size: number): AxialHex {
  const qFrac = ((Math.sqrt(3) / 3) * x - (1 / 3) * y) / size;
  const rFrac = ((2 / 3) * y) / size;
  return roundAxial(qFrac, rFrac);
}

function roundAxial(qFrac: number, rFrac: number): AxialHex {
  const sFrac = -qFrac - rFrac;
  let q = Math.round(qFrac);
  let r = Math.round(rFrac);
  const s = Math.round(sFrac);
  const dq = Math.abs(q - qFrac);
  const dr = Math.abs(r - rFrac);
  const ds = Math.abs(s - sFrac);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return { q, r };
}

function axialToPoint(hex: AxialHex, size: number): { x: number; y: number } {
  const x = size * (Math.sqrt(3) * hex.q + (Math.sqrt(3) / 2) * hex.r);
  const y = size * ((3 / 2) * hex.r);
  return { x, y };
}

export function snapToCell(
  lat: number,
  lng: number,
  cellSizeMeters: number,
  tier: Tier = 'DENSE',
): { cellId: string; centerLat: number; centerLng: number } {
  const refLat = lat;
  const xMeters = lng * metersPerDegreeLng(refLat);
  const yMeters = lat * METERS_PER_DEGREE_LAT;
  const hex = pointToAxial(xMeters, yMeters, cellSizeMeters);
  const { x: cx, y: cy } = axialToPoint(hex, cellSizeMeters);
  const centerLat = cy / METERS_PER_DEGREE_LAT;
  const centerLng = cx / metersPerDegreeLng(centerLat);
  const cellId = createHash('sha256')
    .update(`${tier}:${cellSizeMeters}:${hex.q}:${hex.r}`)
    .digest('hex');
  return { cellId, centerLat, centerLng };
}

// Returns the offset (minutes) of the given UTC date in the named IANA
// timezone. Positive values mean the timezone is ahead of UTC.
function timezoneOffsetMinutes(at: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(at);
  const lookup: Record<string, string> = {};
  for (const p of parts) lookup[p.type] = p.value;
  const asUtc = Date.UTC(
    parseInt(lookup.year, 10),
    parseInt(lookup.month, 10) - 1,
    parseInt(lookup.day, 10),
    parseInt(lookup.hour, 10),
    parseInt(lookup.minute, 10),
    parseInt(lookup.second, 10),
  );
  return Math.round((asUtc - at.getTime()) / 60_000);
}

export function snapToBucket(
  timestamp: Date,
  bucketMinutes: number,
  timezone: string = MOBILITY_AGGREGATION_TIMEZONE,
): { bucketStart: Date; bucketEnd: Date } {
  const offsetMin = timezoneOffsetMinutes(timestamp, timezone);
  const localMs = timestamp.getTime() + offsetMin * 60_000;
  const bucketMs = bucketMinutes * 60_000;
  const localBucketStartMs = Math.floor(localMs / bucketMs) * bucketMs;
  const bucketStartMs = localBucketStartMs - offsetMin * 60_000;
  return {
    bucketStart: new Date(bucketStartMs),
    bucketEnd: new Date(bucketStartMs + bucketMs),
  };
}

export function classifyPoint(
  point: { lat: number; lng: number; timestamp: Date },
  tier: Tier,
): {
  cellId: string;
  cellCenterLat: number;
  cellCenterLng: number;
  bucketStart: Date;
  bucketEnd: Date;
} {
  const cfg = TIER_CONFIGS[tier];
  if (!cfg) {
    throw new Error(`mobility-grid: unknown tier ${String(tier)}`);
  }
  const cell = snapToCell(point.lat, point.lng, cfg.cellSizeMeters, tier);
  const bucket = snapToBucket(point.timestamp, cfg.bucketMinutes);
  return {
    cellId: cell.cellId,
    cellCenterLat: cell.centerLat,
    cellCenterLng: cell.centerLng,
    bucketStart: bucket.bucketStart,
    bucketEnd: bucket.bucketEnd,
  };
}
