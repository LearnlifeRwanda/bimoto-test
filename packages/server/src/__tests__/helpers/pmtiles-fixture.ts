// __TESTS__/HELPERS/PMTILES-FIXTURE.TS
//
// MAP-TRUTH G3 — builds a genuinely valid PMTiles v3 archive in memory.
//
// The 404→200 proof is worth very little if the 200 serves an arbitrary
// blob: the point is that the client's pmtiles reader can range-read the
// bytes our route hands back. So the fixture is a real archive, encoded
// to the PMTiles v3 spec, and the test reads it back with the same
// `pmtiles` package the client ships.
//
// Spec: https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md
// Header is 127 bytes, little-endian. Directories are varint-encoded and
// written uncompressed here (internal compression = None), which the
// spec permits and which keeps the fixture free of a gzip dependency.

const HEADER_BYTES = 127;

const COMPRESSION_NONE = 1;
const TILETYPE_MVT = 1;

interface TileEntry {
  tileId: number;
  offset: number;
  length: number;
  runLength: number;
}

function writeVarint(out: number[], value: number): void {
  let v = value;
  while (v >= 0x80) {
    out.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  out.push(v);
}

/** ZXY → the Hilbert-curve tile id the spec orders entries by. */
export function zxyToTileId(z: number, x: number, y: number): number {
  // Number of tiles in all levels below z: (4^z - 1) / 3.
  let acc = 0;
  for (let i = 0; i < z; i++) acc += Math.pow(4, i);

  let rx: number;
  let ry: number;
  let d = 0;
  let tx = x;
  let ty = y;
  for (let s = Math.pow(2, z) / 2; s >= 1; s /= 2) {
    rx = (tx & s) > 0 ? 1 : 0;
    ry = (ty & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    // Rotate.
    if (ry === 0) {
      if (rx === 1) {
        tx = s - 1 - tx;
        ty = s - 1 - ty;
      }
      const t = tx;
      tx = ty;
      ty = t;
    }
  }
  return acc + d;
}

function encodeDirectory(entries: TileEntry[]): Buffer {
  const out: number[] = [];
  writeVarint(out, entries.length);

  let lastId = 0;
  for (const e of entries) {
    writeVarint(out, e.tileId - lastId);
    lastId = e.tileId;
  }
  for (const e of entries) writeVarint(out, e.runLength);
  for (const e of entries) writeVarint(out, e.length);
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const prev = entries[i - 1];
    // 0 is the "directly follows the previous entry" shorthand.
    if (i > 0 && prev && e.offset === prev.offset + prev.length) {
      writeVarint(out, 0);
    } else {
      writeVarint(out, e.offset + 1);
    }
  }
  return Buffer.from(out);
}

export interface FixtureTile {
  z: number;
  x: number;
  y: number;
  data: Buffer;
}

export interface FixtureOptions {
  tiles: FixtureTile[];
  minzoom: number;
  maxzoom: number;
  /** west, south, east, north — degrees. */
  bbox: [number, number, number, number];
  metadata?: Record<string, unknown>;
}

/**
 * A complete, spec-valid PMTiles v3 archive containing the given tiles.
 * Layout: header | root directory | metadata | (no leaves) | tile data.
 */
export function buildPmtilesArchive(opts: FixtureOptions): Buffer {
  const sorted = [...opts.tiles].sort(
    (a, b) => zxyToTileId(a.z, a.x, a.y) - zxyToTileId(b.z, b.x, b.y),
  );

  const tileBlobs: Buffer[] = [];
  const entries: TileEntry[] = [];
  let cursor = 0;
  for (const t of sorted) {
    entries.push({
      tileId: zxyToTileId(t.z, t.x, t.y),
      offset: cursor,
      length: t.data.length,
      runLength: 1,
    });
    tileBlobs.push(t.data);
    cursor += t.data.length;
  }

  const rootDir = encodeDirectory(entries);
  const metadata = Buffer.from(JSON.stringify(opts.metadata ?? {}), 'utf8');
  const tileData = Buffer.concat(tileBlobs);

  const rootDirOffset = HEADER_BYTES;
  const metadataOffset = rootDirOffset + rootDir.length;
  const leafOffset = metadataOffset + metadata.length;
  const tileDataOffset = leafOffset; // no leaf directories

  const header = Buffer.alloc(HEADER_BYTES);
  header.write('PMTiles', 0, 'utf8');
  header.writeUInt8(3, 7);
  writeUint64(header, 8, rootDirOffset);
  writeUint64(header, 16, rootDir.length);
  writeUint64(header, 24, metadataOffset);
  writeUint64(header, 32, metadata.length);
  writeUint64(header, 40, leafOffset);
  writeUint64(header, 48, 0);
  writeUint64(header, 56, tileDataOffset);
  writeUint64(header, 64, tileData.length);
  writeUint64(header, 72, entries.length); // addressed tiles
  writeUint64(header, 80, entries.length); // tile entries
  writeUint64(header, 88, entries.length); // tile contents
  header.writeUInt8(1, 96); // clustered
  header.writeUInt8(COMPRESSION_NONE, 97); // internal compression
  header.writeUInt8(COMPRESSION_NONE, 98); // tile compression
  header.writeUInt8(TILETYPE_MVT, 99); // tile type
  header.writeUInt8(opts.minzoom, 100);
  header.writeUInt8(opts.maxzoom, 101);

  const [w, s, e, n] = opts.bbox;
  header.writeInt32LE(Math.round(w * 1e7), 102);
  header.writeInt32LE(Math.round(s * 1e7), 106);
  header.writeInt32LE(Math.round(e * 1e7), 110);
  header.writeInt32LE(Math.round(n * 1e7), 114);
  header.writeUInt8(opts.maxzoom, 118); // center zoom
  header.writeInt32LE(Math.round(((w + e) / 2) * 1e7), 119);
  header.writeInt32LE(Math.round(((s + n) / 2) * 1e7), 123);

  return Buffer.concat([header, rootDir, metadata, tileData]);
}

function writeUint64(buf: Buffer, offset: number, value: number): void {
  buf.writeBigUInt64LE(BigInt(value), offset);
}

// ------------------------------------------------- MAP-RWANDA G1: regions
//
// The registry generalises from one archive to several, so the tests need
// two DISTINCT archives at once — enough to tell apart by bytes, size and
// geography, and small enough that CI never notices them.
//
// Nothing new was needed to get there. buildPmtilesArchive() was already
// parameterised by tiles, bbox and metadata; a region fixture is just a
// named call to it. That is deliberate: inventing a second fixture format
// would have left two ways to fake an archive and no reason to prefer
// either. Each archive below is well under a kilobyte — a real Rwandan
// province is tens of megabytes, which is precisely why no real archive is
// ever committed to this repo.

/** Bounding boxes only distinct enough to prove per-region selection —
 *  NOT the real province boundaries, which come from OSM admin_level 4 at
 *  build time (see scripts/build-region-pmtiles.command). */
const FIXTURE_BBOXES: Record<string, [number, number, number, number]> = {
  kigali: [29.95, -2.1, 30.25, -1.83],
  north: [29.3, -1.9, 30.1, -1.05],
  south: [29.3, -2.85, 30.05, -1.95],
  east: [30.1, -2.85, 30.9, -1.05],
  west: [28.85, -2.85, 29.6, -1.35],
  rwanda: [28.85, -2.85, 30.9, -1.05],
};

/**
 * A small, genuine, region-specific PMTiles v3 archive.
 *
 * Distinct per region in all three ways a test might compare them: the
 * tile payload carries the region name, the tile coordinates differ, and
 * the header bbox differs (which is what the client's region selection
 * actually reads).
 */
export function buildRegionArchive(region: string, tileCount = 2): Buffer {
  const bbox = FIXTURE_BBOXES[region] ?? [29.0, -2.0, 30.0, -1.0];
  // Spread the tiles by a hash of the name so two regions never share a
  // tile id — a test that mixed up two archives would otherwise pass.
  let seed = 0;
  for (const ch of region) seed = (seed * 31 + ch.charCodeAt(0)) % 4096;

  const tiles: FixtureTile[] = [];
  for (let i = 0; i < tileCount; i++) {
    tiles.push({
      z: 14,
      x: 8000 + seed + i,
      y: 8000 + seed,
      data: Buffer.from(`${region}-tile-${i}-payload`),
    });
  }

  return buildPmtilesArchive({
    tiles,
    minzoom: 0,
    maxzoom: 14,
    bbox,
    metadata: { name: region, source: 'geofabrik:rwanda' },
  });
}

/** The manifest the builder writes beside each archive, as a fixture. */
export function buildRegionManifest(
  region: string,
  sizeBytes: number,
): Record<string, unknown> {
  const bbox = FIXTURE_BBOXES[region] ?? [29.0, -2.0, 30.0, -1.0];
  return {
    artifact: `${region}.pmtiles`,
    region,
    source: 'geofabrik:rwanda',
    sourceVintage: '2026-08-07T03:14:22Z',
    bbox: bbox.join(','),
    minzoom: 0,
    maxzoom: 14,
    sizeBytes,
    sizeMB: Number((sizeBytes / 1048576).toFixed(1)),
    buildSeconds: 1,
    builtAt: '2026-08-08T09:00:00Z',
    planetilerVersion: '0.8.3',
  };
}
