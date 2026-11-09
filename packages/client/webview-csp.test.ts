// @vitest-environment node
// (node, not jsdom: importing vite.config pulls in esbuild, whose realm
// check breaks under jsdom's TextEncoder.)
//
// CSP-TIGHTEN — the built WebView CSP must scope connect-src to the one
// API origin baked into the build, not blanket https:/wss:. Lives next to
// vite.config.ts (outside src/) so `tsc` — whose project only includes
// src — never pulls the config across the tsconfig.node.json project
// reference; vitest picks it up via its default include.
import { describe, it, expect } from 'vitest';
import { buildCsp, webviewCsp } from './vite.config';
import { OSM_TILE_URL } from './src/components/map/tile-source';

const PROD_API = 'https://bimoto-api.onrender.com';

function connectSrcOf(csp: string): string[] {
  const directive = csp
    .split(';')
    .map((d) => d.trim())
    .find((d) => d.startsWith('connect-src'));
  expect(directive).toBeDefined();
  return directive!.split(/\s+/).slice(1);
}

describe('buildCsp', () => {
  it('production: connect-src allows only self, the API origin, and its wss counterpart', () => {
    const csp = buildCsp(PROD_API, 'production');
    const sources = connectSrcOf(csp);
    expect(sources).toContain("'self'");
    expect(sources).toContain('https://bimoto-api.onrender.com');
    expect(sources).toContain('wss://bimoto-api.onrender.com');
    // The blanket TLS allowance is the XSS-exfiltration hole this closes.
    expect(sources).not.toContain('https:');
    expect(sources).not.toContain('wss:');
    expect(csp).not.toMatch(/localhost|127\.0\.0\.1/);
  });

  it('reduces a VITE_API_URL with a path to its origin', () => {
    const sources = connectSrcOf(
      buildCsp('https://pilot-api.example.com:8443/some/path', 'production'),
    );
    expect(sources).toContain('https://pilot-api.example.com:8443');
    expect(sources).toContain('wss://pilot-api.example.com:8443');
  });

  it('non-production keeps the plain-HTTP localhost allowance for preview/e2e', () => {
    const sources = connectSrcOf(buildCsp(PROD_API, 'development'));
    expect(sources).toContain('https://bimoto-api.onrender.com');
    expect(sources).toContain('http://localhost:*');
    expect(sources).toContain('ws://localhost:*');
    expect(sources).toContain('http://127.0.0.1:*');
    expect(sources).toContain('ws://127.0.0.1:*');
  });

  it('production mode without VITE_API_URL is treated as non-production', () => {
    const sources = connectSrcOf(buildCsp(undefined, 'production'));
    expect(sources).toContain('http://localhost:3000');
    expect(sources).toContain('ws://localhost:3000');
    expect(sources).toContain('http://localhost:*');
  });

  it('leaves every other directive unchanged', () => {
    const csp = buildCsp(PROD_API, 'production');
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).toContain("img-src 'self' data: blob: https://tile.openstreetmap.org");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
  });

  // MAP-TRUTH G2 — the img-src allowance and the tile URL the app
  // actually requests must name the SAME host. A CSP wildcard
  // `*.tile.openstreetmap.org` does not match the bare host
  // `tile.openstreetmap.org`, so these two drifting apart ships a blank
  // map that no component test would catch. Imported, not retyped, so
  // the constant is the single source of truth.
  it('img-src permits the exact host the base tile layer requests', () => {
    const imgSrc = buildCsp(PROD_API, 'production')
      .split(';')
      .map((d) => d.trim())
      .find((d) => d.startsWith('img-src'));
    expect(imgSrc).toBeDefined();

    const requestedOrigin = new URL(OSM_TILE_URL.replace(/\{[zxy]\}/g, '0')).origin;
    expect(imgSrc!.split(/\s+/)).toContain(requestedOrigin);
    // A wildcard here would silently fail to match the bare host.
    expect(imgSrc).not.toContain('*.tile.openstreetmap.org');
  });
});

describe('webviewCsp plugin', () => {
  it('injects the CSP meta tag after the charset meta in built index.html', () => {
    const csp = buildCsp(PROD_API, 'production');
    const plugin = webviewCsp(csp);
    const html = '<html>\n  <head>\n    <meta charset="UTF-8" />\n  </head>\n</html>';
    const out = (plugin.transformIndexHtml as (html: string) => string)(html);
    expect(out).toContain(
      `<meta http-equiv="Content-Security-Policy" content="${csp}" />`,
    );
    // The charset meta must survive (the CSP is appended, not substituted).
    expect(out).toContain('<meta charset="UTF-8" />');
  });
});
