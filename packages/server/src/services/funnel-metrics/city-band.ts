// SERVICES/FUNNEL-METRICS/CITY-BAND.TS
//
// R3-FUNNEL-METRICS-DASHBOARD — classifies (lat, lng) into one of four
// operational city bands for the 500-driver pilot.
//
// Pattern mirrors services/mobility/tier-classification.ts — keep these
// two classifiers in shape-sync. They serve different purposes
// (mobility tiers drive aggregation cell-size + k-anonymity; city bands
// drive funnel filtering for operational visibility) but share the same
// JSON-config + cached-loader shape so the two Rwanda-spatial
// classifiers stay consistent.
//
// Boundary discipline: a coordinate exactly on a bounding-box edge is
// considered INSIDE the box (inclusive comparison via min <= v <= max).
// Lookup priority: kigali_dense -> kigali_periphery -> bugesera_corridor;
// first-match-wins. 'other' is the default for unmatched coordinates.

import fs from 'fs';
import path from 'path';
import type { CityBand } from '@bimoto/shared';

interface BoundingBox {
  name: string;
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

interface BandEntry {
  label: string;
  boundingBoxes: BoundingBox[];
}

interface CityBandFile {
  version: string;
  comment?: string;
  cityBands: {
    kigali_dense: BandEntry;
    kigali_periphery: BandEntry;
    bugesera_corridor: BandEntry;
  };
}

const DEFAULT_PATH = path.join(__dirname, 'city-band.json');

const PRIORITY: Exclude<CityBand, 'other'>[] = [
  'kigali_dense',
  'kigali_periphery',
  'bugesera_corridor',
];

let cached: CityBandFile | null = null;

function loadFromDisk(): CityBandFile {
  const raw = fs.readFileSync(DEFAULT_PATH, 'utf-8');
  const parsed = JSON.parse(raw) as CityBandFile;
  validate(parsed);
  return parsed;
}

function validate(file: CityBandFile): void {
  if (!file?.cityBands) {
    throw new Error('city-band: missing cityBands');
  }
  for (const band of PRIORITY) {
    if (!file.cityBands[band]) {
      throw new Error(`city-band: missing band ${band}`);
    }
  }
}

function getConfig(): CityBandFile {
  if (!cached) {
    cached = loadFromDisk();
  }
  return cached;
}

function inBox(lat: number, lng: number, box: BoundingBox): boolean {
  return (
    lat >= box.minLat &&
    lat <= box.maxLat &&
    lng >= box.minLng &&
    lng <= box.maxLng
  );
}

/**
 * Classify a coordinate into one of four operational city bands.
 *
 * NOTE: bounding-box coordinates in city-band.json are placeholder
 * approximations. Field-verified coordinates will be supplied by the
 * LLR co-shareholder before pilot launch via a JSON-only follow-up.
 */
export function classifyCityBand(lat: number, lng: number): CityBand {
  const cfg = getConfig();
  for (const band of PRIORITY) {
    for (const box of cfg.cityBands[band].boundingBoxes) {
      if (inBox(lat, lng, box)) {
        return band;
      }
    }
  }
  return 'other';
}

export function reloadCityBandConfig(): { version: string } {
  cached = loadFromDisk();
  return { version: cached.version };
}

export function getCityBandConfigVersion(): string {
  return getConfig().version;
}

// Test-only helpers.
export function _setCityBandConfig(config: CityBandFile): void {
  validate(config);
  cached = config;
}

export function _resetCityBandConfigForTests(): void {
  cached = null;
}
