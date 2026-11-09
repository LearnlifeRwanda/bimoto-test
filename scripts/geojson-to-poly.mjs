// SCRIPTS/GEOJSON-TO-POLY.MJS
//
// MAP-RWANDA G3 — GeoJSON (Multi)Polygon → the osmosis .poly format
// Planetiler's --polygon flag reads.
//
// This is the only part of province-boundary derivation that is logic
// rather than tool invocation, so it is the part that is a real file
// with a real test. osmium does the OSM work in
// scripts/derive-province-polys.command; this does the conversion, and
// scripts/tests/geojson-to-poly.test.mjs proves it against hand-checked
// fixtures — including the multipolygon and hole cases that a province
// boundary genuinely has (a district enclave, a lake cut out).
//
// The .poly format, for reference:
//
//     <name>                 free-text file name line
//     <ring name>            a ring; a leading ! marks a hole
//        lon lat             coordinates, whitespace-led, one per line
//        ...
//     END                    ends the ring
//     END                    ends the file
//
// Usage:
//   node scripts/geojson-to-poly.mjs <name> < feature.geojson > out.poly

/** Rings of a GeoJSON geometry as [outer, ...holes] groups. */
export function ringsOf(geometry) {
  if (!geometry || typeof geometry !== 'object') {
    throw new Error('no geometry');
  }
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  throw new Error(`unsupported geometry type: ${geometry.type}`);
}

/**
 * Render one .poly file.
 *
 * Coordinates are written at 7 decimal places — about a centimetre,
 * which is far finer than any administrative boundary is surveyed and
 * keeps the file readable. Rings are emitted outer-first; every ring
 * after the first in a polygon is a hole and gets the ! prefix, which is
 * what stops a lake or an enclave from being clipped INTO the province.
 */
export function toPoly(name, geometry) {
  const groups = ringsOf(geometry);
  const out = [name];

  let n = 0;
  for (const polygon of groups) {
    for (let i = 0; i < polygon.length; i++) {
      const ring = polygon[i];
      if (!Array.isArray(ring) || ring.length < 3) {
        throw new Error(`ring ${n} has fewer than 3 points`);
      }
      n += 1;
      out.push(i === 0 ? String(n) : `!${n}`);
      for (const point of ring) {
        const [lon, lat] = point;
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
          throw new Error(`ring ${n} has a non-numeric coordinate`);
        }
        out.push(`   ${lon.toFixed(7)}   ${lat.toFixed(7)}`);
      }
      out.push('END');
    }
  }

  if (n === 0) throw new Error('no rings');
  out.push('END');
  return `${out.join('\n')}\n`;
}

/** Pull the geometry out of a Feature, FeatureCollection or bare geometry.
 *  osmium export emits one Feature per line, so a collection with several
 *  features is merged into one MultiPolygon — a province that OSM models
 *  as more than one relation is still one province. */
export function geometryFrom(parsed) {
  if (parsed?.type === 'FeatureCollection') {
    const geoms = (parsed.features ?? []).map((f) => f.geometry).filter(Boolean);
    if (geoms.length === 0) throw new Error('FeatureCollection has no geometry');
    if (geoms.length === 1) return geoms[0];
    return {
      type: 'MultiPolygon',
      coordinates: geoms.flatMap((g) => ringsOf(g)),
    };
  }
  if (parsed?.type === 'Feature') return parsed.geometry;
  return parsed;
}

// --- CLI -------------------------------------------------------------
// Only when run directly, so the functions above stay importable by the
// test without it trying to read stdin.
const isMain =
  process.argv[1] && import.meta.url === `file://${process.argv[1]}`;

if (isMain) {
  const name = process.argv[2];
  if (!name) {
    process.stderr.write(
      'usage: node scripts/geojson-to-poly.mjs <name> < feature.geojson > out.poly\n',
    );
    process.exit(2);
  }

  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) {
    process.stderr.write('geojson-to-poly: no input on stdin\n');
    process.exit(1);
  }

  try {
    // osmium export writes one JSON object per line (GeoJSON Text
    // Sequences). Accept that as well as a single document.
    const lines = raw.split('\n').filter((l) => l.trim() !== '');
    const parsed =
      lines.length > 1 && !raw.startsWith('{\n')
        ? { type: 'FeatureCollection', features: lines.map((l) => JSON.parse(l)) }
        : JSON.parse(raw);
    process.stdout.write(toPoly(name, geometryFrom(parsed)));
  } catch (err) {
    process.stderr.write(`geojson-to-poly: ${err.message}\n`);
    process.exit(1);
  }
}
