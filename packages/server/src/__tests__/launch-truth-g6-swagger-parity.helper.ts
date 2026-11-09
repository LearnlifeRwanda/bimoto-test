// LAUNCH-TRUTH G6.3 — registered-endpoint census helper for the
// swagger parity test. Parses index.ts's mounts (the single place
// routers attach to the app) and walks each router's layer stack, so a
// newly mounted router is picked up automatically without editing the
// test. Kept out of the test file so the extraction can be reused by
// tooling (e.g. the dead-code report) without dragging jest in.

import fs from 'fs';
import path from 'path';

export interface RegisteredEndpoint {
  method: string;
  path: string;
}

/** Express ':param' -> OpenAPI '{param}'. */
function toSwaggerPath(p: string): string {
  return p.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

function joinMount(prefix: string, routePath: string): string {
  const joined = routePath === '/' ? prefix : `${prefix}${routePath}`;
  return joined.replace(/\/{2,}/g, '/').replace(/(.)\/$/, '$1');
}

/**
 * Every endpoint actually reachable through index.ts: router mounts
 * (app.use('<prefix>', <router>)) plus direct app.<verb>('<path>')
 * registrations.
 */
export function listRegisteredEndpoints(): RegisteredEndpoint[] {
  const indexSrc = fs.readFileSync(path.join(__dirname, '../index.ts'), 'utf8');

  // import <name> from './routes/<file>';
  const importPaths = new Map<string, string>();
  for (const m of indexSrc.matchAll(/import (\w+) from '(\.\/routes\/[^']+)';/g)) {
    importPaths.set(m[1], m[2]);
  }

  const endpoints: RegisteredEndpoint[] = [];

  // app.use('<prefix>', <routerName>);
  for (const m of indexSrc.matchAll(/app\.use\('([^']+)',\s*(\w+)\);/g)) {
    const [, prefix, name] = m;
    const modPath = importPaths.get(name);
    if (!modPath) continue; // non-router middleware (static, swagger UI)
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const router = require(path.join('..', modPath)).default;
    for (const layer of router.stack ?? []) {
      if (!layer.route) continue; // router-level middleware (auth etc.)
      for (const method of Object.keys(layer.route.methods)) {
        endpoints.push({
          method,
          path: toSwaggerPath(joinMount(prefix, layer.route.path)),
        });
      }
    }
  }

  // Direct registrations: app.get('/api/docs.json', ...) etc.
  for (const m of indexSrc.matchAll(/app\.(get|post|put|delete|patch)\('([^']+)'/g)) {
    endpoints.push({ method: m[1], path: toSwaggerPath(m[2]) });
  }

  return endpoints;
}
