// COMPONENTS/MAP/TILE-SOURCE.TS
//
// MAP-TRUTH G2 — the ONE place the base-map raster source is named.
//
// Every map surface renders through BaseTileLayer, which reads these
// constants; nothing else in the app may hold a tile URL. A regression
// test (base-tile-source.test.ts) greps the client source and fails if a
// second tile URL reappears anywhere, because that is exactly how three
// of the five map surfaces ended up with no offline fallback.
//
// Why no {s} subdomain: the a/b/c sharding scheme is deprecated by the
// OSM Foundation, and on a slow Kigali connection three hostnames means
// three DNS lookups and three TLS handshakes instead of one HTTP/2
// connection carrying every tile. The canonical single host is both the
// compliant and the faster choice.
//
// CSP NOTE — a CSP wildcard `*.tile.openstreetmap.org` does NOT match
// the bare host `tile.openstreetmap.org`. Changing this constant means
// changing the img-src allowance in BOTH policies that gate it:
//   packages/client/vite.config.ts  (buildCsp → the packaged WebView)
//   packages/server/src/index.ts    (helmet → the served web app)
// Their tests assert the exact strings, so a half-done change fails CI
// rather than shipping a blank map.

export const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

export const OSM_TILE_HOST = 'https://tile.openstreetmap.org';

export const OSM_ATTRIBUTION =
  '&copy; <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>';

// A handful of tile errors is normal; a burst with no successful load in
// between means the tile source is unreachable. Measured at z14 on a
// 390x640 container a full screen is exactly 6 tiles (MAP-TRUTH G1), so
// this is "one screenful failed outright".
export const TILE_ERROR_THRESHOLD = 6;
