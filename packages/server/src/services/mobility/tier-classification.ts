// SERVICES/MOBILITY/TIER-CLASSIFICATION.TS
//
// Loads tier-classification.json at startup and resolves a (lat, lng) to
// its mobility tier. Lookup priority: DENSE → MEDIUM → LOW → SPARSE
// (first-match-wins). SPARSE is the default for any coordinate not
// matching above.
//
// Boundary discipline: a coordinate exactly on a bounding-box edge is
// considered INSIDE the box (inclusive comparison via min <= v <= max).
// This guarantees consistent classification at exact edges across
// repeated calls.

import fs from 'fs';
import path from 'path';
import type {
  Tier,
  TierBoundingBox,
  TierClassificationFile,
} from './types';

const DEFAULT_PATH = path.join(__dirname, 'tier-classification.json');

let cached: TierClassificationFile | null = null;

const TIER_PRIORITY: Tier[] = ['DENSE', 'MEDIUM', 'LOW'];

function loadFromDisk(): TierClassificationFile {
  const raw = fs.readFileSync(DEFAULT_PATH, 'utf-8');
  const parsed = JSON.parse(raw) as TierClassificationFile;
  validate(parsed);
  return parsed;
}

function validate(file: TierClassificationFile): void {
  if (!file?.tiers) {
    throw new Error('tier-classification: missing tiers');
  }
  for (const tier of ['DENSE', 'MEDIUM', 'LOW', 'SPARSE'] as Tier[]) {
    if (!file.tiers[tier]) {
      throw new Error(`tier-classification: missing tier ${tier}`);
    }
  }
}

function getConfig(): TierClassificationFile {
  if (!cached) {
    cached = loadFromDisk();
  }
  return cached;
}

function inBox(lat: number, lng: number, box: TierBoundingBox): boolean {
  return (
    lat >= box.minLat &&
    lat <= box.maxLat &&
    lng >= box.minLng &&
    lng <= box.maxLng
  );
}

export function tierForCoordinates(lat: number, lng: number): Tier {
  const cfg = getConfig();
  for (const tier of TIER_PRIORITY) {
    const boxes = cfg.tiers[tier]?.boundingBoxes ?? [];
    for (const box of boxes) {
      if (inBox(lat, lng, box)) {
        return tier;
      }
    }
  }
  return 'SPARSE';
}

export function reloadTierClassification(): { version: string } {
  cached = loadFromDisk();
  return { version: cached.version };
}

export function getTierClassificationVersion(): string {
  return getConfig().version;
}

// Test-only helper: force a config in memory without touching disk.
export function _setTierConfig(config: TierClassificationFile): void {
  validate(config);
  cached = config;
}

export function _resetTierConfigForTests(): void {
  cached = null;
}
