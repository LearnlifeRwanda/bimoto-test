// SCRIPTS/SELECT-ADMIN4.MJS
//
// SHIPSHAPE G2 — pick one province's admin_level=4 boundary features
// out of an osmium export.
//
// This was an inline `node -e` block in derive-province-polys.command.
// It is a real file now for the same reason geojson-to-poly.mjs is one:
// it is logic rather than tool invocation, and logic that is wrong in a
// way no one notices until an operator is mid-release. Its comment
// claimed "the export is one JSON object per line" — but the script
// exports to `.admin4.geojson`, and osmium picks its writer from the
// extension: `.geojson` is ONE FeatureCollection document, not a
// sequence. Parsed line-by-line, that matched zero provinces and the
// script died claiming the boundary was missing when it was present.
//
// Usage:
//   node scripts/select-admin4.mjs <name-rw> <name-en> < export.geojson
//
// stdout: the matching features, one JSON object per line — which is
// what geojson-to-poly.mjs reads. Exit 3 (with a message on stderr)
// when nothing matches, so the caller can die with its own hint.

/** RFC 8142 prefixes each record with a record separator (0x1E). */
const stripRS = (s) => s.replace(/^\x1e/, '');

/**
 * The features of an osmium export, whatever shape it was written in.
 *
 * osmium picks its writer from the output extension, so the shape is a
 * property of the caller's filename rather than of the data:
 *
 *   .geojson     one FeatureCollection document   ← what the script asks for
 *   .geojsonseq  one Feature per line, each optionally RS-prefixed
 *
 * Reading both costs one try/catch and removes a whole class of
 * "the boundary is missing" lie, so this parses the document first and
 * falls back to the sequence only when the document parse fails. A
 * one-line sequence parses as a bare Feature — same features out.
 */
export function featuresOf(raw) {
  const trimmed = stripRS(raw).trim();
  if (!trimmed) return [];

  try {
    const doc = JSON.parse(trimmed);
    if (doc && doc.type === 'FeatureCollection') {
      return Array.isArray(doc.features) ? doc.features : [];
    }
    return [doc];
  } catch {
    // Not one document — a sequence, then.
  }

  const out = [];
  for (const line of trimmed.split('\n')) {
    // osmium writes RS-prefixed records for .geojsonseq, and
    // JSON.parse chokes on the byte.
    const record = stripRS(line);
    if (!record.trim()) continue;
    let f;
    try {
      f = JSON.parse(record);
    } catch {
      continue;
    }
    out.push(f);
  }
  return out;
}

/**
 * The province match: admin_level 4, and a name that is the Kinyarwanda
 * or the English one. Both `name:en` and `name:rw` stay in the
 * candidate list beside plain `name` — a boundary relation carries
 * whichever of them the last mapper thought to set.
 */
export function selectAdmin4(features, rw, en) {
  return features.filter((f) => {
    const p = (f && f.properties) || {};
    if (String(p.admin_level) !== '4') return false;
    const names = [p.name, p['name:en'], p['name:rw']].filter(Boolean);
    return names.some((n) => n === rw || n === en);
  });
}

// --- CLI -------------------------------------------------------------
// Only when run directly, so the functions above stay importable by the
// test without it trying to read stdin.
const isMain =
  process.argv[1] && import.meta.url === `file://${process.argv[1]}`;

if (isMain) {
  const [rw, en] = process.argv.slice(2);
  if (!rw || !en) {
    process.stderr.write(
      'usage: node scripts/select-admin4.mjs <name-rw> <name-en> < export.geojson\n',
    );
    process.exit(2);
  }

  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');

  const matched = selectAdmin4(featuresOf(raw), rw, en);
  if (matched.length === 0) {
    process.stderr.write(
      'no admin_level=4 boundary named ' + rw + ' / ' + en + '\n',
    );
    process.exit(3);
  }
  process.stdout.write(matched.map((f) => JSON.stringify(f)).join('\n') + '\n');
}
