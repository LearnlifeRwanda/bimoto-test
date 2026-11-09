// SERVICES/MAP-EXTRACT.TS
//
// MAP-TRUTH G3 — where the offline Kigali extract lives.
//
// The whole offline-map feature shipped and stayed dark because
// MAP_PMTILES_PATH was empty on the pilot server and nobody had a way to
// fill it. The route was honest — it answered 404 MAP_NOT_AVAILABLE —
// but honesty about a file nobody made is not a working feature.
//
// So path resolution gets a DEFAULT RUNG, the same shape as
// resolveBuildCommit's file rung in build-identity.ts:
//
//   1. MAP_PMTILES_PATH        — explicit operator override, wins always
//   2. data/kigali.pmtiles     — the known location, no configuration
//
// scripts/update-pilot.command places the archive at rung 2, so an
// update bundle that carries an extract simply starts working. This
// matters because update-pilot.command promises the operator that their
// .env is kept "exactly as they are" and its own guard asserts it — the
// updater must never write MAP_PMTILES_PATH, so the default rung is the
// only honest way to wire this up.
//
// Candidates are relative to the server's cwd. The pilot runbook starts
// it from packages/server (`cd $BIMOTO_HOME/packages/server`), a repo
// checkout may start it from the root; both are checked, exactly as
// BUILD_SHA_FILE_CANDIDATES does.
//
// Deliberately NOT cached: an archive dropped in while the server is
// running should start being served, not wait for a restart. The cost is
// one stat per request on a route that then streams tens of megabytes.

import { readdir, readFile, stat } from 'fs/promises';
import { dirname, join, resolve } from 'path';
import { config } from '../config';

export const MAP_EXTRACT_FILENAME = 'kigali.pmtiles';

/** The region the whole feature used to be. Still the only key an old
 *  APK in the field knows how to ask for, and the only one with a route
 *  of its own. */
export const LEGACY_REGION_KEY = 'kigali';

/** The known directories, checked from both documented working
 *  directories — the same two rungs MAP_EXTRACT_DEFAULT_CANDIDATES has
 *  always used, one level up. */
export const MAP_DATA_DIR_CANDIDATES = ['data', '../../data'];

/** The known location, checked from both documented working directories. */
export const MAP_EXTRACT_DEFAULT_CANDIDATES = MAP_DATA_DIR_CANDIDATES.map(
  (dir) => `${dir}/${MAP_EXTRACT_FILENAME}`,
);

interface FileFacts {
  size: number;
  etag: string;
  lastModified: string;
}

async function fileFacts(path: string): Promise<FileFacts | null> {
  try {
    const info = await stat(path);
    if (!info.isFile()) return null;
    return {
      size: info.size,
      // MAP-TRUTH G4 — a strong validator for If-Range resume. Size plus
      // mtime changes whenever an update bundle swaps the archive, which
      // is the only way it ever changes. Quoted, as HTTP requires.
      etag: `"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`,
      lastModified: new Date(info.mtimeMs).toUTCString(),
    };
  } catch {
    return null;
  }
}

export interface ResolvedMapExtract extends FileFacts {
  path: string;
  /** Which rung answered — surfaced in diagnostics, never to the client. */
  source: 'env' | 'default';
}

/**
 * The extract to serve, or null when this server has none.
 *
 * An explicitly configured path that does not exist resolves to null
 * rather than falling through to the default: an operator who set the
 * variable meant that file, and silently serving a different archive
 * would be worse than a clean 404.
 */
export async function resolveMapExtract(): Promise<ResolvedMapExtract | null> {
  const configured = config.MAP_PMTILES_PATH;
  if (configured) {
    const facts = await fileFacts(configured);
    return facts === null ? null : { path: configured, ...facts, source: 'env' };
  }

  for (const candidate of MAP_EXTRACT_DEFAULT_CANDIDATES) {
    const path = resolve(process.cwd(), candidate);
    const facts = await fileFacts(path);
    if (facts !== null) return { path, ...facts, source: 'default' };
  }

  return null;
}

// ------------------------------------------------ MAP-RWANDA G2: regions
//
// The server stops knowing regions by name. It knows a DIRECTORY, and
// whatever .pmtiles files are in it are the regions this server has.
//
// That is the whole provisioning story: the founder builds an archive on
// the operator Mac, drops it in data/, and it appears to every user on
// the next screen open. Nothing to configure, nothing to redeploy, no
// list to keep in step. The alternative — a hardcoded region list on the
// server — would mean a file that exists but is invisible, or a region
// advertised that 404s, and one more place for the truth to drift.
//
// Sizes are read from the files themselves for the same reason. The old
// card carried KIGALI_MAP_ESTIMATED_MB = 40 next to an archive that
// turned out to be about 6 MB; a number a human typed is a number that
// goes stale. Every byte count below is a stat().

/**
 * The only region keys this server will ever look up: lowercase letters,
 * optionally hyphen-separated. Anchored, no dots, no slashes, no digits.
 *
 * This is the FIRST of two gates. A path segment reaches us URL-decoded
 * — `/api/map/..%2f..%2fetc%2fpasswd.pmtiles` arrives as the region
 * `../../etc/passwd`, which is verified behaviour, not a hypothetical —
 * so a key that fails this pattern is never joined to a path at all. The
 * second gate is that the key must also appear in the directory listing,
 * which means even a pattern-legal key can only ever name a real archive
 * this server chose to enumerate. Traversal is structurally impossible:
 * neither `.` nor `/` nor `%` can survive the pattern.
 */
export const REGION_KEY_PATTERN = /^[a-z]+(?:-[a-z]+)*$/;

export function isValidRegionKey(key: string): boolean {
  // Length bound so a pathological key cannot be used to probe the
  // filesystem with a megabyte-long name.
  return key.length > 0 && key.length <= 32 && REGION_KEY_PATTERN.test(key);
}

/** What the builder writes beside each archive. All fields optional —
 *  an archive without a manifest is still perfectly servable. */
export interface MapRegionManifest {
  source?: string;
  sourceVintage?: string;
  bbox?: string;
  minzoom?: number;
  maxzoom?: number;
  builtAt?: string;
  planetilerVersion?: string;
}

export interface MapRegionSummary {
  /** The region key — the filename without .pmtiles. */
  key: string;
  /** The i18n key naming it for humans. Names live in the shared
   *  registry on the client; the server never holds a display string. */
  nameKey: string;
  sizeBytes: number;
  lastModified: string;
  etag: string;
  /** From <region>.pmtiles.json when the builder left one. */
  manifest?: MapRegionManifest;
}

/** Every directory that might hold archives, deduped and existing. */
async function mapDataDirs(): Promise<string[]> {
  const configured = config.MAP_PMTILES_PATH;
  // An operator override names a file; its neighbours are the other
  // regions. This keeps a configured deployment able to grow past the
  // one archive its .env mentions, without the updater ever writing .env.
  const candidates = configured
    ? [dirname(resolve(configured))]
    : MAP_DATA_DIR_CANDIDATES.map((d) => resolve(process.cwd(), d));

  const dirs: string[] = [];
  for (const dir of candidates) {
    if (dirs.includes(dir)) continue;
    try {
      if ((await stat(dir)).isDirectory()) dirs.push(dir);
    } catch {
      // Not there — the next rung, or none at all.
    }
  }
  return dirs;
}

async function readManifest(archivePath: string): Promise<MapRegionManifest | undefined> {
  try {
    const raw = await readFile(`${archivePath}.json`, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return undefined;
    const m = parsed as Record<string, unknown>;
    const pick = <T>(k: string, kind: 'string' | 'number'): T | undefined =>
      typeof m[k] === kind ? (m[k] as T) : undefined;
    return {
      source: pick<string>('source', 'string'),
      sourceVintage: pick<string>('sourceVintage', 'string'),
      bbox: pick<string>('bbox', 'string'),
      minzoom: pick<number>('minzoom', 'number'),
      maxzoom: pick<number>('maxzoom', 'number'),
      builtAt: pick<string>('builtAt', 'string'),
      planetilerVersion: pick<string>('planetilerVersion', 'string'),
    };
  } catch {
    // No manifest, or an unreadable one. The archive still serves; the
    // client only ever needed the key and the size.
    return undefined;
  }
}

async function summarise(
  key: string,
  path: string,
  facts: FileFacts,
): Promise<MapRegionSummary> {
  const manifest = await readManifest(path);
  return {
    key,
    // The server holds no display strings. Names — and their French and
    // Kinyarwanda — live in the shared registry the client reads, so a
    // region is named in exactly one place.
    nameKey: `map.regions.${key}`,
    sizeBytes: facts.size,
    lastModified: facts.lastModified,
    etag: facts.etag,
    ...(manifest ? { manifest } : {}),
  };
}

/**
 * Every region this server can actually serve, first-directory-wins and
 * deduplicated by key.
 *
 * The listing and the serving agree by construction: `kigali` is taken
 * from resolveMapExtract() rather than from the scan, so the legacy
 * override rules (MAP_PMTILES_PATH wins; a configured-but-missing path
 * is a clean absence) produce exactly one answer for both. A region that
 * appears here can be fetched; a region that cannot be fetched does not
 * appear here.
 */
export async function listMapRegions(): Promise<MapRegionSummary[]> {
  const found = new Map<string, MapRegionSummary>();

  for (const dir of await mapDataDirs()) {
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.endsWith('.pmtiles')) continue;
      const key = name.slice(0, -'.pmtiles'.length);
      if (!isValidRegionKey(key)) continue;
      if (found.has(key)) continue;
      const path = join(dir, name);
      const facts = await fileFacts(path);
      if (!facts) continue;
      found.set(key, await summarise(key, path, facts));
    }
  }

  // Kigali answers to the legacy resolver, whatever the scan thought.
  const legacy = await resolveMapExtract();
  if (legacy) {
    found.set(LEGACY_REGION_KEY, await summarise(LEGACY_REGION_KEY, legacy.path, legacy));
  } else {
    found.delete(LEGACY_REGION_KEY);
  }

  return [...found.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * The archive for one region, or null when this server has none.
 *
 * `kigali` is deliberately routed through resolveMapExtract() unchanged,
 * so an old APK asking /api/map/kigali.pmtiles gets byte-for-byte the
 * same resolution it always did, including the MAP_PMTILES_PATH override
 * and the clean 404 for a configured-but-missing path.
 *
 * Every other region must survive BOTH gates — the key pattern and the
 * directory listing — before a path is built from it.
 */
export async function resolveMapRegion(
  key: string,
): Promise<ResolvedMapExtract | null> {
  if (!isValidRegionKey(key)) return null;
  if (key === LEGACY_REGION_KEY) return resolveMapExtract();

  // Gate two: only a key the listing produced can name a file. The path
  // is then rebuilt from the enumerated directory, never from the
  // request — the request only ever selects from a list we made.
  const listed = (await listMapRegions()).some((r) => r.key === key);
  if (!listed) return null;

  for (const dir of await mapDataDirs()) {
    const path = join(dir, `${key}.pmtiles`);
    const facts = await fileFacts(path);
    if (facts !== null) return { path, ...facts, source: 'default' };
  }
  return null;
}
