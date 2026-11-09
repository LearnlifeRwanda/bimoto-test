// __TESTS__/REGION-FIXTURE.TEST.TS
//
// MAP-RWANDA G1 — the fixtures, before anything is generalised.
//
// The rest of this work turns one region into six. Every test that
// follows needs at least two archives on disk at once, and the first
// question was whether MAP-TRUTH's existing fixture could carry that or
// whether a second way to fake an archive had to be invented.
//
// It could. buildPmtilesArchive() was already parameterised by tiles,
// bbox and metadata, so a region fixture is a named call to it — no new
// format, no second pattern to keep honest. This file pins that:
//
//   - two regions produce genuinely different bytes (not the same
//     archive under two names, which would let a mixed-up region pass
//     every downstream test);
//   - each carries its own header bbox, which is what the client's
//     region selection reads;
//   - each stays under a kilobyte, so CI never carries map data.
//
// A real Rwandan province is tens of megabytes. That is exactly why no
// real archive is ever committed to this repo, and why these are built
// in memory at test time instead.

import { buildRegionArchive, buildRegionManifest } from './helpers/pmtiles-fixture';

/** Read the header bbox back out (PMTiles v3: int32 LE at 102..117, 1e7). */
function headerBbox(archive: Buffer): [number, number, number, number] {
  return [
    archive.readInt32LE(102) / 1e7,
    archive.readInt32LE(106) / 1e7,
    archive.readInt32LE(110) / 1e7,
    archive.readInt32LE(114) / 1e7,
  ];
}

const REGIONS = ['kigali', 'north', 'south', 'east', 'west', 'rwanda'];

describe('region fixtures (MAP-RWANDA G1)', () => {
  test('every region builds a valid PMTiles v3 archive', () => {
    for (const region of REGIONS) {
      const archive = buildRegionArchive(region);
      expect(archive.subarray(0, 7).toString()).toBe('PMTiles');
      expect(archive.readUInt8(7)).toBe(3);
    }
  });

  test('two regions are distinguishable by bytes and by bbox', () => {
    const kigali = buildRegionArchive('kigali');
    const north = buildRegionArchive('north');

    // Different bytes — a test that served the wrong archive must fail.
    expect(Buffer.compare(kigali, north)).not.toBe(0);
    // Different geography — this is what region selection reads.
    expect(headerBbox(kigali)).not.toEqual(headerBbox(north));
    expect(headerBbox(kigali)).toEqual([29.95, -2.1, 30.25, -1.83]);
    // And the payload names itself, so a failure says which one arrived.
    expect(kigali.toString('latin1')).toContain('kigali-tile-0-payload');
    expect(north.toString('latin1')).toContain('north-tile-0-payload');
    expect(kigali.toString('latin1')).not.toContain('north-tile');
  });

  test('all six regions are mutually distinct', () => {
    const seen = new Set(REGIONS.map((r) => buildRegionArchive(r).toString('base64')));
    expect(seen.size).toBe(REGIONS.length);
  });

  test('fixtures stay tiny — CI never carries map data', () => {
    for (const region of REGIONS) {
      // A few hundred bytes each. The real archives are 6–40 MB and are
      // built by the operator, never committed.
      expect(buildRegionArchive(region).length).toBeLessThan(1024);
    }
  });

  test('the manifest fixture matches the archive it describes', () => {
    const archive = buildRegionArchive('north');
    const manifest = buildRegionManifest('north', archive.length);
    expect(manifest.artifact).toBe('north.pmtiles');
    expect(manifest.region).toBe('north');
    expect(manifest.sizeBytes).toBe(archive.length);
  });
});
